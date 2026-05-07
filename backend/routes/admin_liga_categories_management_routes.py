"""
Admin routes for liga category configuration, assignment and predictor settings.
"""

import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db
from firebase_admin import firestore
from routes.admin import admin_bp
from services.category_engine import (
    _effective_cat_name,
    build_liga_category,
    cats_from_defs,
    effective_rating,
    reassign_to_next_category,
    serialize_liga_category,
)
from services.liga_categories_core import (
    _compute_liga_update,
    _load_liga_settings,
    _resolve_categories,
)
from services.schema_validation import (
    log_schema_issues,
    validate_league_settings_doc,
    validate_user_doc,
    with_schema_version,
)
from services.user_service import UserService

logger = logging.getLogger(__name__)

# Firestore batch write limit (hard limit is 500; we use 400 for safety).
_FIRESTORE_BATCH_SIZE = 400


@admin_bp.route("/admin/liga-categories/config", methods=["POST"])
def save_liga_categories_config():
    """Save custom liga category definitions to league settings."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        body = request.get_json(silent=True) or {}
        categories = body.get("categories")

        if not categories or not isinstance(categories, list):
            return jsonify({"message": "'categories' must be a non-empty list"}), 400
        if len(categories) < 2:
            return jsonify({"message": "At least 2 categories are required"}), 400

        for cat in categories:
            name = cat.get("name", "")
            if not isinstance(name, str) or not name.strip():
                return jsonify({"message": "Each category must have a non-empty name"}), 400
            upper = cat.get("upper")
            if upper is not None and not isinstance(upper, (int, float)):
                return jsonify({"message": "upper must be a number or null"}), 400

        null_upper_count = sum(1 for c in categories if c.get("upper") is None)
        if null_upper_count != 1:
            return jsonify({"message": "Exactly one category must have upper=null (the top)"}), 400
        if categories[0].get("upper") is not None:
            return jsonify({"message": "The category with upper=null must be first"}), 400

        uppers = [c["upper"] for c in categories[1:]]
        for i in range(len(uppers) - 1):
            if uppers[i] is not None and uppers[i + 1] is not None and uppers[i] <= uppers[i + 1]:
                return jsonify({"message": "Upper boundaries must be strictly decreasing"}), 400

        normalised = [
            {"name": c["name"].strip(), "upper": int(c["upper"]) if c.get("upper") is not None else None}
            for c in categories
        ]

        settings_update = with_schema_version({"ligaCategories": normalised})
        log_schema_issues(
            logger,
            "league/settings (liga categories config)",
            validate_league_settings_doc(settings_update, partial=True),
        )
        db.collection("league").document("settings").set(settings_update, merge=True)
        return jsonify({"message": "Category configuration saved", "count": len(normalised)}), 200
    except Exception as e:
        logger.error("Save liga categories config error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/assign-liga-categories", methods=["POST"])
def assign_liga_categories():
    """Bulk-assign liga categories to all registered riders from effective vELO."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        body = request.get_json(silent=True) or {}
        settings_doc = db.collection("league").document("settings").get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}

        grace_period = int(body.get("gracePeriod", settings.get("gracePeriod", 35)))
        cat_defs = body.get("categories") or settings.get("ligaCategories")
        categories = cats_from_defs(cat_defs) if cat_defs else None

        settings_update = with_schema_version({"gracePeriod": grace_period})
        log_schema_issues(
            logger,
            "league/settings (gracePeriod)",
            validate_league_settings_doc(settings_update, partial=True),
        )
        db.collection("league").document("settings").set(settings_update, merge=True)

        docs = db.collection("users").where("registration.status", "==", "complete").stream()

        assigned = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0

        for doc in docs:
            data = doc.to_dict() or {}
            zr = data.get("zwiftRacing", {})
            eff_rating = effective_rating(
                zr.get("currentRating", "N/A"),
                zr.get("max30Rating", "N/A"),
                zr.get("max90Rating", "N/A"),
            )

            if eff_rating is None:
                skipped += 1
                continue

            try:
                liga_update = _compute_liga_update(eff_rating, None, grace_period, categories)
                user_update = with_schema_version(liga_update)
                log_schema_issues(
                    logger,
                    f"users/{doc.id} (bulk assign liga)",
                    validate_user_doc(user_update, partial=True),
                )
                batch.set(doc.reference, user_update, merge=True)
                assigned += 1
                batch_count += 1

                if batch_count >= _FIRESTORE_BATCH_SIZE:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
            except Exception as ex:
                logger.warning("Could not assign category for %s: %s", doc.id, ex)
                skipped += 1

        if batch_count > 0:
            batch.commit()

        logger.info("Liga category assignment: %s assigned, %s skipped", assigned, skipped)
        return (
            jsonify(
                {
                    "message": "Liga categories assigned",
                    "gracePeriod": grace_period,
                    "assigned": assigned,
                    "skipped": skipped,
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("Liga category assignment error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/liga-categories", methods=["GET"])
def get_liga_categories():
    """Return registered riders with ligaCategory and effective vELO data."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        docs = db.collection("users").where("registration.status", "==", "complete").stream()

        riders = []
        for doc in docs:
            data = doc.to_dict() or {}
            lc = serialize_liga_category(data.get("ligaCategory"))
            zr = data.get("zwiftRacing", {})
            current_rating = zr.get("currentRating", "N/A")
            max30_rating = zr.get("max30Rating", "N/A")
            max90_rating = zr.get("max90Rating", "N/A")
            eff_rating = effective_rating(current_rating, max30_rating, max90_rating)
            riders.append(
                {
                    "zwiftId": data.get("zwiftId", ""),
                    "name": data.get("name", ""),
                    "club": data.get("club", ""),
                    "currentRating": current_rating,
                    "max30Rating": max30_rating,
                    "max90Rating": max90_rating,
                    "effectiveRating": eff_rating if eff_rating is not None else "N/A",
                    "ligaCategory": lc,
                }
            )

        status_order = {"over": 0, "grace": 1, "ok": 2}
        riders.sort(key=lambda r: status_order.get((r.get("ligaCategory") or {}).get("status", ""), 3))
        return jsonify({"riders": riders}), 200
    except Exception as e:
        logger.error("Get liga categories error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/liga-categories/<zwift_id>/reassign", methods=["POST"])
def reassign_liga_category(zwift_id):
    """Manually move a rider up to the next category tier."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        user = UserService.get_user_by_id(zwift_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        data = user._data
        lc = data.get("ligaCategory")
        if not lc:
            return jsonify({"message": "Rider has no assigned liga category"}), 400

        liga_settings = _load_liga_settings(db)
        grace_period = liga_settings["gracePeriod"]
        categories = _resolve_categories(liga_settings)

        zr = data.get("zwiftRacing", {})
        eff_rating = effective_rating(
            zr.get("currentRating", "N/A"),
            zr.get("max30Rating", "N/A"),
            zr.get("max90Rating", "N/A"),
        )
        if eff_rating is None:
            return jsonify({"message": "Rider has no vELO rating"}), 400

        auto = lc.get("autoAssigned") or {}
        current_cat = auto.get("category")

        target = build_liga_category(eff_rating, grace_period, categories)
        target_cat = target["category"]
        effective_new_cat = _effective_cat_name(target_cat, current_cat, categories)

        if effective_new_cat != current_cat:
            update_fields = target
            update_fields.pop("assignedRating", None)
        else:
            update_fields = reassign_to_next_category(current_cat, eff_rating, grace_period, categories)

        update_fields["lastCheckedAt"] = firestore.SERVER_TIMESTAMP

        new_auto = {**auto, **update_fields}
        doc_update = {"ligaCategory.autoAssigned": new_auto}
        if lc.get("locked"):
            doc_update["ligaCategory.category"] = update_fields["category"]

        user_update = with_schema_version(doc_update)
        log_schema_issues(
            logger,
            f"users/{user.id} (manual reassign)",
            validate_user_doc(user_update, partial=True),
        )
        db.collection("users").document(str(user.id)).update(user_update)

        return (
            jsonify(
                {
                    "message": f"Rider moved to {update_fields['category']}",
                    "category": update_fields["category"],
                    "status": update_fields["status"],
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("Reassign liga category error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor-config", methods=["GET"])
def get_predictor_config():
    """Return saved vELO predictor feature selection from league settings."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        doc = db.collection("league").document("settings").get()
        s = doc.to_dict() if doc.exists else {}
        return jsonify({"features": s.get("predictorFeatures")}), 200
    except Exception as e:
        logger.error("get_predictor_config error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor-config", methods=["POST"])
def save_predictor_config():
    """Persist vELO predictor feature selection to league settings."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    body = request.get_json(silent=True) or {}
    features = body.get("features")
    if not isinstance(features, dict):
        return jsonify({"message": "features must be an object"}), 400

    try:
        db.collection("league").document("settings").set({"predictorFeatures": features}, merge=True)
        return jsonify({"message": "Saved"}), 200
    except Exception as e:
        logger.error("save_predictor_config error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/liga-categories/<zwift_id>/predict-assign", methods=["POST"])
def predict_assign_liga_category(zwift_id):
    """Assign rider category from admin-supplied predicted vELO score."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    body = request.get_json(silent=True) or {}
    predicted_velo = body.get("predictedVelo")
    if predicted_velo is None or not isinstance(predicted_velo, (int, float)) or predicted_velo <= 0:
        return jsonify({"message": "predictedVelo must be a positive number"}), 400
    predicted_velo = float(predicted_velo)

    try:
        user = UserService.get_user_by_id(zwift_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        liga_settings = _load_liga_settings(db)
        grace_period = liga_settings["gracePeriod"]
        categories = _resolve_categories(liga_settings)

        result = build_liga_category(predicted_velo, grace_period, categories)
        result["assignedFrom"] = "predicted"
        result["predictedVelo"] = predicted_velo
        result["lastCheckedAt"] = firestore.SERVER_TIMESTAMP

        existing_lc = user._data.get("ligaCategory") or {}
        locked = existing_lc.get("locked", False)

        doc_update: dict = {"ligaCategory.autoAssigned": result}
        if not locked:
            doc_update["ligaCategory.category"] = result["category"]

        user_update = with_schema_version(doc_update)
        log_schema_issues(
            logger,
            f"users/{user.id} (predict-assign)",
            validate_user_doc(user_update, partial=True),
        )
        db.collection("users").document(str(user.id)).update(user_update)

        return (
            jsonify(
                {
                    "message": f"Rider assigned to {result['category']} from predicted vELO {predicted_velo:.0f}",
                    "category": result["category"],
                    "predictedVelo": predicted_velo,
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("predict_assign_liga_category error: %s", e)
        return jsonify({"message": str(e)}), 500

