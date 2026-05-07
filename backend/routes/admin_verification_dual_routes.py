"""
Admin verification routes: dual-recording and event-based matching endpoints.
"""

from datetime import datetime, timezone
import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db, get_zwift_service
from routes.admin import admin_bp
from services.dual_recording_core import (
    _compute_dual_recording_for_rider,
    _extract_zwift_activity_fields,
    _iter_activities_for_user_ids,
    _is_dual_recording_required,
    _parse_iso_utc,
    _resolve_activity_id_for_rider,
    _run_dr_verification_background,
)
from services.user_service import UserService
from services.zwift_tokens import get_token_doc, get_valid_access_token

logger = logging.getLogger(__name__)


def _resolve_category_event_start(race_data: dict, category: str) -> str:
    category_event_start: dict[str, str] = {}
    for cfg in (race_data.get("eventConfiguration") or []):
        st = cfg.get("startTime") or race_data.get("date") or ""
        cat = str(cfg.get("customCategory") or "").strip()
        if cat and st:
            category_event_start[cat] = st

    for grp in (race_data.get("raceGroups") or []):
        st = grp.get("startTime") or ""
        if not st:
            continue
        for cat_cfg in (grp.get("categories") or []):
            cat = str((cat_cfg or {}).get("category") or "").strip()
            if cat and cat not in category_event_start:
                category_event_start[cat] = st

    default_event_start = race_data.get("startTime") or race_data.get("date") or ""
    return category_event_start.get(str(category), default_event_start) or default_event_start


