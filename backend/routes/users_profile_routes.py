from __future__ import annotations

import logging

from flask import jsonify, request
from firebase_admin import firestore

from authz import AuthzError, verify_user_token
from extensions import db, stats_queue
from services.category_engine import ZR_CATEGORIES, serialize_liga_category
from services.policy_store import (
    POLICY_DATA_POLICY,
    POLICY_PUBLIC_RESULTS,
    PolicyError,
    get_policy_meta,
)
from services.schema_validation import log_schema_issues, validate_user_doc, with_schema_version
from services.user_service import UserService
from services.users_profile_core import (
    _connected_zwift_id_from_user_data,
    _enrich_user_with_zwiftracing,
    _latest_published_post_id,
    _normalize_zwift_id,
    _sw_flagged_timestamp,
    _trainer_requires_dual_recording,
)
from services.zwift_tokens import (
    delete_token_doc,
    get_token_doc,
    resolve_user_doc_id_from_auth_uid,
    save_token_doc,
)
from services.request_models import (
    MarkNewsReadRequest,
    SelectCategoryRequest,
    SignupRequest,
    UpdateConsentsRequest,
    parse_body,
)
from routes.users import users_bp

logger = logging.getLogger(__name__)


@users_bp.route("/profile", methods=["GET"])
def get_profile():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        try:
            policy_meta = get_policy_meta(db)
        except PolicyError as e:
            return jsonify({"message": e.message}), e.status_code

        if not user:
            shell = db.collection("users").document(uid).get()
            if shell.exists:
                shell_data = shell.to_dict() or {}
                shell_conn = (shell_data.get("connections") or {}).get("zwift") or {}
                shell_zwift_id = _connected_zwift_id_from_user_data(shell_data)
                return (
                    jsonify(
                        {
                            "registered": False,
                            "hasDraft": False,
                            "name": shell_data.get("name", ""),
                            "zwiftId": shell_zwift_id,
                            "club": shell_data.get("club", ""),
                            "trainer": (shell_data.get("equipment") or {}).get("trainer", ""),
                            "stravaConnected": bool((shell_data.get("connections") or {}).get("strava")),
                            "zwiftConnected": bool(shell_conn.get("connected")),
                            "requiredDataPolicyVersion": policy_meta.get(POLICY_DATA_POLICY, {}).get(
                                "requiredVersion"
                            ),
                            "requiredPublicResultsConsentVersion": policy_meta.get(
                                POLICY_PUBLIC_RESULTS, {}
                            ).get("requiredVersion"),
                        }
                    ),
                    200,
                )

            return (
                jsonify(
                    {
                        "registered": False,
                        "requiredDataPolicyVersion": policy_meta.get(POLICY_DATA_POLICY, {}).get(
                            "requiredVersion"
                        ),
                        "requiredPublicResultsConsentVersion": policy_meta.get(POLICY_PUBLIC_RESULTS, {}).get(
                            "requiredVersion"
                        ),
                    }
                ),
                200,
            )

        lc = serialize_liga_category(user._data.get("ligaCategory"))
        return (
            jsonify(
                {
                    "registered": user.is_registered,
                    "hasDraft": user.registration.get("status") == "draft",
                    "welcomeSeen": user._data.get("welcomeSeen", False),
                    "name": user.name,
                    "zwiftId": user.zwift_id,
                    "club": user.club,
                    "trainer": user.trainer,
                    "stravaConnected": bool(user._data.get("connections", {}).get("strava")),
                    "zwiftConnected": bool(user._data.get("connections", {}).get("zwift")),
                    "acceptedCoC": user.registration.get("cocAccepted", False),
                    "acceptedDataPolicy": user.accepted_data_policy,
                    "acceptedPublicResults": user.accepted_public_results,
                    "dataPolicyVersion": user.data_policy_version,
                    "publicResultsConsentVersion": user.public_results_consent_version,
                    "requiredDataPolicyVersion": policy_meta.get(POLICY_DATA_POLICY, {}).get("requiredVersion"),
                    "requiredPublicResultsConsentVersion": policy_meta.get(POLICY_PUBLIC_RESULTS, {}).get(
                        "requiredVersion"
                    ),
                    "weightVerificationStatus": user.verification_status,
                    "weightVerificationVideoLink": user.weight_verification_video_link,
                    "weightVerificationDeadline": user.weight_verification_deadline,
                    "verificationRequests": user.verification_history,
                    "ligaCategory": lc,
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("Profile Error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/signup", methods=["POST"])
def signup():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]
        email = decoded_token.get("email")

        body, err = parse_body(SignupRequest, request.get_json(silent=True) or {})
        if err:
            return err

        name = body.name
        raw_zwift_id = body.zwiftId
        zwift_id = str(raw_zwift_id).strip() if raw_zwift_id is not None else None
        club = body.club
        trainer = body.trainer
        is_draft = body.draft
        accepted_coc = body.acceptedCoC
        accepted_data_policy = body.acceptedDataPolicy
        accepted_public_results = body.acceptedPublicResults
        data_policy_version = body.dataPolicyVersion
        public_results_consent_version = body.publicResultsConsentVersion

        if is_draft:
            if not name:
                return jsonify({"message": "At least a name is required to save progress"}), 400
            if zwift_id and not _normalize_zwift_id(zwift_id):
                return jsonify({"message": "Zwift ID must be numeric"}), 400
        else:
            if not name:
                return jsonify({"message": "Missing name"}), 400
            if not club or club == "None":
                return (
                    jsonify(
                        {
                            "message": "Du skal være medlem af en DCU-klub for at deltage. Vælg din klub for at fortsætte."
                        }
                    ),
                    400,
                )

            resolved_doc_id = resolve_user_doc_id_from_auth_uid(uid) or uid
            source_doc = db.collection("users").document(str(resolved_doc_id)).get()
            source_data = source_doc.to_dict() if source_doc.exists else {}
            zwift_id = _connected_zwift_id_from_user_data(source_data)
            if not zwift_id:
                return jsonify({"message": "Connect your Zwift account first"}), 400

            if not accepted_coc:
                return jsonify({"message": "You must accept the Code of Conduct."}), 400
            if not accepted_data_policy:
                return jsonify({"message": "You must accept the data policy."}), 400
            if not accepted_public_results:
                return jsonify({"message": "You must accept publication of name and results."}), 400
            try:
                required_versions = get_policy_meta(db)
            except PolicyError as e:
                return jsonify({"message": e.message}), e.status_code
            required_data_policy = required_versions.get(POLICY_DATA_POLICY, {}).get("requiredVersion")
            required_public = required_versions.get(POLICY_PUBLIC_RESULTS, {}).get("requiredVersion")
            if data_policy_version != required_data_policy:
                return (
                    jsonify(
                        {
                            "message": "Data policy version mismatch. Please review and accept the latest policy."
                        }
                    ),
                    400,
                )
            if public_results_consent_version != required_public:
                return (
                    jsonify(
                        {
                            "message": "Public results consent version mismatch. Please review and accept the latest consent."
                        }
                    ),
                    400,
                )

            if trainer and _trainer_requires_dual_recording(trainer):
                strava_connected = bool((source_data.get("connections") or {}).get("strava"))
                if not strava_connected:
                    return (
                        jsonify(
                            {
                                "message": "Selected trainer requires Strava connection for dual recording. Connect Strava before completing profile."
                            }
                        ),
                        400,
                    )

        if db:
            user_data = {
                "authUid": uid,
                "email": email,
                "updatedAt": firestore.SERVER_TIMESTAMP,
                "zwiftId": zwift_id,
            }
            existing_user = UserService.get_user_by_auth_uid(uid)
            if existing_user:
                existing_zwift_user_id = (existing_user.to_dict() or {}).get("zwiftUserId")
                if existing_zwift_user_id:
                    user_data["zwiftUserId"] = existing_zwift_user_id
            else:
                resolved_doc_id = resolve_user_doc_id_from_auth_uid(uid) or uid
                shell_doc = db.collection("users").document(str(resolved_doc_id)).get()
                if shell_doc.exists:
                    shell_zwift_user_id = (shell_doc.to_dict() or {}).get("zwiftUserId")
                    if shell_zwift_user_id:
                        user_data["zwiftUserId"] = shell_zwift_user_id
            if name:
                user_data["name"] = name
            if club:
                user_data["club"] = club
            if trainer:
                user_data["equipment"] = {"trainer": trainer}

            registration = {"cocAccepted": accepted_coc}
            if accepted_data_policy:
                registration["dataPolicy"] = {
                    "version": data_policy_version,
                    "acceptedAt": firestore.SERVER_TIMESTAMP,
                }
            if accepted_public_results:
                registration["publicResultsConsent"] = {
                    "version": public_results_consent_version,
                    "acceptedAt": firestore.SERVER_TIMESTAMP,
                }
            registration["status"] = "draft" if is_draft else "complete"
            user_data["registration"] = registration
            user_data = with_schema_version(user_data)

            doc_id = str(zwift_id) if zwift_id else uid
            doc_ref = db.collection("users").document(doc_id)
            log_schema_issues(logger, f"users/{doc_id} (signup)", validate_user_doc(user_data))

            @firestore.transactional
            def _promote_registration(transaction, ref, data):
                prev_doc = ref.get(transaction=transaction)
                prev_reg_status = (
                    (prev_doc.to_dict() or {}).get("registration", {}).get("status")
                    if prev_doc.exists
                    else None
                )
                newly_registered = not is_draft and prev_reg_status != "complete"
                transaction.set(ref, data, merge=True)
                return newly_registered

            is_newly_registered = _promote_registration(db.transaction(), doc_ref, user_data)

            if not is_draft and zwift_id and uid:
                draft_doc = db.collection("users").document(uid).get()
                if draft_doc.exists and draft_doc.id != str(zwift_id):
                    draft_data = draft_doc.to_dict() or {}
                    migrate_payload = {}
                    for key in ("connections", "zwiftUserId", "zwiftProfile", "zwiftPowerCurve"):
                        if key in draft_data:
                            migrate_payload[key] = draft_data[key]
                    if migrate_payload:
                        doc_ref.set(migrate_payload, merge=True)

                    uid_token = get_token_doc(uid)
                    if uid_token:
                        existing_target_token = get_token_doc(str(zwift_id))
                        if not existing_target_token:
                            save_token_doc(str(zwift_id), uid_token)
                        try:
                            delete_token_doc(uid)
                        except Exception:
                            pass
                    try:
                        db.collection("users").document(uid).delete()
                    except Exception:
                        pass
                else:
                    uid_shell = db.collection("users").document(uid).get()
                    if uid_shell.exists and uid_shell.id != str(zwift_id):
                        uid_data = uid_shell.to_dict() or {}
                        migrate_payload = {}
                        for key in ("connections", "zwiftUserId", "zwiftProfile", "zwiftPowerCurve"):
                            if key in uid_data:
                                migrate_payload[key] = uid_data[key]
                        if migrate_payload:
                            doc_ref.set(migrate_payload, merge=True)
                        try:
                            db.collection("users").document(uid).delete()
                        except Exception:
                            pass

                    uid_token = get_token_doc(uid)
                    if uid_token and str(uid) != str(zwift_id):
                        existing_target_token = get_token_doc(str(zwift_id))
                        if not existing_target_token:
                            save_token_doc(str(zwift_id), uid_token)
                        try:
                            delete_token_doc(uid)
                        except Exception:
                            pass

            auth_map_data = {"lastLogin": firestore.SERVER_TIMESTAMP}
            if zwift_id:
                auth_map_data["zwiftId"] = zwift_id
            db.collection("auth_mappings").document(uid).set(auth_map_data, merge=True)

            if not is_draft and zwift_id:
                refreshed_doc = db.collection("users").document(str(doc_id)).get()
                refreshed_data = refreshed_doc.to_dict() if refreshed_doc.exists else {}
                zr = refreshed_data.get("zwiftRacing") or {}
                has_stats = zr.get("max30Rating") not in (None, "N/A", "")

                if is_newly_registered or not has_stats:
                    stored_now = False
                    try:
                        stored_now = _enrich_user_with_zwiftracing(str(doc_id), str(zwift_id))
                    except Exception as enrich_err:
                        logger.warning("Inline ZwiftRacing enrichment failed for %s: %s", doc_id, enrich_err)

                    if not stored_now:
                        stats_queue.enqueue(str(doc_id), str(zwift_id), rider_label=str(zwift_id or doc_id))

        return (
            jsonify(
                {
                    "message": "Progress saved"
                    if is_draft
                    else ("Profile updated" if not is_newly_registered else "Signup successful"),
                    "verified": not is_draft,
                    "draft": is_draft,
                    "user": {"name": name, "zwiftId": zwift_id},
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("Signup Error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/consents", methods=["POST"])
def update_consents():
    """Update policy/consent acceptances without changing registration status."""
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        body, err = parse_body(UpdateConsentsRequest, request.get_json(silent=True) or {})
        if err:
            return err
        accepted_data_policy = body.acceptedDataPolicy
        accepted_public_results = body.acceptedPublicResults
        data_policy_version = body.dataPolicyVersion
        public_results_consent_version = body.publicResultsConsentVersion

        try:
            required_versions = get_policy_meta(db)
        except PolicyError as e:
            return jsonify({"message": e.message}), e.status_code
        required_data_policy = required_versions.get(POLICY_DATA_POLICY, {}).get("requiredVersion")
        required_public = required_versions.get(POLICY_PUBLIC_RESULTS, {}).get("requiredVersion")

        if not accepted_data_policy or data_policy_version != required_data_policy:
            return jsonify({"message": "You must accept the latest data policy."}), 400
        if not accepted_public_results or public_results_consent_version != required_public:
            return jsonify({"message": "You must accept the latest public results consent."}), 400

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        doc_id = user.id if user else uid

        updates = {
            "updatedAt": firestore.SERVER_TIMESTAMP,
            "registration": {
                "dataPolicy": {"version": data_policy_version, "acceptedAt": firestore.SERVER_TIMESTAMP},
                "publicResultsConsent": {
                    "version": public_results_consent_version,
                    "acceptedAt": firestore.SERVER_TIMESTAMP,
                },
                "status": "complete",
            },
        }
        updates = with_schema_version(updates)
        log_schema_issues(logger, f"users/{doc_id} (consents)", validate_user_doc(updates, partial=True))

        db.collection("users").document(str(doc_id)).set(updates, merge=True)
        return jsonify({"message": "Consents updated"}), 200
    except Exception as e:
        logger.error("Consents Error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/welcome-seen", methods=["POST"])
def set_welcome_seen():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        payload = with_schema_version({"welcomeSeen": True})
        if not user:
            log_schema_issues(logger, f"users/{uid} (welcomeSeen)", validate_user_doc(payload, partial=True))
            db.collection("users").document(uid).set(payload, merge=True)
        else:
            log_schema_issues(logger, f"users/{user.id} (welcomeSeen)", validate_user_doc(payload, partial=True))
            db.collection("users").document(str(user.id)).set(payload, merge=True)

        return jsonify({"message": "Updated"}), 200
    except Exception as e:
        logger.error("Welcome-seen Error: %s", e)
        return jsonify({"message": str(e)}), 500


def _serialize_optional_timestamp(value) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value)


def _notification_state_payload(user, uid: str) -> dict:
    """Build notification-state JSON for the authenticated user."""
    latest_published_post_id = _latest_published_post_id()
    latest_dr_failed_at = None
    latest_sw_flagged_at = None
    dr_report_seen_at = None
    sw_report_seen_at = None
    last_read_news_post_id = None
    trainer_requires_dr = False

    doc_id = str(user.id) if user else uid
    user_doc = db.collection("users").document(doc_id).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}

    last_read_news_post_id = user_data.get("lastReadNewsPostId")
    dr_report_seen_at = _serialize_optional_timestamp(user_data.get("drReportSeenAt"))
    sw_report_seen_at = _serialize_optional_timestamp(user_data.get("swReportSeenAt"))

    trainer_name = ((user_data.get("equipment") or {}).get("trainer") or "") if user_data else ""
    if not trainer_name and user:
        trainer_name = user.trainer or ""
    trainer_requires_dr = _trainer_requires_dual_recording(trainer_name)

    if user and user.zwift_id:
        zwift_id = str(user.zwift_id)
        all_verifications = [
            d.to_dict() or {}
            for d in db.collection_group("dr_verifications").where("zwiftId", "==", zwift_id).stream()
        ]

        failed = [v for v in all_verifications if v.get("status") == "failed" and v.get("verifiedAt")]
        if failed:
            latest_dr_failed_at = max(v["verifiedAt"] for v in failed)

        sw_timestamps = [_sw_flagged_timestamp(v) for v in all_verifications]
        sw_timestamps = [t for t in sw_timestamps if t]
        if sw_timestamps:
            latest_sw_flagged_at = max(sw_timestamps)

    return {
        "latestDrFailedAt": latest_dr_failed_at,
        "drReportSeenAt": dr_report_seen_at,
        "latestSwFlaggedAt": latest_sw_flagged_at,
        "swReportSeenAt": sw_report_seen_at,
        "latestPublishedPostId": latest_published_post_id,
        "lastReadNewsPostId": last_read_news_post_id,
        "trainerRequiresDualRecording": trainer_requires_dr,
    }


@users_bp.route("/profile/notification-state", methods=["GET"])
def get_notification_state():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        return jsonify(_notification_state_payload(user, uid)), 200
    except Exception as e:
        logger.error("Notification state error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/profile/news-read", methods=["POST"])
def mark_news_read():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        body, err = parse_body(MarkNewsReadRequest, request.get_json(silent=True) or {})
        if err:
            return err

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        doc_id = str(user.id) if user else uid
        db.collection("users").document(doc_id).set(
            {"lastReadNewsPostId": body.postId}, merge=True
        )
        return jsonify({"ok": True}), 200
    except Exception as e:
        logger.error("mark_news_read error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/profile/dr-report-seen", methods=["POST"])
def mark_dr_report_seen():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        doc_id = str(user.id) if user else uid
        db.collection("users").document(doc_id).set(
            {"drReportSeenAt": firestore.SERVER_TIMESTAMP}, merge=True
        )
        return jsonify({"ok": True}), 200
    except Exception as e:
        logger.error("mark_dr_report_seen error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/profile/sw-report-seen", methods=["POST"])
def mark_sw_report_seen():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        doc_id = str(user.id) if user else uid
        db.collection("users").document(doc_id).set(
            {"swReportSeenAt": firestore.SERVER_TIMESTAMP}, merge=True
        )
        return jsonify({"ok": True}), 200
    except Exception as e:
        logger.error("mark_sw_report_seen error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/profile/dr-verifications", methods=["GET"])
def get_profile_dr_verifications():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code
        uid = decoded_token["uid"]

        if not db:
            return jsonify({"message": "Database not available"}), 500

        user = UserService.get_user_by_auth_uid(uid)
        if not user or not user.zwift_id:
            return jsonify({"verifications": []}), 200

        zwift_id = str(user.zwift_id)
        docs = list(
            db.collection_group("dr_verifications").where("zwiftId", "==", zwift_id).stream()
        )
        verifications = sorted(
            [d.to_dict() or {} for d in docs],
            key=lambda v: v.get("verifiedAt") or "",
            reverse=True,
        )[:50]

        return jsonify({"verifications": verifications}), 200
    except Exception as e:
        logger.error("get_profile_dr_verifications error: %s", e)
        return jsonify({"message": str(e)}), 500


@users_bp.route("/category/select", methods=["POST"])
def select_category():
    """Allow fully registered rider to self-select liga category."""
    try:
        decoded_token = verify_user_token(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    uid = decoded_token["uid"]
    if not db:
        return jsonify({"message": "Database not available"}), 500

    user = UserService.get_user_by_auth_uid(uid)
    if not user or not user.is_registered:
        return jsonify({"message": "User not registered"}), 403

    body, err = parse_body(SelectCategoryRequest, request.get_json(silent=True) or {})
    if err:
        return err
    chosen = body.category.strip()

    cat_names = [name for name, _, _ in ZR_CATEGORIES]
    if chosen not in cat_names:
        return jsonify({"message": f"Unknown category: {chosen}"}), 400

    existing_lc = user._data.get("ligaCategory") or {}
    if existing_lc.get("locked"):
        return jsonify({"message": "Din kategori er låst efter gennemført løb. Kontakt admin for at rykke op."}), 403

    auto = existing_lc.get("autoAssigned") or {}
    auto_cat = auto.get("category")

    def cat_index(name):
        try:
            return cat_names.index(name)
        except ValueError:
            return len(cat_names)

    if auto_cat and cat_index(chosen) > cat_index(auto_cat):
        return jsonify({"message": f"Du kan ikke vælge en lavere kategori end din auto-tildelte ({auto_cat})."}), 400

    doc_id = str(user.id)
    db.collection("users").document(doc_id).update(
        {
            "ligaCategory.selfSelected": {
                "category": chosen,
                "selfSelectedAt": firestore.SERVER_TIMESTAMP,
            }
        }
    )

    return jsonify({"message": f"Kategori opdateret til {chosen}", "ligaCategory": chosen}), 200

