"""Route elevation and sprint/climb grades from Sauce road geometry.

Height is the road point's z, converted the way the game does it: subtract the
world's sea level, add its elevation offset, divide by 100, then apply
``physicsSlopeScale``. Watopia's scale is 0.5, so raw mesh height is twice the
climb a rider sees. A road position is not a fraction of the road's length. It
is an index into the curve, ``percent * (node_count - 3) + 1``.
"""

from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from typing import Any

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_SAMPLE_M = 20.0


def _load(name: str) -> Any:
    path = os.path.join(_BASE_DIR, "data", name)
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


@lru_cache(maxsize=1)
def _worlds() -> dict[int, dict[str, Any]]:
    rows = _load("worldlist.json")
    return {int(row["worldId"]): row for row in rows}


@lru_cache(maxsize=1)
def _routes() -> dict[str, dict[str, Any]]:
    rows = _load("routes.json")
    return {str(row.get("id")): row for row in rows if isinstance(row, dict)}


@lru_cache(maxsize=4)
def _roads(world_id: int) -> dict[int, dict[str, Any]]:
    rows = _load(f"worlds/{world_id}/roads.json")
    return {int(row["id"]): row for row in rows}


@lru_cache(maxsize=4)
def _segments(world_id: int) -> dict[str, tuple[dict[str, Any], str]]:
    path = os.path.join(_BASE_DIR, "data", "worlds", str(world_id), "segments.json")
    if not os.path.exists(path):
        return {}
    indexed: dict[str, tuple[dict[str, Any], str]] = {}
    with open(path, encoding="utf-8") as handle:
        rows = json.load(handle)
    for segment in rows:
        if not isinstance(segment, dict):
            continue
        forward = segment.get("idForward")
        reverse = segment.get("idReverse")
        if forward is not None:
            indexed[str(forward)] = (segment, "forward")
        if reverse is not None:
            indexed[str(reverse)] = (segment, "reverse")
    return indexed


def altitude_m(world_id: int, z_cm: float) -> float:
    """Game altitude in metres for a road-point z stored in centimetres."""
    world = _worlds().get(int(world_id), {})
    scale = float(world.get("physicsSlopeScale") or 1)
    sea = float(world.get("seaLevel") or 0)
    offset = float(world.get("eleOffset") or 0)
    return (float(z_cm) - sea + offset) / 100.0 * scale


def classify_segment(name: str, grade_percent: float | None) -> str:
    """Sprint or climb.

    A name that already says KOM or sprint wins. Anything else is a climb when
    its average grade is at least 2 percent. Gentle named KOMs stay climbs.
    An uphill sprint whose name says sprint stays a sprint.
    """
    folded = (name or "").casefold()
    if "kom" in folded:
        return "climb"
    if "sprint" in folded:
        return "sprint"
    if grade_percent is None:
        return "segment"
    return "climb" if grade_percent >= 2 else "sprint"


def _xyz(point: list[float]) -> tuple[float, float, float]:
    return (float(point[0]), float(point[1]), float(point[2]))


def _lerp(t: float, a: tuple[float, float, float], b: tuple[float, float, float]):
    return tuple(a[i] + (b[i] - a[i]) * t for i in range(3))


def _cubic(t: float, a, b, c, d):
    u = 1 - t
    return tuple(
        (u * u * u) * a[i] + 3 * u * u * t * b[i] + 3 * u * t * t * c[i] + (t * t * t) * d[i]
        for i in range(3)
    )


def _dist(a, b) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


def _catmull_controls(p_prev, p0, p1, p2):
    cp1 = p0 if p_prev is None else tuple(p0[i] + (p1[i] - p_prev[i]) / 6 for i in range(3))
    cp2 = p1 if p2 is None else tuple(p1[i] - (p2[i] - p0[i]) / 6 for i in range(3))
    return cp1, cp2


def _bezier_controls(p_prev, p0, p1, p2, smoothing: float = 0.2):
    # Control sits on the tangent from the previous point toward the next one.
    cp1 = p0 if p_prev is None else tuple(p0[i] + (p1[i] - p_prev[i]) * smoothing for i in range(3))
    cp2 = p1 if p2 is None else tuple(p1[i] + (p0[i] - p2[i]) * smoothing for i in range(3))
    return cp1, cp2


