"""Arc-length positions for every segment a route actually rides.

zwift-data `segmentsOnRoute` only includes segments it can place (typically those
with a Strava segment). The game manifest still rides the others — Itza Party's
reverse sprints are the example. Callers calibrate these spline positions onto
catalog kilometres using the segments that do have coordinates.
"""

from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from typing import Any

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


def _dist(a: list[float], b: list[float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _catmull(p0: list[float], p1: list[float], p2: list[float], p3: list[float], t: float) -> list[float]:
    t2 = t * t
    t3 = t2 * t
    return [
        0.5
        * (
            2 * p1[i]
            + (-p0[i] + p2[i]) * t
            + (2 * p0[i] - 5 * p1[i] + 4 * p2[i] - p3[i]) * t2
            + (-p0[i] + 3 * p1[i] - 3 * p2[i] + p3[i]) * t3
        )
        for i in range(3)
    ]


def _spline_length(path: list[list[float]], looped: bool, samples: int = 24) -> float:
    n = len(path)
    if n < 2:
        return 0.0
    spans = n if looped else n - 1
    total = 0.0
    for i in range(spans):
        if looped:
            pts = [path[(i + k) % n] for k in (-1, 0, 1, 2)]
        else:
            pts = [path[min(n - 1, max(0, i + k))] for k in (-1, 0, 1, 2)]
        prev = pts[1]
        for step in range(1, samples + 1):
            point = _catmull(pts[0], pts[1], pts[2], pts[3], step / samples)
            total += _dist(prev, point)
            prev = point
    return total


@lru_cache(maxsize=8)
def _load_json(path: str) -> Any:
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def _roads_by_id(world_id: int) -> dict[int, dict[str, Any]]:
    path = os.path.join(_BASE_DIR, f"data/worlds/{world_id}/roads.json")
    roads = _load_json(path)
    return {int(road["id"]): road for road in roads}


def _segments_by_road(world_id: int) -> dict[int, list[dict[str, Any]]]:
    path = os.path.join(_BASE_DIR, f"data/worlds/{world_id}/segments.json")
    grouped: dict[int, list[dict[str, Any]]] = {}
    for seg in _load_json(path):
        if seg.get("archId") is None or seg.get("requiresAllCheckpoints"):
            continue
        road_id = seg.get("roadId")
        if road_id is None:
            continue
        grouped.setdefault(int(road_id), []).append(seg)
    return grouped


def _road_spline_length(world_id: int, road_id: int) -> float:
    road = _roads_by_id(world_id).get(road_id)
    if not road:
        return 0.0
    return _spline_length(road.get("path") or [], bool(road.get("looped")))


def segment_spline_positions(route_id: int | str) -> list[dict[str, Any]]:
    """Segments crossed on one race lap, in ride order, with spline arc positions.

    `splineFrom` / `splineTo` are unitless arc positions along the manifest
    (lead-in included when the manifest has it). `lengthM` is the game's
    segment length in metres, when known.
    """
    routes = _load_json(os.path.join(_BASE_DIR, "data/routes.json"))
    route = next((item for item in routes if str(item.get("id")) == str(route_id)), None)
    if not route:
        return []

    world_id = route.get("worldId") or route.get("courseId")
    if world_id is None:
        return []
    world_id = int(world_id)

    manifest = [entry for entry in (route.get("manifest") or []) if isinstance(entry, dict)]
    if not manifest:
        return []

    by_road = _segments_by_road(world_id)
    placed: list[dict[str, Any]] = []
    cursor = 0.0

    for entry in manifest:
        road_id = entry.get("roadId")
        if road_id is None:
            continue
        road_id = int(road_id)
        start = float(entry.get("start") or 0)
        end = float(entry.get("end") or 0)
        reverse = bool(entry.get("reverse"))
        total = _road_spline_length(world_id, road_id)
        # Match the segment walker: reverse travel is high percent → low percent.
        if reverse:
            travel_from = max(start, end)
            travel_to = min(start, end)
        else:
            travel_from = min(start, end)
            travel_to = max(start, end)
        span = travel_from - travel_to
        entry_len = abs(span) * total
        if entry.get("leadin"):
            cursor += entry_len
            continue

        def at(percent: float) -> float:
            if span == 0:
                return cursor
            frac = (travel_from - percent) / span
            return cursor + frac * entry_len

        lo = min(start, end)
        hi = max(start, end)
        for seg in by_road.get(road_id, []):
            if reverse:
                seg_start = seg.get("roadStartReverse")
                seg_finish = seg.get("roadFinish")
                name = seg.get("nameReverse") or seg.get("nameForward")
                direction = "reverse"
                length_m = seg.get("distanceReverse")
            else:
                seg_start = seg.get("roadStartForward")
                seg_finish = seg.get("roadFinish")
                name = seg.get("nameForward") or seg.get("nameReverse")
                direction = "forward"
                length_m = seg.get("distanceForward")
            if not name or seg_start is None or seg_finish is None:
                continue
            seg_start_f = float(seg_start)
            seg_finish_f = float(seg_finish)
            if not (lo <= seg_start_f <= hi and lo <= seg_finish_f <= hi):
                continue
            if seg_start_f != seg_finish_f:
                riding_forward = seg_start_f < seg_finish_f
                if reverse and riding_forward:
                    continue
                if not reverse and not riding_forward:
                    continue
            spline_from = at(seg_start_f)
            spline_to = at(seg_finish_f)
            if spline_to < spline_from:
                spline_from, spline_to = spline_to, spline_from
            try:
                length_value = float(length_m) if length_m is not None else None
            except (TypeError, ValueError):
                length_value = None
            placed.append(
                {
                    "name": name,
                    "direction": direction,
                    "splineFrom": spline_from,
                    "splineTo": spline_to,
                    "lengthM": length_value,
                }
            )

        cursor += entry_len

    placed.sort(key=lambda row: (row["splineFrom"], row["splineTo"], row["name"]))
    return placed
