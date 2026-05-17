from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from services.dual_recording_core import (
    _compute_dual_recording_for_rider,
    _extract_zwift_activity_fields,
    _iter_activities_for_user_ids,
    _is_dual_recording_required,
    _load_dr_stream_blob_result,
    _load_sw_thresholds,
    _parse_iso_utc,
    _persist_dr_verification_result,
    _resolve_activity_id_for_rider,
    _run_dr_verification_background,
)
from services.user_service import UserService
from services.zwift_tokens import get_token_doc, get_valid_access_token
from extensions import get_zwift_service


def resolve_category_event_start(race_data: dict, category: str) -> str:
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


def collect_dr_candidates_for_race(db: Any, race_data: dict) -> list[dict]:
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


def build_missing_activity_payload(race_id: str, zwift_id: str) -> dict:
    return {
        "zwiftId": zwift_id,
        "raceId": race_id,
        "status": "missing_activity",
        "verifiedAt": datetime.now(timezone.utc).isoformat(),
        "failingMetrics": [],
        "comparison": {"cpDiff": [], "avgPower": {}},
    }


def save_missing_activity_payload(db: Any, race_id: str, zwift_id: str) -> dict:
    payload = build_missing_activity_payload(race_id, zwift_id)
    (
        db.collection("races")
        .document(race_id)
        .collection("dr_verifications")
        .document(zwift_id)
        .set(payload)
    )
    return payload


def resolve_rider_category_row(race_data: dict, zwift_id: str) -> tuple[str | None, dict | None]:
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
    return target_category, rider_row


def resolve_rider_activity_id(
    db: Any,
    *,
    race_data: dict,
    zwift_id: str,
    target_category: str | None,
    preferred_activity_id: str | None = None,
) -> tuple[str | None, str]:
    user_doc = db.collection("users").document(str(zwift_id)).get()
    event_start = resolve_category_event_start(race_data, target_category or "")
    activity_id = _resolve_activity_id_for_rider(
        db=db,
        race_data=race_data,
        user_doc_data=user_doc.to_dict() or {},
        zwift_id=str(zwift_id),
        event_start=event_start,
        preferred_activity_id=preferred_activity_id,
    )
    return str(activity_id) if activity_id else None, event_start


def trigger_rider_dr_verification(
    db: Any,
    *,
    race_id: str,
    zwift_id: str,
    activity_id: str,
    event_start_iso: str | None,
    sw_thresholds: dict | None = None,
) -> None:
    _run_dr_verification_background(
        db=db,
        user_doc_id=str(zwift_id),
        zwift_id_canonical=str(zwift_id),
        activity_id=str(activity_id),
        race_id=race_id,
        event_start_iso=event_start_iso or None,
        sw_thresholds=sw_thresholds,
    )


class EventActivityError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class DualRecordingError(Exception):
    def __init__(self, message: str, status_code: int):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def get_dual_recording_result(
    *,
    db: Any,
    rider_id: str,
    zwift_activity_id: str | None,
    strava_activity_id: str | None,
    event_start_iso: str | None,
    race_id: str | None,
    logger: Any,
) -> dict:
    user = UserService.get_user_by_id(rider_id)
    if not user:
        raise DualRecordingError("User not found", 404)
    canonical_zwift_id = str(user.zwift_id or user.id or rider_id)

    if race_id:
        try:
            vdoc = (
                db.collection("races")
                .document(str(race_id))
                .collection("dr_verifications")
                .document(canonical_zwift_id)
                .get()
            )
            if vdoc.exists:
                verification = vdoc.to_dict() or {}
                stream_blob_path = str(verification.get("streamBlobPath") or "").strip()
                if stream_blob_path:
                    cached_result = _load_dr_stream_blob_result(stream_blob_path)
                    if cached_result:
                        return cached_result
        except Exception as exc:
            logger.warning("dual_recording cache lookup failed: %s", exc)

    if not zwift_activity_id:
        raise DualRecordingError("No cached DR stream found for rider/race", 404)

    result = _compute_dual_recording_for_rider(
        db,
        str(user.id),
        str(zwift_activity_id),
        event_start_iso,
        strava_activity_id,
    )
    if race_id:
        try:
            _persist_dr_verification_result(
                db=db,
                result=result,
                zwift_id_canonical=canonical_zwift_id,
                activity_id=str(zwift_activity_id),
                race_id=str(race_id),
            )
        except Exception as exc:
            logger.warning("dual_recording cache persist failed: %s", exc)
    return result


def get_event_activity_for_rider(*, db: Any, rider_id: str, event_id: str, logger: Any) -> dict:
    """
    Given a Zwift event ID, locate rider segment result and matching activity.
    Returns response payload for the route. Raises EventActivityError on 4xx-style errors.
    """
    user = UserService.get_user_by_id(rider_id)
    if not user:
        raise EventActivityError("User not found", 404)

    token_doc = get_token_doc(str(user.id))
    if not token_doc:
        raise EventActivityError("No Zwift connection found for this rider", 404)

    zwift_user_id = token_doc.get("zwiftUserId")
    if not zwift_user_id:
        raise EventActivityError("No Zwift user ID on token", 404)
    zwift_user_id_str = str(zwift_user_id)

    zwift_service = get_zwift_service()
    event_info = zwift_service.get_event_info(str(event_id))
    if not event_info:
        raise EventActivityError(f"Event {event_id} not found", 404)

    subgroups = event_info.get("eventSubgroups") or []
    if not subgroups:
        raise EventActivityError("No subgroups found for this event", 404)

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
                        entry.get("durationInMilliseconds", 0) > found_entry.get("durationInMilliseconds", 0)
                    ):
                        found_subgroup = sg
                        found_entry = entry
        if found_entry is not None:
            break

    if not found_entry:
        return {"found": False, "message": "Rider not found in any subgroup of this event"}

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

    return {
        "found": True,
        "eventStartIso": event_start_iso,
        "subgroupLabel": subgroup_label,
        "riderResult": {"durationSec": duration_sec, "avgWatts": avg_watts},
        "zwiftActivity": zwift_activity,
    }

