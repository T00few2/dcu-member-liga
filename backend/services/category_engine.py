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
    ('Sapphire', 1450, 1650),
    ('Amethyst', 1300, 1450),
    ('Platinum', 1150, 1300),
    ('Gold',    1000, 1150),
    ('Silver',   850, 1000),
    ('Bronze',   650,  850),
    ('Copper',     0,  650),
]

# Default ZR categories in the [{name, upper}] API format for storage/export.
ZR_CATEGORY_DEFS: list[dict] = [
    {'name': name, 'upper': upper}
    for name, _lower, upper in ZR_CATEGORIES
]

GRACE_POINTS = 35

# Type alias for the internal (name, lower, upper) list used by engine functions.
CategoryList = list[tuple[str, int, Optional[int]]]


def cats_from_defs(defs: list[dict]) -> CategoryList:
    """
    Convert the API/storage format [{name, upper}] (sorted top to bottom,
    with the top category having upper=None) into the internal
    (name, lower_inclusive, upper_exclusive) tuple list.
    """
    result: CategoryList = []
    for i, d in enumerate(defs):
        name = str(d['name'])
        upper = d.get('upper')  # None for the top category
        # Lower = upper of the next entry, or 0 for the last entry.
        raw_lower = defs[i + 1].get('upper') if i + 1 < len(defs) else None
        lower = int(raw_lower) if raw_lower is not None else 0
        result.append((name, lower, upper))
    return result


def get_zr_category(
    rating: int | float,
    categories: CategoryList | None = None,
) -> tuple[str, int, Optional[int]]:
    """Return (name, lower, upper) for a given vELO rating."""
    cats = categories or ZR_CATEGORIES
    r = int(rating)
    for name, lower, upper in cats:
        if r >= lower:
            return name, lower, upper
    return cats[-1]  # fallback to lowest


def _next_category(
    name: str,
    categories: CategoryList | None = None,
) -> tuple[str, int, Optional[int]]:
    """Return the category one tier above the given one."""
    cats = categories or ZR_CATEGORIES
    for i, (cat_name, lower, upper) in enumerate(cats):
        if cat_name == name and i > 0:
            return cats[i - 1]
    return cats[0]  # already at top


def compute_category_status(
    max30_rating: int | float,
    upper_boundary: Optional[int],
    grace_limit: Optional[int],
) -> str:
    """
    Return 'ok', 'grace', or 'over' given the current rating vs stored limits.

    Top-category riders (upper_boundary=None) are always 'ok'.
    """
    if upper_boundary is None:
        return 'ok'
    r = int(max30_rating)
    if r <= upper_boundary:
        return 'ok'
    if grace_limit is not None and r <= grace_limit:
        return 'grace'
    return 'over'


def build_liga_category(
    max30_rating: int | float,
    grace_points: int = GRACE_POINTS,
    categories: CategoryList | None = None,
) -> dict:
    """
    Build a ligaCategory dict for storage in Firestore based on current max30Rating.

    Args:
        max30_rating: The rider's current max30 vELO rating.
        grace_points: How many points above the upper boundary the rider may go.
        categories: Optional custom category list; defaults to ZR_CATEGORIES.
    """
    name, lower, upper = get_zr_category(max30_rating, categories)
    grace_limit = (upper + grace_points) if upper is not None else None

    rating_int = int(max30_rating)
    status = compute_category_status(rating_int, upper, grace_limit)

    return {
        'category': name,
        'upperBoundary': upper,          # None for top category
        'graceLimit': grace_limit,       # None for top category
        'assignedRating': rating_int,
        'status': status,
        'lastCheckedRating': rating_int,
    }


def _effective_cat_name(
    auto_cat: str | None,
    sel_cat: str | None,
    categories: CategoryList | None = None,
) -> str | None:
    """
    Return the higher-ranked (harder) category between auto-assigned and self-selected.

    Lower index in the categories list = higher/harder category.
    Names not found in the list are treated as rank -1 (highest priority), so
    custom-named merged categories always take precedence over standard names.
    """
    if not auto_cat:
        return sel_cat
    if not sel_cat:
        return auto_cat
    cats = categories or ZR_CATEGORIES
    cat_names = [n for n, _, _ in cats]

    def rank(name: str) -> int:
        try:
            return cat_names.index(name)
        except ValueError:
            return -1  # unknown / custom name → treat as highest

    return auto_cat if rank(auto_cat) <= rank(sel_cat) else sel_cat


def _ts_to_ms(value) -> int | None:
    """Convert a Firestore Timestamp to milliseconds since epoch, or pass through."""
    if value is None:
        return None
    if hasattr(value, 'timestamp'):
        return int(value.timestamp() * 1000)
    return value


def serialize_liga_category(lc: dict | None) -> dict | None:
    """
    Flatten a ligaCategory Firestore document into an API response dict.
    Returns None if lc is None or empty.
    """
    if not lc:
        return None

    auto = lc.get('autoAssigned') or {}
    locked = lc.get('locked', False)
    sel = lc.get('selfSelected') or {}
    auto_cat = auto.get('category')
    sel_cat = sel.get('category') if sel else None

    if locked:
        effective = lc.get('category') or auto_cat
    else:
        effective = _effective_cat_name(auto_cat, sel_cat)

    return {
        'category': effective,
        'upperBoundary': auto.get('upperBoundary'),
        'graceLimit': auto.get('graceLimit'),
        'assignedRating': auto.get('assignedRating'),
        'assignedAt': _ts_to_ms(auto.get('assignedAt')),
        'status': auto.get('status', 'ok'),
        'lastCheckedRating': auto.get('lastCheckedRating'),
        'lastCheckedAt': _ts_to_ms(auto.get('lastCheckedAt')),
        'locked': locked,
        'lockedAt': _ts_to_ms(lc.get('lockedAt')),
        'autoAssignedCategory': auto_cat,
        'selfSelectedCategory': sel_cat,
    }


def reassign_to_next_category(
    current_category: str,
    current_max30: int | float,
    grace_points: int = GRACE_POINTS,
    categories: CategoryList | None = None,
) -> dict:
    """
    Build an updated ligaCategory dict after manually moving a rider up one tier.
    The new category's boundaries are used; status is recomputed against current max30.
    """
    name, lower, upper = _next_category(current_category, categories)
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