@lru_cache(maxsize=64)
def _nodes(world_id: int, road_id: int) -> tuple[tuple, ...]:
    road = _roads(world_id).get(int(road_id))
    if not road:
        return tuple()
    points = [_xyz(point) for point in road.get("path") or []]
    if len(points) < 2:
        return tuple()
    if road.get("looped") and len(points) >= 3:
        points = [points[-1], *points, points[0], points[1]]
    bezier = road.get("splineType") == "Bezier"
    nodes: list[dict[str, Any]] = [{"end": points[0]}]
    last = len(points) - 1
    for index in range(last):
        p_prev = points[index - 1] if index else None
        p0 = points[index]
        p1 = points[index + 1]
        p2 = points[index + 2] if index + 2 <= last else None
        if bezier:
            cp1, cp2 = _bezier_controls(p_prev, p0, p1, p2)
        else:
            cp1, cp2 = _catmull_controls(p_prev, p0, p1, p2)
        nodes.append({"end": p1, "cp1": cp1, "cp2": cp2})
    return tuple(nodes)


def _point_at(nodes: tuple, offset: float):
    if not nodes:
        return (0.0, 0.0, 0.0)
    if offset <= 0:
        return nodes[0]["end"]
    index = int(math.trunc(offset))
    frac = offset - index
    if index >= len(nodes) - 1:
        return nodes[-1]["end"]
    nxt = nodes[index + 1]
    origin = nodes[index]["end"]
    if "cp1" not in nxt:
        return _lerp(frac, origin, nxt["end"])
    return _cubic(frac, origin, nxt["cp1"], nxt["cp2"], nxt["end"])


def _offset(nodes: tuple, percent: float) -> float:
    return float(percent) * (len(nodes) - 3) + 1


def _sample(world_id: int, road_id: int, start: float, end: float, step_m: float = _SAMPLE_M):
    nodes = _nodes(world_id, road_id)
    if len(nodes) < 4:
        return [], []
    o0 = _offset(nodes, start)
    o1 = _offset(nodes, end)
    steps = max(8, int(abs(o1 - o0) * 40))
    raw = [_point_at(nodes, o0 + (o1 - o0) * (i / steps)) for i in range(steps + 1)]
    distances = [0.0]
    altitudes = [altitude_m(world_id, raw[0][2])]
    cursor = 0.0
    previous = raw[0]
    for point in raw[1:]:
        cursor += _dist(previous, point) / 100.0
        previous = point
        if cursor - distances[-1] >= step_m:
            distances.append(cursor)
            altitudes.append(altitude_m(world_id, point[2]))
    if cursor - distances[-1] > 0.5:
        distances.append(cursor)
        altitudes.append(altitude_m(world_id, raw[-1][2]))
    return distances, altitudes


def _span_stats(distances: list[float], altitudes: list[float]) -> dict[str, float] | None:
    if len(distances) < 2 or len(altitudes) < 2:
        return None
    length = distances[-1] - distances[0]
    net = altitudes[-1] - altitudes[0]
    if length < 1:
        return None
    return {"lengthM": length, "netM": net, "grade": net / length * 100.0}


def segment_measure(world_id: int, segment: dict[str, Any], direction: str) -> dict[str, Any] | None:
    """Average grade of one arch, from its start percent to its banner percent."""
    if direction == "reverse":
        start = segment.get("roadStartReverse")
        name = segment.get("nameReverse") or segment.get("nameForward")
    else:
        start = segment.get("roadStartForward")
        name = segment.get("nameForward") or segment.get("nameReverse")
    end = segment.get("roadFinish")
    road_id = segment.get("roadId")
    if start is None or end is None or road_id is None or not name:
        return None
    distances, altitudes = _sample(int(world_id), int(road_id), float(start), float(end))
    stats = _span_stats(distances, altitudes)
    if not stats:
        return None
    grade = stats["grade"]
    return {
        "name": str(name).strip(),
        "direction": direction,
        "grade": grade,
        "netM": stats["netM"],
        "lengthM": stats["lengthM"],
        "category": classify_segment(str(name), grade),
    }


def _route(route_id: int | str) -> dict[str, Any] | None:
    return _routes().get(str(route_id))


