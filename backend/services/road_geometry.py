"""Lightweight road geometry helpers using Zwift road polylines."""

from __future__ import annotations

import json
import math
import os
from functools import lru_cache
from typing import Any


def _dist3(a: list[float], b: list[float]) -> float:
    return math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2)


@lru_cache(maxsize=32)
def _load_roads(world_id: int, base_dir: str) -> dict[int, dict[str, Any]]:
    roads_file = os.path.join(base_dir, f"data/worlds/{world_id}/roads.json")
    with open(roads_file, encoding="utf-8") as handle:
        roads = json.load(handle)
    return {road["id"]: road for road in roads}


def _road_cumulative_lengths(path: list[list[float]]) -> list[float]:
    lengths = [0.0]
    total = 0.0
    for idx in range(1, len(path)):
        total += _dist3(path[idx - 1], path[idx])
        lengths.append(total)
    return lengths


def point_at_road_percent(road: dict[str, Any], road_percent: float) -> list[float]:
    path = road.get("path") or []
    if not path:
        return [0.0, 0.0, 0.0]
    if len(path) == 1:
        return path[0]

    percent = max(0.0, min(1.0, float(road_percent)))
    cumulative = _road_cumulative_lengths(path)
    total = cumulative[-1]
    if total == 0:
        return path[0]

    target = percent * total
    for idx in range(1, len(path)):
        if cumulative[idx] >= target:
            span = cumulative[idx] - cumulative[idx - 1]
            if span == 0:
                return path[idx]
            ratio = (target - cumulative[idx - 1]) / span
            prev_pt = path[idx - 1]
            next_pt = path[idx]
            return [
                prev_pt[0] + (next_pt[0] - prev_pt[0]) * ratio,
                prev_pt[1] + (next_pt[1] - prev_pt[1]) * ratio,
                prev_pt[2] + (next_pt[2] - prev_pt[2]) * ratio,
            ]
    return path[-1]


def nearest_road_percent(from_road: dict[str, Any], to_road: dict[str, Any], from_percent: float, steps: int = 250) -> float:
    origin = point_at_road_percent(from_road, from_percent)
    path = to_road.get("path") or []
    if not path:
        return 0.0

    best_percent = 0.0
    best_distance = float("inf")
    if steps < 2:
        steps = 2

    for step_idx in range(steps):
        candidate = step_idx / (steps - 1)
        point = point_at_road_percent(to_road, candidate)
        distance = _dist3(origin, point)
        if distance < best_distance:
            best_distance = distance
            best_percent = candidate
        if distance < 50:
            break
    return best_percent


def road_segment_length(road: dict[str, Any], start: float, end: float) -> float:
    path = road.get("path") or []
    if len(path) < 2:
        return 0.0

    cumulative = _road_cumulative_lengths(path)
    total = cumulative[-1]
    low = max(0.0, min(float(start), float(end)))
    high = min(1.0, max(float(start), float(end)))
    return (high - low) * total


def get_road(world_id: int, road_id: int, base_dir: str) -> dict[str, Any] | None:
    roads = _load_roads(world_id, base_dir)
    return roads.get(road_id)
