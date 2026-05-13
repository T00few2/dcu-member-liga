from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def resolve_finish_time_ms(entry: dict[str, Any], subgroup_start_time: datetime | None) -> int:
    """
    Resolve race finish elapsed time in milliseconds for a segment-result entry.

    IMPORTANT: durationInMilliseconds in official segment-results is segment effort
    duration, not total race elapsed time. Use endDate - subgroup start when
    subgroup start time is available.
    """
    raw = entry.get("_officialSegmentResult") or {}
    duration_ms = int(entry.get("activityData", {}).get("durationInMilliseconds", 0) or 0)
    if not subgroup_start_time:
        return duration_ms

    start_dt = subgroup_start_time
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)

    end_date_raw = str(raw.get("endDate") or "").strip()
    if end_date_raw:
        try:
            end_dt = datetime.fromisoformat(end_date_raw.replace("Z", "+00:00"))
        except ValueError:
            try:
                end_dt = datetime.strptime(end_date_raw, "%Y-%m-%dT%H:%M:%S.%f%z")
            except ValueError:
                end_dt = None
        if end_dt is not None:
            if end_dt.tzinfo is None:
                end_dt = end_dt.replace(tzinfo=timezone.utc)
            elapsed = int((end_dt - start_dt).total_seconds() * 1000)
            if elapsed > 0:
                return elapsed
    return duration_ms
