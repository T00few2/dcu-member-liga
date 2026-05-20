from __future__ import annotations

import logging
from collections import defaultdict
from typing import Any, Callable


logger = logging.getLogger("FinishSelector")


def select_finish_entries_from_route_instances(
    segmented: dict[str, list[dict[str, Any]]],
    route_segments: list[dict[str, Any]] | None,
    configured_sprints: list[dict[str, Any]] | None,
    entry_sort_key: Callable[[dict[str, Any]], tuple[int, int]],
) -> list[dict[str, Any]]:
    """
    Deterministically pick finish entries from route segment instances.

    Uses the same id+count(+direction,+lap) segment instance model as route/sprint
    configuration. If all race-lap route segments are configured as sprint
    segments, the last race-lap segment instance is treated as finish.
    """
    if not segmented or not route_segments:
        return []

    def _norm_direction(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"reverse", "rev", "r"}:
            return "reverse"
        return "forward"

    sprint_instances: set[tuple[str, int, str]] = set()
    sprint_instances_wild_dir: set[tuple[str, int]] = set()
    sprint_instances_by_lap: set[tuple[str, int, str]] = set()
    sprint_instances_by_lap_wild_dir: set[tuple[str, int]] = set()

    for sprint in configured_sprints or []:
        sid = str(sprint.get("id") or "").strip()
        if not sid:
            continue
        try:
            count = int(sprint.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        if count < 1:
            count = 1

        direction_raw = sprint.get("direction")
        if direction_raw is None or str(direction_raw).strip() == "":
            sprint_instances_wild_dir.add((sid, count))
        else:
            sprint_instances.add((sid, count, _norm_direction(direction_raw)))

        lap_raw = sprint.get("lap")
        try:
            lap = int(lap_raw) if lap_raw is not None else 0
        except (TypeError, ValueError):
            lap = 0
        if lap > 0:
            if direction_raw is None or str(direction_raw).strip() == "":
                sprint_instances_by_lap_wild_dir.add((sid, lap))
            else:
                sprint_instances_by_lap.add((sid, lap, _norm_direction(direction_raw)))

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
    segmented: dict[str, list[dict[str, Any]]],
    route_segments: list[dict[str, Any]] | None,
    configured_sprints: list[dict[str, Any]] | None,
) -> tuple[str, int] | None:
    """
    Resolve finish segment instance from route/sprint config without selecting riders.

    Returns (segment_id, segment_count) when a deterministic finish segment candidate
    can be identified from route instances. Returns None for true mapping/config
    failures where finish cannot be resolved.
    """
    if not segmented or not route_segments:
        return None

    def _is_sprint_like_route_segment(seg: dict[str, Any]) -> bool:
        name = str(seg.get("name") or "").strip().lower()
        if not name:
            return False
        return any(token in name for token in ("sprint", "kom", "qom"))

    def _norm_direction(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"reverse", "rev", "r"}:
            return "reverse"
        return "forward"

    sprint_instances: set[tuple[str, int, str]] = set()
    sprint_instances_wild_dir: set[tuple[str, int]] = set()
    sprint_instances_by_lap: set[tuple[str, int, str]] = set()
    sprint_instances_by_lap_wild_dir: set[tuple[str, int]] = set()

    for sprint in configured_sprints or []:
        sid = str(sprint.get("id") or "").strip()
        if not sid:
            continue
        try:
            count = int(sprint.get("count") or 1)
        except (TypeError, ValueError):
            count = 1
        if count < 1:
            count = 1

        direction_raw = sprint.get("direction")
        if direction_raw is None or str(direction_raw).strip() == "":
            sprint_instances_wild_dir.add((sid, count))
        else:
            sprint_instances.add((sid, count, _norm_direction(direction_raw)))

        lap_raw = sprint.get("lap")
        try:
            lap = int(lap_raw) if lap_raw is not None else 0
        except (TypeError, ValueError):
            lap = 0
        if lap > 0:
            if direction_raw is None or str(direction_raw).strip() == "":
                sprint_instances_by_lap_wild_dir.add((sid, lap))
            else:
                sprint_instances_by_lap.add((sid, lap, _norm_direction(direction_raw)))

    finish_candidate: tuple[str, int] | None = None
    all_sprints_candidate: tuple[str, int] | None = None

    for seg in reversed(route_segments):
        sid = str(seg.get("id") or "").strip()
        if not sid:
            continue
        lap = int(seg.get("lap") or 0)
        if lap < 1:
            continue
        try:
            seg_count = int(seg.get("count") or 1)
        except (TypeError, ValueError):
            seg_count = 1
        if seg_count < 1:
            seg_count = 1

        seg_direction = _norm_direction(seg.get("direction"))
        is_configured_sprint = False
        if (sid, seg_count) in sprint_instances_wild_dir:
            is_configured_sprint = True
        elif (sid, seg_count, seg_direction) in sprint_instances:
            is_configured_sprint = True
        elif lap > 0 and (sid, lap) in sprint_instances_by_lap_wild_dir:
            is_configured_sprint = True
        elif lap > 0 and (sid, lap, seg_direction) in sprint_instances_by_lap:
            is_configured_sprint = True

        # Some routes include additional sprint/KOM arches that are not configured
        # for points. They must still be excluded from finish-line inference.
        if _is_sprint_like_route_segment(seg):
            is_configured_sprint = True

        if is_configured_sprint:
            # Keep the most recent configured sprint instance as a fallback
            # only when every race-lap segment instance is configured sprint.
            # Do not require live crossings here: in-race provisional runs may
            # have crossed only early route instances.
            if all_sprints_candidate is None:
                all_sprints_candidate = (sid, seg_count)
            continue

        finish_candidate = (sid, seg_count)
        break

    return finish_candidate or all_sprints_candidate
