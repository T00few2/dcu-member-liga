"""Compare derived finish times against official Zwift race-results.

Audit only. Never overwrites scored finishTime or finishRank.
"""
from __future__ import annotations

from typing import Any

from services.results.constants import RACE_STATUS_FIN

ISSUE_DURATION_MISMATCH = "duration_mismatch"
ISSUE_MISSING_IN_OFFICIAL = "missing_in_official"
ISSUE_MISSING_IN_DERIVED = "missing_in_derived"
ISSUE_MISSING_ACTIVITY_ID = "missing_activity_id"
ISSUE_FETCH_ERROR = "fetch_error"

STATUS_ALIGNED = "aligned"
STATUS_MISMATCH = "mismatch"
STATUS_UNAVAILABLE = "unavailable"


def _as_int(value: Any) -> int | None:
    if value is None or value == "":
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def collect_derived_finishers(results: dict[str, list[dict[str, Any]]] | None) -> list[dict[str, Any]]:
    derived: list[dict[str, Any]] = []
    for category, riders in (results or {}).items():
        for rider in riders or []:
            status = str(rider.get("raceStatus") or "").strip().upper()
            finish_time = _as_int(rider.get("finishTime")) or 0
            is_fin = status == RACE_STATUS_FIN or (not status and finish_time > 0)
            if not is_fin:
                continue
            derived.append(
                {
                    "category": str(category),
                    "name": rider.get("name") or "",
                    "zwiftId": str(rider.get("zwiftId") or "").strip(),
                    "activityId": str(rider.get("activityId") or "").strip(),
                    "finishTime": finish_time,
                    "raceStatus": status or RACE_STATUS_FIN,
                }
            )
    return derived


def _official_activity_id(entry: dict[str, Any]) -> str:
    activity = entry.get("activityData") if isinstance(entry.get("activityData"), dict) else {}
    return str(activity.get("activityId") or "").strip()


def _official_duration_ms(entry: dict[str, Any]) -> int | None:
    activity = entry.get("activityData") if isinstance(entry.get("activityData"), dict) else {}
    return _as_int(activity.get("durationInMilliseconds"))


def _lookup_registered(registered_riders: dict[str, Any], *keys: str) -> dict[str, Any] | None:
    for key in keys:
        if key and key in registered_riders:
            return registered_riders[key]
    return None


def compare_derived_to_official(
    derived_finishers: list[dict[str, Any]],
    official_entries: list[dict[str, Any]],
    registered_riders: dict[str, Any] | None = None,
    fetch_errors: list[str] | None = None,
    subgroup_count: int = 0,
) -> dict[str, Any]:
    """
    Compare derived FIN rows to official race-results entries.

    Match order: activityId, then registered userId/zwiftId.
    Unregistered official finishers are ignored.
    Stored DNFs missing from official are expected and not flagged.
    """
    registered = registered_riders or {}
    issues: list[dict[str, Any]] = []
    aligned_count = 0
    matched_derived: set[int] = set()
    matched_official: set[int] = set()

    official_by_activity: dict[str, tuple[int, dict[str, Any]]] = {}
    for idx, entry in enumerate(official_entries):
        activity_id = _official_activity_id(entry)
        if activity_id and activity_id not in official_by_activity:
            official_by_activity[activity_id] = (idx, entry)

    for d_idx, derived in enumerate(derived_finishers):
        activity_id = derived["activityId"]
        if not activity_id:
            issues.append(
                {
                    "type": ISSUE_MISSING_ACTIVITY_ID,
                    "name": derived["name"],
                    "zwiftId": derived["zwiftId"],
                    "category": derived["category"],
                    "derivedFinishTime": derived["finishTime"],
                }
            )
            continue
        found = official_by_activity.get(activity_id)
        if not found:
            issues.append(
                {
                    "type": ISSUE_MISSING_IN_OFFICIAL,
                    "name": derived["name"],
                    "zwiftId": derived["zwiftId"],
                    "activityId": activity_id,
                    "category": derived["category"],
                    "derivedFinishTime": derived["finishTime"],
                }
            )
            continue
        o_idx, official = found
        official_duration = _official_duration_ms(official)
        matched_derived.add(d_idx)
        matched_official.add(o_idx)
        if official_duration == derived["finishTime"]:
            aligned_count += 1
            continue
        issues.append(
            {
                "type": ISSUE_DURATION_MISMATCH,
                "name": derived["name"],
                "zwiftId": derived["zwiftId"],
                "activityId": activity_id,
                "category": derived["category"],
                "derivedFinishTime": derived["finishTime"],
                "officialDuration": official_duration,
                "deltaMs": (
                    official_duration - derived["finishTime"]
                    if official_duration is not None
                    else None
                ),
                "officialRank": official.get("rank"),
            }
        )

    derived_by_zwift_id = {
        row["zwiftId"]: (idx, row)
        for idx, row in enumerate(derived_finishers)
        if row["zwiftId"]
    }

    for o_idx, official in enumerate(official_entries):
        if o_idx in matched_official:
            continue
        user_id = str(official.get("userId") or "").strip()
        rider = _lookup_registered(registered, user_id)
        if not rider:
            continue
        zwift_id = str(rider.get("zwiftId") or user_id).strip()
        found_derived = derived_by_zwift_id.get(zwift_id)
        if found_derived is None:
            issues.append(
                {
                    "type": ISSUE_MISSING_IN_DERIVED,
                    "name": rider.get("name") or "",
                    "zwiftId": zwift_id,
                    "activityId": _official_activity_id(official),
                    "officialDuration": _official_duration_ms(official),
                    "officialRank": official.get("rank"),
                }
            )
            continue
        d_idx, derived = found_derived
        if d_idx in matched_derived:
            continue
        official_duration = _official_duration_ms(official)
        matched_derived.add(d_idx)
        matched_official.add(o_idx)
        if official_duration == derived["finishTime"]:
            aligned_count += 1
            continue
        issues.append(
            {
                "type": ISSUE_DURATION_MISMATCH,
                "name": derived["name"],
                "zwiftId": derived["zwiftId"],
                "activityId": derived["activityId"] or _official_activity_id(official),
                "category": derived["category"],
                "derivedFinishTime": derived["finishTime"],
                "officialDuration": official_duration,
                "deltaMs": (
                    official_duration - derived["finishTime"]
                    if official_duration is not None
                    else None
                ),
                "officialRank": official.get("rank"),
            }
        )

    for message in fetch_errors or []:
        issues.append({"type": ISSUE_FETCH_ERROR, "detail": message})

    compared_count = len(derived_finishers)
    official_count = len(official_entries)
    if fetch_errors and official_count == 0:
        status = STATUS_UNAVAILABLE
        summary = (
            "Finish audit unavailable: could not fetch official race-results "
            f"({len(fetch_errors)} subgroup error(s))."
        )
    elif compared_count == 0 and official_count == 0:
        status = STATUS_UNAVAILABLE
        summary = "Finish audit skipped: no derived finishers or official race-results to compare."
    elif issues:
        status = STATUS_MISMATCH
        summary = (
            f"Finish audit found {len(issues)} issue(s): "
            f"{aligned_count}/{compared_count} derived finishers match official times."
        )
    else:
        status = STATUS_ALIGNED
        summary = (
            f"Finish audit aligned: official race-results match derived finish times "
            f"for {aligned_count} finisher(s) across {subgroup_count} subgroup(s)."
        )

    return {
        "status": status,
        "summary": summary,
        "comparedCount": compared_count,
        "alignedCount": aligned_count,
        "officialEntryCount": official_count,
        "subgroupCount": subgroup_count,
        "issues": issues,
    }
