"""
ZwiftRacing category engine for the DCU liga enforcement system.

Categories are based on max30 vELO rating. Each rider is assigned a liga
category at season start; they may exceed the upper boundary by GRACE_POINTS
before being required to move to the next category.
"""
from __future__ import annotations

from typing import Optional

# (name, lower_inclusive, upper_exclusive)
# Diamond has no upper boundary.
ZR_CATEGORIES: list[tuple[str, int, Optional[int]]] = [
    ('Diamond', 2200, None),
    ('Ruby',    1900, 2200),
    ('Emerald', 1650, 1900),
    ('Sapphire',1450, 1650),
    ('Amethyst',1300, 1450),
    ('Platinum',1150, 1300),
    ('Gold',    1000, 1150),
    ('Silver',   850, 1000),
    ('Bronze',   650,  850),
    ('Copper',     0,  650),
]

GRACE_POINTS = 35


def get_zr_category(rating: int | float) -> tuple[str, int, Optional[int]]:
    """Return (name, lower, upper) for a given vELO rating."""
    r = int(rating)
    for name, lower, upper in ZR_CATEGORIES:
        if r >= lower:
            return name, lower, upper
    return ZR_CATEGORIES[-1]  # Copper as fallback


def _next_category(name: str) -> tuple[str, int, Optional[int]]:
    """Return the category one tier above the given one."""
    for i, (cat_name, lower, upper) in enumerate(ZR_CATEGORIES):
        if cat_name == name and i > 0:
            return ZR_CATEGORIES[i - 1]
    return ZR_CATEGORIES[0]  # Already Diamond


def compute_category_status(
    max30_rating: int | float,
    upper_boundary: Optional[int],
    grace_limit: Optional[int],
) -> str:
    """
    Return 'ok', 'grace', or 'over' given the current rating vs stored limits.

    Diamond riders (upper_boundary=None) are always 'ok'.
    """
    if upper_boundary is None:
        return 'ok'
    r = int(max30_rating)
    if r <= upper_boundary:
        return 'ok'
    if grace_limit is not None and r <= grace_limit:
        return 'grace'
    return 'over'


def build_liga_category(max30_rating: int | float, season: str, grace_points: int = GRACE_POINTS) -> dict:
    """
    Build a ligaCategory dict for storage in Firestore based on current max30Rating.

    Args:
        max30_rating: The rider's current max30 vELO rating.
        season: ISO date string for the season start (e.g. "2025-03-01").
        grace_points: How many points above the upper boundary the rider may go.
    """
    name, lower, upper = get_zr_category(max30_rating)
    grace_limit = (upper + grace_points) if upper is not None else None

    rating_int = int(max30_rating)
    status = compute_category_status(rating_int, upper, grace_limit)

    return {
        'season': season,
        'category': name,
        'upperBoundary': upper,          # None for Diamond
        'graceLimit': grace_limit,       # None for Diamond
        'assignedRating': rating_int,
        'status': status,
        'lastCheckedRating': rating_int,
    }


def reassign_to_next_category(current_category: str, current_max30: int | float, grace_points: int = GRACE_POINTS) -> dict:
    """
    Build an updated ligaCategory dict after manually moving a rider up one tier.
    The new category's boundaries are used; status is recomputed against current max30.
    """
    name, lower, upper = _next_category(current_category)
    grace_limit = (upper + grace_points) if upper is not None else None
    rating_int = int(current_max30)
    status = compute_category_status(rating_int, upper, grace_limit)

    return {
        'category': name,
        'upperBoundary': upper,
        'graceLimit': grace_limit,
        'status': status,
        'lastCheckedRating': rating_int,
    }
