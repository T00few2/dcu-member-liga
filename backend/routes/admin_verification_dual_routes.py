"""
Admin verification routes: dual-recording and event-based matching endpoints.
"""

import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db
from routes.admin import admin_bp
from services.dual_recording_core import (
    _is_dual_recording_required,
    _load_sw_thresholds,
    _run_sw_only_background,
)
from services.dual_recording_admin_core import (
    DualRecordingError,
    EventActivityError,
    collect_dr_candidates_for_race,
    get_dual_recording_result,
    get_event_activity_for_rider,
    resolve_category_event_start,
    resolve_rider_activity_id,
    resolve_rider_category_row,
    save_missing_activity_payload,
    trigger_rider_dr_verification,
)

logger = logging.getLogger(__name__)


@admin_bp.route("/admin/verification/event-activity/<rider_id>", methods=["GET"])
def event_activity(rider_id):
    """
    Given a Zwift event ID, locate rider segment result and matching activity.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    event_id = request.args.get("eventId")
    if not event_id:
        return jsonify({"message": "eventId is required"}), 400

    try:
        payload = get_event_activity_for_rider(
            db=db,
            rider_id=str(rider_id),
            event_id=str(event_id),
            logger=logger,
        )
        return jsonify(payload), 200
    except EventActivityError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    except Exception as exc:
        logger.error("event_activity error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/verification/dual-recording/<rider_id>", methods=["GET"])
def dual_recording(rider_id):
    """Fetch and compare rider's Zwift and Strava recordings."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    zwift_activity_id = request.args.get("zwiftActivityId")
    strava_activity_id = request.args.get("stravaActivityId")
    event_start_iso = request.args.get("eventStartIso")
    race_id = request.args.get("raceId")

    if not zwift_activity_id and not race_id:
        return jsonify({"message": "zwiftActivityId is required"}), 400

    try:
        result = get_dual_recording_result(
            db=db,
            rider_id=str(rider_id),
            zwift_activity_id=zwift_activity_id,
            strava_activity_id=strava_activity_id,
            event_start_iso=event_start_iso,
            race_id=race_id,
            logger=logger,
        )
        return jsonify(result), 200
    except DualRecordingError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 404
    except Exception as exc:
        logger.error("dual_recording error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/races/<race_id>/dr-verifications", methods=["GET"])
def get_race_dual_recording_verifications(race_id):
    """Return stored DR verification docs for a race."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        race_doc = db.collection("races").document(race_id).get()
        if not race_doc.exists:
            return jsonify({"message": "Race not found"}), 404

        out: list[dict] = []
        docs = db.collection("races").document(race_id).collection("dr_verifications").stream()
        for d in docs:
            payload = d.to_dict() or {}
            payload["zwiftId"] = str(payload.get("zwiftId") or d.id)
            out.append(payload)

        return jsonify({"verifications": out}), 200
    except Exception as exc:
        logger.error("get_race_dual_recording_verifications error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/races/<race_id>/verify-dual-recording", methods=["POST"])
def batch_verify_dual_recording(race_id):
    """Run DR verification for every DR-required rider in a race."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        race_doc = db.collection("races").document(race_id).get()
        if not race_doc.exists:
            return jsonify({"message": "Race not found"}), 404
        race_data = race_doc.to_dict() or {}

        candidates = collect_dr_candidates_for_race(db, race_data)
        sw_thresholds = _load_sw_thresholds(db)
        summary: list[dict] = []

        for candidate in candidates:
            zwift_id = str(candidate.get("zwiftId") or "")
            category = str(candidate.get("category") or "")
            activity_id = str(candidate.get("activityId") or "").strip() or None
            event_start = resolve_category_event_start(race_data, category)

            if not activity_id:
                activity_id, _ = resolve_rider_activity_id(
                    db,
                    race_data=race_data,
                    zwift_id=zwift_id,
                    target_category=category,
                )

            if not activity_id:
                save_missing_activity_payload(db, race_id, zwift_id)
                summary.append({"zwiftId": zwift_id, "status": "missing_activity"})
                continue

            trigger_rider_dr_verification(
                db,
                race_id=race_id,
                zwift_id=zwift_id,
                activity_id=str(activity_id),
                event_start_iso=event_start or None,
                sw_thresholds=sw_thresholds,
            )
            summary.append({"zwiftId": zwift_id, "activityId": str(activity_id), "status": "triggered"})

        return jsonify(
            {
                "candidates": len(candidates),
                "triggered": len([s for s in summary if s.get("status") == "triggered"]),
                "missing_activity": len([s for s in summary if s.get("status") == "missing_activity"]),
                "details": summary,
            }
        ), 200
    except Exception as exc:
        logger.error("batch_verify_dual_recording error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/races/<race_id>/verify-dual-recording/candidates", methods=["GET"])
