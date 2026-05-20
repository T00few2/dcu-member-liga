from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def _parse_end_date(end_date_raw: str) -> datetime | None:
    text = str(end_date_raw or "").strip()
    if not text:
        return None

    # Common ISO variants from official segment-results payloads.
    candidates = [text]
    if text.endswith("Z"):
        candidates.append(text[:-1] + "+00:00")
    elif len(text) >= 5 and (text[-5] in {"+", "-"}) and text[-3] != ":":
        # Convert +0000/-0500 to +00:00/-05:00 for fromisoformat.
        candidates.append(f"{text[:-5]}{text[-5:-2]}:{text[-2:]}")

    for candidate in candidates:
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            pass

    formats = (
        "%Y-%m-%dT%H:%M:%S.%f%z",
        "%Y-%m-%dT%H:%M:%S%z",
        "%Y-%m-%dT%H:%M:%S.%f",
        "%Y-%m-%dT%H:%M:%S",
    )
    for fmt in formats:
        try:
            parsed = datetime.strptime(text, fmt)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=timezone.utc)
            return parsed
        except ValueError:
            continue
    return None


def resolve_finish_time_ms(entry: dict[str, Any], subgroup_start_time: datetime | None) -> int:
    """
    Resolve race finish elapsed time in milliseconds for a segment-result entry.

    IMPORTANT: durationInMilliseconds in official segment-results is segment effort
    duration, not total race elapsed time. Never use segment duration as finish
    time. Valid finish time is derived from endWorldTime/endDate and start time.
    """
    raw = entry.get("_officialSegmentResult") or {}
    if not subgroup_start_time:
        return 0

    start_dt = subgroup_start_time
    if start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)
    start_ms = int(start_dt.timestamp() * 1000)

    # Primary source: official segment world time from Zwift event payload.
    # In practice this is epoch seconds; support epoch milliseconds defensively.
    end_world_time = int(raw.get("endWorldTime", 0) or 0)
    if end_world_time > 0:
        end_ms = end_world_time if end_world_time >= 1_000_000_000_000 else end_world_time * 1000
        elapsed = end_ms - start_ms
        # Ignore implausible deltas (typically indicates non-Unix world-time basis).
        if 0 < elapsed <= 12 * 60 * 60 * 1000:
            return elapsed

    end_dt = _parse_end_date(raw.get("endDate"))
    if end_dt is not None:
        if end_dt.tzinfo is None:
            end_dt = end_dt.replace(tzinfo=timezone.utc)
        elapsed = int((end_dt - start_dt).total_seconds() * 1000)
        if elapsed > 0:
            return elapsed
    return 0
