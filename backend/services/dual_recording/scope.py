"""Who is in dual-recording scope, and whether a result is public."""
from __future__ import annotations

from typing import Any

from services.dual_recording.persistence import _is_dual_recording_required
from services.liga_categories_core import verification_category_names


def load_verification_categories(db: Any) -> set[str]:
    try:
        snap = db.collection("league").document("settings").get()
        settings = snap.to_dict() if snap.exists else {}
    except Exception:
        settings = {}
    return verification_category_names((settings or {}).get("ligaCategories"))


def dual_recording_opted_in(user_data: dict | None) -> bool:
    if not isinstance(user_data, dict):
        return False
    return user_data.get("dualRecordingOptIn") is True


def resolve_rider_result_category(race_data: dict | None, zwift_id: str) -> str | None:
    results_map = (race_data or {}).get("results") or {}
    target = str(zwift_id)
    for category, riders in results_map.items():
        for rider in riders or []:
            if str((rider or {}).get("zwiftId") or "").strip() == target:
                return str(category)
    return None


def resolve_dr_source(
    db: Any,
    zwift_id: str,
    *,
    category: str | None = None,
    race_data: dict | None = None,
    race_id: str | None = None,
    user_data: dict | None = None,
    verification_cats: set[str] | None = None,
) -> str:
    """Return ``mandatory`` or ``opt_in``. Mandatory wins if both apply."""
    cat = str(category or "").strip() or None
    if cat is None and race_data is not None:
        cat = resolve_rider_result_category(race_data, zwift_id)
    if cat is None and race_id:
        try:
            race_doc = db.collection("races").document(str(race_id)).get()
            loaded = race_doc.to_dict() if race_doc.exists else {}
        except Exception:
            loaded = {}
        cat = resolve_rider_result_category(loaded, zwift_id)

    cats = verification_cats if verification_cats is not None else load_verification_categories(db)
    trainer_required = _is_dual_recording_required(db, str(zwift_id))
    if cat and cat in cats and trainer_required:
        return "mandatory"
    return "opt_in"


def is_dr_candidate(
    db: Any,
    zwift_id: str,
    *,
    category: str | None,
    user_data: dict | None,
    verification_cats: set[str] | None = None,
) -> tuple[bool, str]:
    source = resolve_dr_source(
        db,
        zwift_id,
        category=category,
        user_data=user_data,
        verification_cats=verification_cats,
    )
    if source == "mandatory":
        return True, "mandatory"
    if dual_recording_opted_in(user_data):
        return True, "opt_in"
    return False, source


def public_dr_row_visible(payload: dict | None) -> bool:
    """Opt-in non-pass results are rider/admin only. Legacy docs without source stay public."""
    if not isinstance(payload, dict):
        return False
    source = str(payload.get("source") or "mandatory").strip() or "mandatory"
    if source != "opt_in":
        return True
    return str(payload.get("status") or "") == "passed"