def get_dual_recording_candidates(race_id: str):
    """Preview DR-required riders for this race."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        race_doc = db.collection("races").document(race_id).get()
        if not race_doc.exists:
            return jsonify({"message": "Race not found"}), 404
        race_data = race_doc.to_dict() or {}
        riders = collect_dr_candidates_for_race(db, race_data)
        return jsonify({"total": len(riders), "riders": riders}), 200
    except Exception as exc:
        logger.error("get_dual_recording_candidates error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/races/<race_id>/verify-dual-recording/<zwift_id>", methods=["POST"])
def verify_dual_recording_for_rider(race_id: str, zwift_id: str):
    """Run DR verification for one rider in one race and return latest status."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        race_doc = db.collection("races").document(race_id).get()
        if not race_doc.exists:
            return jsonify({"message": "Race not found"}), 404
        race_data = race_doc.to_dict() or {}

        target_category, rider_row = resolve_rider_category_row(race_data, str(zwift_id))

        user_doc = db.collection("users").document(str(zwift_id)).get()
        if not user_doc.exists:
            return jsonify({"message": "Rider not found"}), 404
        if not _is_dual_recording_required(db, str(zwift_id)):
            return jsonify({"message": "Dual recording not required for this rider"}), 400

        payload = request.get_json(silent=True) or {}
        preferred_activity_value = payload.get("activityId")
        if not preferred_activity_value and rider_row:
            preferred_activity_value = rider_row.get("activityId")
        preferred_activity_id = str(preferred_activity_value or "").strip() or None
        activity_id, event_start = resolve_rider_activity_id(
            db,
            race_data=race_data,
            zwift_id=str(zwift_id),
            target_category=target_category,
            preferred_activity_id=preferred_activity_id,
        )

        if not activity_id:
            missing_payload = save_missing_activity_payload(db, race_id, str(zwift_id))
            return jsonify({
                "ok": True,
                "message": "No matching Zwift activity found for this race.",
                "verification": missing_payload,
            }), 200

        trigger_rider_dr_verification(
            db,
            race_id=race_id,
            zwift_id=str(zwift_id),
            activity_id=str(activity_id),
            event_start_iso=event_start or None,
            sw_thresholds=_load_sw_thresholds(db),
        )

        vdoc = (
            db.collection("races")
            .document(race_id)
            .collection("dr_verifications")
            .document(str(zwift_id))
            .get()
        )
        verification = vdoc.to_dict() or {}
        verification["zwiftId"] = str(zwift_id)
        return jsonify({
            "ok": True,
            "message": "DR verification completed for rider.",
            "verification": verification,
        }), 200
    except Exception as exc:
        logger.error("verify_dual_recording_for_rider error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/races/<race_id>/verify-sticky-watts/candidates", methods=["GET"])
def get_sw_only_candidates(race_id: str):
    """Return riders who need SW-only verification (all with activityId, excluding DR-required)."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        race_doc = db.collection("races").document(race_id).get()
        if not race_doc.exists:
            return jsonify({"message": "Race not found"}), 404
        race_data = race_doc.to_dict() or {}

        dr_candidates = collect_dr_candidates_for_race(db, race_data)
        dr_set = {c["zwiftId"] for c in dr_candidates}

        candidates: list[dict] = []
        seen: set[str] = set()
        for category, riders in (race_data.get("results") or {}).items():
            for rider in (riders or []):
                zwift_id = str(rider.get("zwiftId") or "").strip()
                if not zwift_id or zwift_id in seen or zwift_id in dr_set:
                    continue
                seen.add(zwift_id)
                candidates.append({
                    "zwiftId": zwift_id,
                    "name": str(rider.get("name") or ""),
                    "category": str(category),
                    "activityId": str(rider.get("activityId") or "").strip() or None,
                })

        return jsonify({"total": len(candidates), "riders": candidates}), 200
    except Exception as exc:
        logger.error("get_sw_only_candidates error: %s", exc)
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/races/<race_id>/verify-sticky-watts/<zwift_id>", methods=["POST"])
def verify_sticky_watts_for_rider(race_id: str, zwift_id: str):
    """Run SW-only verification for one rider and return the stored result."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        payload = request.get_json(silent=True) or {}
        activity_id = str(payload.get("activityId") or "").strip()
        race_data: dict = {}

        if not activity_id:
            race_doc = db.collection("races").document(race_id).get()
            if not race_doc.exists:
                return jsonify({"message": "Race not found"}), 404
            race_data = race_doc.to_dict() or {}
            for riders in (race_data.get("results") or {}).values():
                for rider in (riders or []):
                    if str(rider.get("zwiftId") or "").strip() == str(zwift_id):
                        activity_id = str(rider.get("activityId") or "").strip()
                        break
                if activity_id:
                    break

        if not activity_id and race_data:
            # Try resolving via stored Zwift activities (works for riders who
            # connected their Zwift account even without DR requirement).
            target_category, _ = resolve_rider_category_row(race_data, str(zwift_id))
            activity_id, _ = resolve_rider_activity_id(
                db,
                race_data=race_data,
                zwift_id=str(zwift_id),
                target_category=target_category,
            )

        if not activity_id:
            missing_payload = save_missing_activity_payload(db, race_id, str(zwift_id))
            return jsonify({
                "ok": True,
                "message": "No Zwift activity found for this rider.",
                "verification": missing_payload,
            }), 200

        sw_thresholds = _load_sw_thresholds(db)
        _run_sw_only_background(
            db=db,
            user_doc_id=str(zwift_id),
            zwift_id_canonical=str(zwift_id),
            activity_id=activity_id,
            race_id=race_id,
            sw_thresholds=sw_thresholds,
        )

        vdoc = (
            db.collection("races")
            .document(race_id)
            .collection("dr_verifications")
            .document(str(zwift_id))
            .get()
        )
        verification = vdoc.to_dict() or {}
        verification["zwiftId"] = str(zwift_id)
        return jsonify({
            "ok": True,
            "message": "SW verification completed for rider.",
            "verification": verification,
        }), 200
    except Exception as exc:
        logger.error("verify_sticky_watts_for_rider error: %s", exc)
        return jsonify({"message": str(exc)}), 500
