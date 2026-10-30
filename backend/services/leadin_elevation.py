"""Pens-to-banner elevation, sampled from Sauce road geometry.

Road paths are centimetres. Distance and altitude here are metres. The last
sample is the start banner. The chart shifts the whole lead-in so that height
meets the Strava lap, which uses a different datum.
"""

from __future__ import annotations

import os
from functools import lru_cache
from typing import Any

from services.pen_exit_routing import synthesize_leadin_entries
from services.road_geometry import get_road, point_at_road_percent, road_segment_length
from services.sauce_profile_segments import _routes

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
_CM_PER_M = 100.0
_SAMPLE_M = 20.0
_MAX_POINTS = 80


def _travel_ends(entry: dict[str, Any]) -> tuple[float, float]:
    start = float(entry.get("start") or 0)
    end = float(entry.get("end") or 0)
    if entry.get("reverse"):
        return max(start, end), min(start, end)
    return min(start, end), max(start, end)


def _leadin_entries(route: dict[str, Any]) -> list[dict[str, Any]]:
    manifest = [entry for entry in (route.get("manifest") or []) if isinstance(entry, dict)]
    marked = [entry for entry in manifest if entry.get("leadin")]
    if marked:
        return marked
    return synthesize_leadin_entries(route, _BASE_DIR)


def _thin(samples: list[tuple[float, float]], limit: int) -> list[tuple[float, float]]:
    if len(samples) <= limit:
        return samples
    last = len(samples) - 1
    indexes: list[int] = []
    for step in range(limit):
        index = round(step * last / (limit - 1))
        if not indexes or index != indexes[-1]:
            indexes.append(index)
    return [samples[index] for index in indexes]


@lru_cache(maxsize=256)
def leadin_elevation(route_id: int | str) -> dict[str, list[float]]:
    """Distance and altitude from the pens to the start banner.

    An empty profile means this route has no lead-in geometry. Distances are
    scaled onto ``leadinDistanceInMeters`` when the sampled length is close,
    so the banner lines up with the distance shown on the race card.
    """
    empty: dict[str, list[float]] = {"distance": [], "altitude": []}
    route = next((item for item in _routes() if str(item.get("id")) == str(route_id)), None)
    if not route:
        return empty
    world_id = route.get("worldId") or route.get("courseId")
    if world_id is None:
        return empty

    samples: list[tuple[float, float]] = []
    cursor = 0.0
    for entry in _leadin_entries(route):
        road_id = entry.get("roadId")
        if road_id is None:
            continue
        road = get_road(int(world_id), int(road_id), _BASE_DIR)
        if not road:
            continue
        travel_from, travel_to = _travel_ends(entry)
        length_m = road_segment_length(road, travel_from, travel_to) / _CM_PER_M
        if length_m < 0.5:
            continue
        steps = max(2, int(length_m / _SAMPLE_M) + 1)
        for step in range(steps):
            along = step / (steps - 1)
            percent = travel_from + (travel_to - travel_from) * along
            point = point_at_road_percent(road, percent)
            distance_m = cursor + length_m * along
            if samples and distance_m < samples[-1][0] + 1.0:
                continue
            altitude_m = float(point[2]) / _CM_PER_M
            samples.append((distance_m, altitude_m))
        cursor += length_m

    if len(samples) < 2 or cursor < 1:
        return empty

    official_m = float(route.get("leadinDistanceInMeters") or 0)
    if official_m > 50 and cursor > 50:
        ratio = official_m / cursor
        if 0.6 <= ratio <= 1.75:
            samples = [(distance * ratio, altitude) for distance, altitude in samples]
            cursor = official_m

    samples = _thin(samples, _MAX_POINTS)
    if samples[-1][0] < cursor - 0.5:
        samples.append((cursor, samples[-1][1]))
    return {
        "distance": [round(distance, 2) for distance, _altitude in samples],
        "altitude": [round(altitude, 2) for _distance, altitude in samples],
    }
