"""Race-relative segment markers from the game dictionary, placed by Sauce.

Offsets in routes.json are metres from the start banner. A negative offset, or
leadinOnly, is the ride from the pens and is not part of the lap. The marker
type is the dictionary jersey. A saved elevation overlay does not replace this.
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from typing import Any

from services.sauce_elevation import banner_distance_m
from services.zwift_game import (
    ZwiftGameService,
    dictionary_segment_name,
    jersey_marker,
)

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


def _marker_row(
    *,
    name: str,
    marker: str,
    direction: str,
    from_m: float,
    length_m: float,
    lap_km: float,
) -> dict[str, Any] | None:
    if from_m < 0:
        return None
    # A lap banner stores the whole-loop length. The arch itself is a point.
    if lap_km > 0 and length_m > lap_km * 1000 * 0.7:
        length_m = 0.0
    from_km = _round_km(from_m)
    if lap_km > 0 and from_km > lap_km + 0.15:
        return None
    to_km = _round_km(from_m + max(0.0, length_m))
    return {
        "name": name,
        "type": marker if marker in {"sprint", "climb", "segment"} else "segment",
        "fromKm": from_km,
        "toKm": max(from_km, to_km),
        "direction": direction,
    }


def measured_profile_segments(route_id: int | str) -> list[dict[str, Any]]:
    """Dictionary segments on one race lap, in ride order, kilometres from the banner.

    Sauce ``route.segments`` supplies the offset. A dictionary arch that list
    omits is placed from its road percent on the lap manifest. Lead-in rows are
    not part of the lap line.
    """
    route = next((item for item in _routes() if str(item.get("id")) == str(route_id)), None)
    if not route:
        return []
    world_id = route.get("worldId") or route.get("courseId")
    if world_id is None:
        return []
    dictionary = ZwiftGameService().segments_on_route(route_id)
    if not dictionary:
        return []
    by_id = _segments_by_id(int(world_id))
    lap_m = float(route.get("distanceInMeters") or 0)
    lap_km = lap_m / 1000.0 if lap_m > 0 else 0.0
    placed: list[dict[str, Any]] = []
    placed_ids: set[str] = set()

    for entry in route.get("segments") or []:
        if not isinstance(entry, dict) or entry.get("leadinOnly"):
            continue
        seg_id = str(entry.get("id"))
        row = dictionary.get(seg_id)
        if row is None:
            continue
        try:
            offset_m = float(entry.get("offset"))
            length_m = float(entry.get("distance") or 0)
        except (TypeError, ValueError):
            continue
        if offset_m < 0:
            continue
        found = by_id.get(seg_id)
        direction = found[1] if found else (row.get("direction") or "forward")
        marker = _marker_row(
            name=dictionary_segment_name(row),
            marker=jersey_marker(row.get("jerseyIconPath")),
            direction=str(direction),
            from_m=offset_m,
            length_m=length_m,
            lap_km=lap_km,
        )
        if marker is None:
            continue
        placed.append(marker)
        placed_ids.add(seg_id)

    for seg_id, row in dictionary.items():
        if seg_id in placed_ids:
            continue
        found = by_id.get(seg_id)
        if not found:
            continue
        segment, direction = found
        road_id = segment.get("roadId")
        percent = segment.get("roadFinish")
        if road_id is None or percent is None:
            continue
        banner_m = banner_distance_m(
            route_id,
            int(road_id),
            float(percent),
            reverse=(direction == "reverse"),
        )
        if banner_m is None:
            continue
        length_key = "distanceReverse" if direction == "reverse" else "distanceForward"
        try:
            length_m = float(segment.get(length_key) or 0)
        except (TypeError, ValueError):
            length_m = 0.0
        marker = _marker_row(
            name=dictionary_segment_name(row),
            marker=jersey_marker(row.get("jerseyIconPath")),
            direction=direction,
            from_m=max(0.0, banner_m - max(0.0, length_m)),
            length_m=length_m,
            lap_km=lap_km,
        )
        if marker is not None:
            placed.append(marker)

    placed.sort(key=lambda row: (row["fromKm"], row["toKm"], row["name"]))
    return placed
