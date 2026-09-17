from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Callable


logger = logging.getLogger("FinishSelector")


def last_race_lap_banner(
    route_segments: list[dict[str, Any]] | None,
) -> tuple[str, int] | None:
    """
    Finish banner as shown in race config: last race-lap segment (lap >= 1).

    Does not require the banner to appear in Zwift segment-results. When the
    finish arch is not an event sprint, Zwift often omits those crossings.
    """
    last: tuple[str, int] | None = None
    for seg in route_segments or []:
        sid = str(seg.get("id") or "").strip()
        if not sid:
            continue
        try:
            lap = int(seg.get("lap") or 0)
        except (TypeError, ValueError):
            lap = 0
        if lap < 1:
            continue
        try:
            seg_count = int(seg.get("count") or 1)
        except (TypeError, ValueError):
            seg_count = 1
        if seg_count < 1:
            seg_count = 1
        last = (sid, seg_count)
    return last


def finish_banner_instance_missing(
    intended: tuple[str, int] | None,
    crossings: list[dict[str, Any]] | None,
) -> bool:
    """True when the last race-lap banner occurrence is absent from segment-results.

    Earlier FAL/sprint crossings of the same segment id do not count as the finish.
    Zwift omits the finish arch when it is not configured as an event sprint.
    """
    if not intended:
        return False
    sid, required_count = intended
    if required_count < 1:
        return False
    by_rider: dict[str, int] = {}
    for entry in crossings or []:
        if not isinstance(entry, dict):
            continue
        raw = entry.get("_officialSegmentResult") or {}
        if not isinstance(raw, dict):
            raw = {}
        if str(raw.get("segmentId") or "").strip() != sid:
            continue
        rider = str(
            (entry.get("profileData") or {}).get("id")
            or entry.get("profileId")
            or raw.get("userId")
            or ""
        ).strip()
        if not rider:
            continue
        by_rider[rider] = by_rider.get(rider, 0) + 1
    if not by_rider:
        return True
    return max(by_rider.values()) < required_count


def select_finish_entries_from_route_instances(
    segmented: dict[str, list[dict[str, Any]]],
    route_segments: list[dict[str, Any]] | None,
    configured_sprints: list[dict[str, Any]] | None,
    entry_sort_key: Callable[[dict[str, Any]], tuple[int, int]],
) -> list[dict[str, Any]]:
    """
    Deterministically pick finish entries from route segment instances.

    Finish = last race-lap segment on the route (id + occurrence count) that
    appears in the Zwift crossings payload. That crossing may also be configured
    for sprint/FAL points.
    """
    if not segmented or not route_segments:
        return []

    chosen = resolve_finish_segment_candidate(
        segmented=segmented,
        route_segments=route_segments,
        configured_sprints=configured_sprints,
    )
    if not chosen:
        return []
    finish_seg_id, finish_seg_count = chosen

    by_rider: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for e in segmented.get(finish_seg_id, []):
        profile = e.get("profileData", {}) if isinstance(e, dict) else {}
        rider_id = str(profile.get("id") or e.get("profileId") or "")
        if rider_id:
            by_rider[rider_id].append(e)

    selected: list[dict[str, Any]] = []
    for rider_entries in by_rider.values():
        rider_entries.sort(key=entry_sort_key)
        if len(rider_entries) >= finish_seg_count:
            selected.append(rider_entries[finish_seg_count - 1])

    logger.info(
        "route-instance finish selection: segment=%s count=%s selected=%s riders_with_segment=%s",
        finish_seg_id,
        finish_seg_count,
        len(selected),
        len(by_rider),
    )

    return selected


def resolve_finish_segment_candidate(
    segmented: dict[str, list[dict[str, Any]]] | None,
    route_segments: list[dict[str, Any]] | None,
    configured_sprints: list[dict[str, Any]] | None = None,
) -> tuple[str, int] | None:
    """
    Resolve finish segment instance from route chronology.

    Finish is the last race-lap banner on the route (lap >= 1), regardless of
    which banners are configured as sprints. The banner must appear in
    ``segmented`` (Zwift reported at least one crossing for that segment id).

    ``configured_sprints`` is accepted for call-site compatibility and ignored.
    """
    _ = configured_sprints  # API compatibility only

    if not segmented or not route_segments:
        return None

    for seg in reversed(route_segments):
        sid = str(seg.get("id") or "").strip()
        if not sid or sid not in segmented:
            continue
        try:
            lap = int(seg.get("lap") or 0)
        except (TypeError, ValueError):
            lap = 0
        if lap < 1:
            continue
        try:
            seg_count = int(seg.get("count") or 1)
        except (TypeError, ValueError):
            seg_count = 1
        if seg_count < 1:
            seg_count = 1
        return (sid, seg_count)

    return None