def route_elevation(
    route_id: int | str,
    *,
    include_leadin: bool = False,
    leadin_only: bool = False,
) -> dict[str, list[float]]:
    """Distance and altitude for one lap.

    Distances are metres from the start banner, unless ``include_leadin`` is
    set, in which case they start at the pens. ``leadin_only`` is the pens.
    An unknown route is empty.
    """
    empty: dict[str, list[float]] = {"distance": [], "altitude": []}
    route = _route(route_id)
    if not route:
        return empty
    world_id = route.get("worldId")
    if world_id is None:
        return empty
    distances: list[float] = []
    altitudes: list[float] = []
    cursor = 0.0
    for entry in route.get("manifest") or []:
        if not isinstance(entry, dict):
            continue
        is_leadin = bool(entry.get("leadin"))
        if leadin_only and not is_leadin:
            continue
        if is_leadin and not include_leadin and not leadin_only:
            continue
        road_id = entry.get("roadId")
        if road_id is None:
            continue
        start = float(entry.get("start") or 0)
        end = float(entry.get("end") or 0)
        if entry.get("reverse") and start <= end:
            start, end = end, start
        part_d, part_a = _sample(int(world_id), int(road_id), start, end)
        if len(part_d) < 2:
            continue
        for index, (dist, alt) in enumerate(zip(part_d, part_a)):
            along = cursor + dist
            if distances and along < distances[-1] + 1.0:
                continue
            if index == 0 and distances:
                continue
            distances.append(along)
            altitudes.append(alt)
        cursor += part_d[-1]
    if len(distances) < 2:
        return empty
    return {
        "distance": [round(value, 2) for value in distances],
        "altitude": [round(value, 2) for value in altitudes],
    }


def route_leadin_profile(route_id: int | str) -> dict[str, list[float]]:
    """Pens-to-banner elevation. Distances are metres from the pens."""
    return route_elevation(route_id, leadin_only=True)


def banner_distance_m(
    route_id: int | str,
    road_id: int,
    percent: float,
    *,
    reverse: bool,
) -> float | None:
    """Metres from the start banner to a road percent on the lap manifest."""
    route = _route(route_id)
    if not route or route.get("worldId") is None:
        return None
    world_id = int(route["worldId"])
    cursor = 0.0
    target = float(percent)
    for entry in route.get("manifest") or []:
        if not isinstance(entry, dict) or entry.get("leadin"):
            continue
        entry_road = entry.get("roadId")
        if entry_road is None:
            continue
        start = float(entry.get("start") or 0)
        end = float(entry.get("end") or 0)
        if entry.get("reverse") and start <= end:
            start, end = end, start
        part_d, _part_a = _sample(world_id, int(entry_road), start, end)
        slice_len = part_d[-1] if part_d else 0.0
        same_road = int(entry_road) == int(road_id)
        same_dir = bool(entry.get("reverse")) == bool(reverse)
        low = min(start, end) - 1e-5
        high = max(start, end) + 1e-5
        if same_road and same_dir and low <= target <= high:
            partial, _alts = _sample(world_id, int(entry_road), start, target)
            along = partial[-1] if partial else 0.0
            return cursor + along
        cursor += slice_len
    return None


def route_segment_grades(route_id: int | str) -> list[dict[str, Any]]:
    """Segments this route lists, with a grade and a sprint/climb category.

    Only ids on the route's own segment list are included. Lead-in-only rows
    and lap banners are left out.
    """
    route = _route(route_id)
    if not route or route.get("worldId") is None:
        return []
    world_id = int(route["worldId"])
    by_id = _segments(world_id)
    placed: list[dict[str, Any]] = []
    for entry in route.get("segments") or []:
        if not isinstance(entry, dict) or entry.get("leadinOnly"):
            continue
        try:
            offset_m = float(entry.get("offset"))
            length_m = float(entry.get("distance") or 0)
        except (TypeError, ValueError):
            continue
        if offset_m < 0:
            continue
        found = by_id.get(str(entry.get("id")))
        if not found:
            continue
        segment, direction = found
        if segment.get("archId") is None or segment.get("requiresAllCheckpoints"):
            continue
        measured = segment_measure(world_id, segment, direction)
        if not measured:
            continue
        placed.append(
            {
                "id": str(entry.get("id")),
                "name": measured["name"],
                "direction": direction,
                "fromM": offset_m,
                "toM": offset_m + max(0.0, length_m),
                "grade": round(measured["grade"], 2),
                "category": measured["category"],
            }
        )
    placed.sort(key=lambda row: (row["fromM"], row["toM"], row["name"]))
    return placed
