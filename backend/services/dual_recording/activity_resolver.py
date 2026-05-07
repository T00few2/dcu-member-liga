from __future__ import annotations

from services.dual_recording.time_series import _parse_iso_utc
from services.dual_recording.zwift import _extract_zwift_activity_fields
from services.zwift_tokens import get_token_doc


def _collect_candidate_user_ids(db: object, user_doc_data: dict, zwift_id: str) -> list[str]:
    candidate_user_ids: list[str] = []

    connections = user_doc_data.get("connections") or {}
    zwift_connection = connections.get("zwift") or {}
    for candidate in (
        user_doc_data.get("zwiftUserId"),
        user_doc_data.get("zwiftId"),
        user_doc_data.get("zwiftUuid"),
        user_doc_data.get("zwiftUUID"),
        zwift_connection.get("userId"),
        zwift_connection.get("profileId"),
        zwift_id,
    ):
        c = str(candidate or "").strip()
        if c and c not in candidate_user_ids:
            candidate_user_ids.append(c)

    token_doc_data = get_token_doc(str(zwift_id))
    if token_doc_data:
        token_uid = str(token_doc_data.get("zwiftUserId") or "").strip()
        if token_uid and token_uid not in candidate_user_ids:
            candidate_user_ids.append(token_uid)

    return candidate_user_ids


def _iter_activities_for_user_ids(db: object, candidate_user_ids: list[str], limit: int = 200):
    seen_doc_ids: set[str] = set()
    for user_id in candidate_user_ids:
        query_values: list[object] = [user_id]
        if user_id.isdigit():
            query_values.append(int(user_id))

        for query_value in query_values:
            docs = (
                db.collection("zwift_activities")
                .where("userId", "==", query_value)
                .limit(limit)
                .stream()
            )
            for doc in docs:
                if doc.id in seen_doc_ids:
                    continue
                seen_doc_ids.add(doc.id)
                yield doc


def _resolve_activity_id_for_rider(
    db: object,
    race_data: dict,
    user_doc_data: dict,
    zwift_id: str,
    event_start: str,
    preferred_activity_id: str | None = None,
) -> str | None:
    if preferred_activity_id:
        return str(preferred_activity_id)

    candidate_user_ids = _collect_candidate_user_ids(db, user_doc_data, zwift_id)

    race_event_ids: set[str] = set()
    if race_data.get("eventId"):
        race_event_ids.add(str(race_data.get("eventId")))
    for linked in (race_data.get("linkedEventIds") or []):
        if linked:
            race_event_ids.add(str(linked))

    event_dt = _parse_iso_utc(event_start)
    best_event_match: tuple[float, str] | None = None
    best_time_delta = float("inf")
    best_time_activity_id: str | None = None

    for doc in _iter_activities_for_user_ids(db, candidate_user_ids):
        d = doc.to_dict() or {}
        activity_doc_id = str(d.get("activityId") or "").strip()
        if not activity_doc_id:
            continue
        raw = d.get("data") or {}

        raw_event_id = str(raw.get("eventId") or "").strip()
        if race_event_ids and raw_event_id and raw_event_id in race_event_ids:
            wf = _extract_zwift_activity_fields(raw)
            duration_sec = float(wf.get("durationSec") or 0.0)
            if best_event_match is None or duration_sec > best_event_match[0]:
                best_event_match = (duration_sec, activity_doc_id)

        if event_dt:
            wf = _extract_zwift_activity_fields(raw)
            act_dt = _parse_iso_utc(wf["startedAt"]) if wf["startedAt"] else None
            if act_dt:
                delta = abs((act_dt - event_dt).total_seconds())
                if delta < best_time_delta:
                    best_time_delta = delta
                    best_time_activity_id = activity_doc_id

    if best_event_match:
        return best_event_match[1]
    if best_time_activity_id and best_time_delta <= 4 * 3600:
        return best_time_activity_id
    return None
