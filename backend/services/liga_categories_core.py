from __future__ import annotations

from typing import Any, Iterable

from firebase_admin import firestore

from services.category_engine import (
    assignment_floor_category,
    build_liga_category,
    cats_from_defs,
    compute_category_status,
    effective_liga_category_name,
    ZR_CATEGORIES,
)


def verification_category_names(liga_categories: Iterable[Any] | None) -> set[str]:
    """Return category names with requiresVerification === true.

    Missing or false flags are out of scope — no silent name-based fallbacks.
    """
    names: set[str] = set()
    if not liga_categories:
        return names
    for entry in liga_categories:
        if not isinstance(entry, dict):
            continue
        if entry.get("requiresVerification") is not True:
            continue
        name = str(entry.get("name") or "").strip()
        if name:
            names.add(name)
    return names


def effective_user_category(liga_category: Any) -> str:
    """Effective liga category for a user doc (locked / manual / self-selected / auto)."""
    return effective_liga_category_name(liga_category)


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
        "verificationCategories": verification_category_names(s.get("ligaCategories")),
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

            manual = existing_lc.get("manualAssigned") or {}
            manual_cat = assignment_floor_category(existing_lc) if manual.get("category") else None
            if manual_cat:
                # Keep the admin hold; still refresh vELO-implied autoAssigned
                # and status/bounds against the manual category.
                rating_int = int(eff_rating)
                upper_boundary, grace_limit = _bounds_for(manual_cat)
                if upper_boundary is None and grace_limit is None:
                    upper_boundary = manual.get("upperBoundary")
                    grace_limit = manual.get("graceLimit")
                new_manual = dict(manual)
                new_manual["category"] = manual_cat
                new_manual["upperBoundary"] = upper_boundary
                new_manual["graceLimit"] = grace_limit
                new_manual["status"] = compute_category_status(
                    rating_int, upper_boundary, grace_limit
                )
                new_manual["lastCheckedRating"] = rating_int
                return {
                    "ligaCategory.autoAssigned": new_auto,
                    "ligaCategory.manualAssigned": new_manual,
                }

            return {"ligaCategory.autoAssigned": new_auto}
    else:
        new_auto = build_liga_category(eff_rating, grace_period, categories)
        new_auto["assignedAt"] = firestore.SERVER_TIMESTAMP
        new_auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
        return {"ligaCategory": {"autoAssigned": new_auto, "locked": False}}

