from __future__ import annotations

from firebase_admin import firestore

from services.category_engine import (
    build_liga_category,
    cats_from_defs,
    _effective_cat_name,
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
    if existing_lc:
        auto = existing_lc.get("autoAssigned") or {}
        if existing_lc.get("locked"):
            new_auto = build_liga_category(eff_rating, grace_period, categories)
            new_auto["assignedRating"] = auto.get("assignedRating", eff_rating)
            new_auto["assignedAt"] = auto.get("assignedAt")
            new_auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP

            locked_effective = _effective_cat_name(
                new_auto.get("category"),
                existing_lc.get("category") or auto.get("category"),
                categories,
            )
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

