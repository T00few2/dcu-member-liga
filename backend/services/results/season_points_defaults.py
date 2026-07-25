"""Default season prestige point tables (Tour / Monument / WT classic)."""
from __future__ import annotations

from typing import Any


def _table(by_place: list[int], ranges: list[dict[str, int]] | None = None) -> dict[str, Any]:
    return {
        "byPlace": by_place,
        "ranges": ranges or [],
    }


# From the season ranking points image (places 1..N; ranges for bands).
DEFAULT_SEASON_RANK_POINTS: dict[str, dict[str, Any]] = {
    "tour_overall": _table(
        [1300, 1040, 880, 750, 620, 520, 425, 360, 295, 230, 190, 165, 140, 110, 100, 90, 85, 80, 70, 60],
        [
            {"from": 21, "to": 25, "points": 50},
            {"from": 26, "to": 30, "points": 40},
            {"from": 31, "to": 40, "points": 35},
            {"from": 41, "to": 50, "points": 25},
            {"from": 51, "to": 55, "points": 20},
            {"from": 56, "to": 60, "points": 15},
        ],
    ),
    "tour_stage": _table(
        [210, 150, 110, 90, 70, 55, 45, 40, 35, 30, 25, 20, 15, 10, 5],
        [],  # places 16+ = 0
    ),
    "monument": _table(
        [800, 640, 520, 440, 360, 280, 240, 200, 160, 135, 110, 95, 85, 65, 55, 50, 50, 50, 50, 50],
        [
            {"from": 21, "to": 25, "points": 30},
            {"from": 26, "to": 30, "points": 30},
            {"from": 31, "to": 40, "points": 15},
            {"from": 41, "to": 50, "points": 15},
            {"from": 51, "to": 55, "points": 10},
            {"from": 56, "to": 60, "points": 5},
        ],
    ),
    "wt_classic": _table(
        [500, 400, 325, 275, 225, 175, 150, 125, 100, 85, 70, 60, 50, 40, 35, 30, 30, 30, 30, 30],
        [
            {"from": 21, "to": 25, "points": 20},
            {"from": 26, "to": 30, "points": 20},
            {"from": 31, "to": 40, "points": 10},
            {"from": 41, "to": 50, "points": 10},
            {"from": 51, "to": 55, "points": 5},
            {"from": 56, "to": 60, "points": 3},
        ],
    ),
}


def points_for_place(table: dict[str, Any] | None, place: int) -> int:
    """Resolve prestige points for a 1-based finishing place."""
    if not table or place < 1:
        return 0
    by_place = table.get("byPlace") or []
    if place <= len(by_place):
        return int(by_place[place - 1] or 0)
    for band in table.get("ranges") or []:
        try:
            lo = int(band.get("from"))
            hi = int(band.get("to"))
            pts = int(band.get("points") or 0)
        except (TypeError, ValueError):
            continue
        if lo <= place <= hi:
            return pts
    return 0
