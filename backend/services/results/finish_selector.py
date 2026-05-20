from __future__ import annotations

import logging
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Callable


logger = logging.getLogger("FinishSelector")


def select_finish_entries_from_route_instances(
    segmented: dict[str, list[dict[str, Any]]],
    route_segments: list[dict[str, Any]] | None,
    route_profile_segments: list[dict[str, Any]] | None,
    configured_sprints: list[dict[str, Any]] | None,
    entry_sort_key: Callable[[dict[str, Any]], tuple[int, int]],
    subgroup_start_time: datetime | None = None,
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
        route_profile_segments=route_profile_segments,
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

    start_dt = subgroup_start_time
    if start_dt is not None and start_dt.tzinfo is None:
        start_dt = start_dt.replace(tzinfo=timezone.utc)

    def _parse_end_date(raw_value: Any) -> datetime | None:
        text = str(raw_value or "").strip()
        if not text:
            return None
        candidates = [text]
        if text.endswith("Z"):
            candidates.append(text[:-1] + "+00:00")
        elif len(text) >= 5 and (text[-5] in {"+", "-"}) and text[-3] != ":":
            candidates.append(f"{text[:-5]}{text[-5:-2]}:{text[-2:]}")
        for candidate in candidates:
            try:
                parsed = datetime.fromisoformat(candidate)
                if parsed.tzinfo is None:
                    parsed = parsed.replace(tzinfo=timezone.utc)
                return parsed
            except ValueError:
                continue
        return None

    selected: list[dict[str, Any]] = []
    for rider_entries in by_rider.values():
        rider_entries_sorted = sorted(rider_entries, key=entry_sort_key)
        if start_dt is not None:
            rider_entries_after_start = []
            for entry in rider_entries_sorted:
                raw = entry.get("_officialSegmentResult") or {}
                end_dt = _parse_end_date(raw.get("endDate"))
                # If endDate is missing/invalid, keep entry to avoid dropping
                # legitimate crossings from sparse payloads.
                if end_dt is None or end_dt >= start_dt:
                    rider_entries_after_start.append(entry)
            if rider_entries_after_start and len(rider_entries_after_start) >= finish_seg_count:
                # Finish line can be crossed in lead-in and race laps. We always
                # want the final crossing on the resolved finish segment.
                selected.append(rider_entries_after_start[-1])
                continue
        if start_dt is None and len(rider_entries_sorted) >= finish_seg_count:
            selected.append(rider_entries_sorted[finish_seg_count - 1])

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
    route_profile_segments: list[dict[str, Any]] | None,
    configured_sprints: list[dict[str, Any]] | None,
) -> tuple[str, int] | None:
    """
    Resolve finish segment instance from ordered route instances.

    Primary source: elevation_cache.profileSegments ordering.
    Fallback source: route segment ordering from Zwift game route manifest.
    """
    if not segmented or not route_segments:
        return None

    def _norm_name(value: Any) -> str:
        raw = str(value or "").strip().lower()
        raw = raw.replace(" rev.", "").replace(" rev", "").replace(" reverse", "")
        cleaned = "".join(ch if ch.isalnum() or ch.isspace() else " " for ch in raw)
        return " ".join(cleaned.split())

    def _norm_direction(value: Any) -> str:
        raw = str(value or "").strip().lower()
        if raw in {"reverse", "rev", "r"}:
            return "reverse"
        return "forward"

    # 1) Primary: elevation_cache profile ordering (last segment is finish)
    if route_profile_segments:
        profile_sorted = sorted(
            [s for s in route_profile_segments if isinstance(s, dict)],
            key=lambda s: (
                min(float(s.get("fromKm") or 0.0), float(s.get("toKm") or 0.0)),
                max(float(s.get("fromKm") or 0.0), float(s.get("toKm") or 0.0)),
            ),
        )
        if profile_sorted:
            last_profile = profile_sorted[-1]
            target_name = _norm_name(last_profile.get("name"))
            target_dir = _norm_direction(last_profile.get("direction"))

            # Occurrence index from profile ordering (handles duplicated names like
            # lead-in + race-lap appearances of the same segment).
            profile_occurrence = sum(
                1
                for seg in profile_sorted
                if _norm_name(seg.get("name")) == target_name
                and _norm_direction(seg.get("direction")) == target_dir
            )
            if profile_occurrence < 1:
                profile_occurrence = 1

            route_matches: list[dict[str, Any]] = []
            for seg in route_segments:
                if int(seg.get("lap") or 0) < 1:
                    continue
                if _norm_name(seg.get("name")) != target_name:
                    continue
                if _norm_direction(seg.get("direction")) != target_dir:
                    continue
                route_matches.append(seg)
            if route_matches:
                idx = min(profile_occurrence, len(route_matches)) - 1
                chosen = route_matches[idx]
                sid = str(chosen.get("id") or "").strip()
                seg_count = int(chosen.get("count") or 1)
                if sid and seg_count > 0:
                    return (sid, seg_count)

    # 2) Fallback: route ordering (existing behavior)
    del configured_sprints

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

        desired_dir = _norm_direction(seg.get("direction"))
        # Same rule as RaceCard resolvedProfileSprintsToShow:
        # count only race laps (lap >= 1), same id+direction, and up to desired count.
        on_route_occurrence = sum(
            1
            for route_seg in route_segments
            if str(route_seg.get("id") or "").strip() == sid
            and _norm_direction(route_seg.get("direction")) == desired_dir
            and (int(route_seg.get("lap") or 0) >= 1)
            and (int(route_seg.get("count") or 0) <= seg_count)
        )
        if on_route_occurrence > 0:
            return (sid, on_route_occurrence)
        return (sid, seg_count)
    return None