def _collect_dr_candidates_for_race(race_data: dict) -> list[dict]:
    """Collect DR-required rider candidates from race results."""
    candidates: list[dict] = []
    seen: set[str] = set()
    results_map = race_data.get("results") or {}

    for category, riders in results_map.items():
        for rider in (riders or []):
            zwift_id = str(rider.get("zwiftId") or "").strip()
            if not zwift_id or zwift_id in seen:
                continue

            user_doc = db.collection("users").document(zwift_id).get()
            if not user_doc.exists:
                continue
            if not _is_dual_recording_required(db, zwift_id):
                continue

            seen.add(zwift_id)
            candidates.append(
                {
                    "zwiftId": zwift_id,
                    "name": str(rider.get("name") or ""),
                    "category": str(category),
                    "activityId": str(rider.get("activityId") or "").strip() or None,
                }
            )

    return candidates


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
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        token_doc = get_token_doc(str(user.id))
        if not token_doc:
            return jsonify({"message": "No Zwift connection found for this rider"}), 404

        zwift_user_id = token_doc.get("zwiftUserId")
        if not zwift_user_id:
            return jsonify({"message": "No Zwift user ID on token"}), 404
        zwift_user_id_str = str(zwift_user_id)

        zwift_service = get_zwift_service()
        event_info = zwift_service.get_event_info(str(event_id))
        if not event_info:
            return jsonify({"message": f"Event {event_id} not found"}), 404

        subgroups = event_info.get("eventSubgroups") or []
        if not subgroups:
            return jsonify({"message": "No subgroups found for this event"}), 404

        found_subgroup = None
        found_entry = None
        for sg in subgroups:
            sg_id = str(sg.get("id", ""))
            if not sg_id:
                continue
            try:
                by_segment = zwift_service.get_subgroup_all_segment_results(sg_id)
            except Exception as exc:
                logger.warning("event_activity: subgroup %s fetch failed: %s", sg_id, exc)
                continue

            for entries in by_segment.values():
                for entry in entries:
                    if str(entry.get("userId", "")) == zwift_user_id_str:
                        if found_entry is None or (
                            entry.get("durationInMilliseconds", 0)
                            > found_entry.get("durationInMilliseconds", 0)
                        ):
                            found_subgroup = sg
                            found_entry = entry
            if found_entry is not None:
                break

        if not found_entry:
            return jsonify({"found": False, "message": "Rider not found in any subgroup of this event"}), 200

        event_start_iso = found_subgroup.get("eventSubgroupStart") or ""
        subgroup_label = (
            found_subgroup.get("subgroupLabel")
            or found_subgroup.get("name")
            or found_subgroup.get("label", "")
        )
        duration_ms = found_entry.get("durationInMilliseconds", 0)
        duration_sec = int(duration_ms / 1000) if duration_ms else None
        avg_watts = found_entry.get("avgWatts")

        zwift_activity = None
        access_token = get_valid_access_token(str(user.id), get_zwift_service())

        candidate_id = found_entry.get("activityId") or found_entry.get("id")
        if candidate_id and access_token:
            try:
                act_data = get_zwift_service().get_user_activity(str(candidate_id), access_token)
                if act_data:
                    af = _extract_zwift_activity_fields(act_data)
                    zwift_activity = {
                        "activityId": str(candidate_id),
                        "startedAt": af["startedAt"],
                        "durationSec": af["durationSec"],
                        "avgWatts": af["avgWatts"],
                    }
            except Exception as exc:
                logger.debug("event_activity: segment id %s not valid activity: %s", candidate_id, exc)

        event_dt = _parse_iso_utc(event_start_iso) if event_start_iso else None
        if not zwift_activity and event_dt and db:
            best_delta = float("inf")
            for doc in _iter_activities_for_user_ids(db, [zwift_user_id_str], limit=100):
                d = doc.to_dict() or {}
                raw = d.get("data") or {}
                wf = _extract_zwift_activity_fields(raw)
                act_dt = _parse_iso_utc(wf["startedAt"]) if wf["startedAt"] else None
                if act_dt:
                    delta = abs((act_dt - event_dt).total_seconds())
                    if delta < best_delta and delta < 7200:
                        best_delta = delta
                        zwift_activity = {
                            "activityId": d.get("activityId"),
                            "startedAt": wf["startedAt"],
                            "durationSec": wf["durationSec"],
                            "avgWatts": wf["avgWatts"],
                        }

        return jsonify(
            {
                "found": True,
                "eventStartIso": event_start_iso,
                "subgroupLabel": subgroup_label,
                "riderResult": {"durationSec": duration_sec, "avgWatts": avg_watts},
                "zwiftActivity": zwift_activity,
            }
        ), 200
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

    if not zwift_activity_id:
        return jsonify({"message": "zwiftActivityId is required"}), 400

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({"message": "User not found"}), 404

        result = _compute_dual_recording_for_rider(
            db, str(user.id), zwift_activity_id, event_start_iso, strava_activity_id
        )
        return jsonify(result), 200
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

        candidates = _collect_dr_candidates_for_race(race_data)
        summary: list[dict] = []

        for candidate in candidates:
            zwift_id = str(candidate.get("zwiftId") or "")
            category = str(candidate.get("category") or "")
            activity_id = candidate.get("activityId")
            user_doc = db.collection("users").document(zwift_id).get()
            event_start = _resolve_category_event_start(race_data, category)

            if not activity_id:
                activity_id = _resolve_activity_id_for_rider(
                    db=db,
                    race_data=race_data,
                    user_doc_data=user_doc.to_dict() or {},
                    zwift_id=zwift_id,
                    event_start=event_start,
                )

            if not activity_id:
                missing_payload: dict = {
                    "zwiftId": zwift_id,
                    "raceId": race_id,
                    "status": "missing_activity",
                    "verifiedAt": datetime.now(timezone.utc).isoformat(),
                    "failingMetrics": [],
                    "comparison": {"cpDiff": [], "avgPower": {}},
                }
                (
                    db.collection("races")
                    .document(race_id)
                    .collection("dr_verifications")
                    .document(zwift_id)
                    .set(missing_payload)
                )
                summary.append({"zwiftId": zwift_id, "status": "missing_activity"})
                continue

            _run_dr_verification_background(
                db, zwift_id, zwift_id, str(activity_id), race_id, event_start or None
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
        riders = _collect_dr_candidates_for_race(race_data)
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

        target_category = None
        rider_row = None
        results_map = race_data.get("results") or {}
        for category, riders in results_map.items():
            for rider in (riders or []):
                if str(rider.get("zwiftId") or "").strip() == str(zwift_id):
                    target_category = str(category)
                    rider_row = rider
                    break
            if rider_row is not None:
                break

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
        event_start = _resolve_category_event_start(race_data, target_category or "")
        activity_id = _resolve_activity_id_for_rider(
            db=db,
            race_data=race_data,
            user_doc_data=user_doc.to_dict() or {},
            zwift_id=str(zwift_id),
            event_start=event_start,
            preferred_activity_id=preferred_activity_id,
        )

        if not activity_id:
            missing_payload: dict = {
                "zwiftId": str(zwift_id),
                "raceId": race_id,
                "status": "missing_activity",
                "verifiedAt": datetime.now(timezone.utc).isoformat(),
                "failingMetrics": [],
                "comparison": {"cpDiff": [], "avgPower": {}},
            }
            (
                db.collection("races")
                .document(race_id)
                .collection("dr_verifications")
                .document(str(zwift_id))
                .set(missing_payload)
            )
            return jsonify({
                "ok": True,
                "message": "No matching Zwift activity found for this race.",
                "verification": missing_payload,
            }), 200

        _run_dr_verification_background(
            db=db,
            user_doc_id=str(zwift_id),
            zwift_id_canonical=str(zwift_id),
            activity_id=str(activity_id),
            race_id=race_id,
            event_start_iso=event_start or None,
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
