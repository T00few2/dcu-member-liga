"""Race-relative sprint and climb positions from Sauce route.segments.

Offsets in routes.json are metres from the start banner. A negative offset, or
leadinOnly, is the ride from the pens and is not part of the lap. The road-walk
spline is not used: it invents markers for arches the route only clips.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

_BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))


@lru_cache(maxsize=1)
def _routes() -> list[dict[str, Any]]:
    path = os.path.join(_BASE_DIR, "data", "routes.json")
    with open(path, encoding="utf-8") as handle:
        data = json.load(handle)
    return data if isinstance(data, list) else []


@lru_cache(maxsize=16)
def _segments_by_id(world_id: int) -> dict[str, tuple[dict[str, Any], str]]:
    path = os.path.join(_BASE_DIR, "data", "worlds", str(world_id), "segments.json")
    if not os.path.exists(path):
        return {}
    with open(path, encoding="utf-8") as handle:
        rows = json.load(handle)
    indexed: dict[str, tuple[dict[str, Any], str]] = {}
    for segment in rows if isinstance(rows, list) else []:
        if not isinstance(segment, dict):
            continue
        forward = segment.get("idForward")
        reverse = segment.get("idReverse")
        if forward is not None:
            indexed[str(forward)] = (segment, "forward")
        if reverse is not None:
            indexed[str(reverse)] = (segment, "reverse")
    return indexed


def _round_km(metres: float) -> float:
    return round(metres / 1000.0, 3)


def measured_profile_segments(route_id: int | str) -> list[dict[str, Any]]:
    """Sprints and climbs on one race lap, in ride order, kilometres from the banner.

    Lap banners and a segment that covers most of the lap are omitted. Naming and
    sprint/climb type are finished by the caller against zwift-data.
    """
    route = next((item for item in _routes() if str(item.get("id")) == str(route_id)), None)
    if not route:
        return []
    world_id = route.get("worldId") or route.get("courseId")
    if world_id is None:
        return []
    by_id = _segments_by_id(int(world_id))
    lap_m = float(route.get("distanceInMeters") or 0)
    lap_km = lap_m / 1000.0 if lap_m > 0 else 0.0
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
        if lap_m > 0 and length_m > lap_m * 0.7:
            continue
        from_km = _round_km(offset_m)
        if lap_km > 0 and from_km > lap_km + 0.15:
            continue
        found = by_id.get(str(entry.get("id")))
        if not found:
            continue
        segment, direction = found
        if segment.get("archId") is None or segment.get("requiresAllCheckpoints"):
            continue
        name = segment.get("nameReverse") if direction == "reverse" else segment.get("nameForward")
        if not name:
            name = segment.get("nameForward") or segment.get("nameReverse")
        if not name:
            continue
        to_km = _round_km(offset_m + max(0.0, length_m))
        placed.append(
            {
                "name": str(name),
                "fromKm": from_km,
                "toKm": max(from_km, to_km),
                "direction": direction,
            }
        )

    placed.sort(key=lambda row: (row["fromKm"], row["toKm"], row["name"]))
    return placed
