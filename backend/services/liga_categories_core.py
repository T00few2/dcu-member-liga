from __future__ import annotations

from firebase_admin import firestore

from services.category_engine import (
    build_liga_category,
    cats_from_defs,
    compute_category_status,
    ZR_CATEGORIES,
)


def _load_liga_settings(db_client) -> dict:
    """Load league settings; return gracePeriod and categories."""
    try:
        doc = db_client.collection("league").document("settings").get()
        s = doc.to_dict() if doc.exists else {}
    except Exception:
        s = {}
    return {
        "gracePeriod": int(s.get("gracePeriod", 35)),
        "categories": s.get("ligaCategories"),
    }


def _resolve_categories(settings: dict):
    """Return CategoryList from settings, or None to use defaults."""
    defs = settings.get("categories")
    if defs and isinstance(defs, list) and len(defs) >= 2:
        try:
            return cats_from_defs(defs)
        except Exception:
            pass
    return None


def _compute_liga_update(
    eff_rating: int,
    existing_lc: dict | None,
    grace_period: int,
    categories,
) -> dict:
    """Return Firestore update dict for ligaCategory fields."""
    cats = categories or ZR_CATEGORIES

    def _bounds_for(cat_name: str | None) -> tuple[int | None, int | None]:
        if not cat_name:
            return None, None
        for name, _lower, upper in cats:
            if name == cat_name:
                grace_limit = (upper + grace_period) if upper is not None else None
                return upper, grace_limit
        return None, None

    if existing_lc:
        auto = existing_lc.get("autoAssigned") or {}
        if existing_lc.get("locked"):
            # Locked riders must remain in their locked category; only refresh
            # status/check metadata against that category's boundaries.
            locked_effective = existing_lc.get("category") or auto.get("category")
            upper_boundary, grace_limit = _bounds_for(locked_effective)
            if upper_boundary is None and grace_limit is None:
                upper_boundary = auto.get("upperBoundary")
                grace_limit = auto.get("graceLimit")

            rating_int = int(eff_rating)
            status = compute_category_status(rating_int, upper_boundary, grace_limit)
            new_auto = dict(auto)
            new_auto["category"] = locked_effective
            new_auto["upperBoundary"] = upper_boundary
            new_auto["graceLimit"] = grace_limit
            new_auto["assignedRating"] = auto.get("assignedRating", rating_int)
            new_auto["assignedAt"] = auto.get("assignedAt")
            new_auto["status"] = status
            new_auto["lastCheckedRating"] = rating_int
            new_auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
            return {
                "ligaCategory.autoAssigned": new_auto,
                "ligaCategory.category": locked_effective,
            }
        else:
            new_auto = build_liga_category(eff_rating, grace_period, categories)
            new_auto["assignedRating"] = auto.get("assignedRating", eff_rating)
            new_auto["assignedAt"] = auto.get("assignedAt")
            new_auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
            return {"ligaCategory.autoAssigned": new_auto}
    else:
        new_auto = build_liga_category(eff_rating, grace_period, categories)
        new_auto["assignedAt"] = firestore.SERVER_TIMESTAMP
        new_auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
        return {"ligaCategory": {"autoAssigned": new_auto, "locked": False}}

