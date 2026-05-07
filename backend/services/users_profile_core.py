from __future__ import annotations

from firebase_admin import firestore

from extensions import db, zr_service
from services.category_engine import build_liga_category, cats_from_defs, effective_rating
from services.schema_validation import with_schema_version


def _resolve_liga_categories_from_settings(settings_doc: dict | None):
    defs = (settings_doc or {}).get("ligaCategories")
    if defs and isinstance(defs, list) and len(defs) >= 2:
        try:
            return cats_from_defs(defs)
        except Exception:
            pass
    return None


def _enrich_user_with_zwiftracing(user_doc_id: str, zwift_id: str) -> bool:
    """
    Fetch ZwiftRacing stats immediately and persist to the user document.
    Returns True if stats were stored, False if no data was available.
    """
    zr_json = zr_service.get_rider_data(str(zwift_id))
    if not zr_json:
        return False

    data = zr_json if "race" in zr_json else (zr_json.get("data") or {})
    race = data.get("race") or {}
    current_rating = (race.get("current") or {}).get("rating", "N/A")
    max30_rating = (race.get("max30") or {}).get("rating", "N/A")
    max90_rating = (race.get("max90") or {}).get("rating", "N/A")

    update_payload = {
        "zwiftRacing": {
            "currentRating": current_rating,
            "max30Rating": max30_rating,
            "max90Rating": max90_rating,
            "phenotype": (data.get("phenotype") or {}).get("value", "N/A"),
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
    }

    user_doc = db.collection("users").document(str(user_doc_id)).get()
    user_data = user_doc.to_dict() if user_doc.exists else {}
    if not (user_data.get("ligaCategory") or {}).get("autoAssigned"):
        eff_rating = effective_rating(current_rating, max30_rating, max90_rating)
        if eff_rating is not None:
            settings_doc = db.collection("league").document("settings").get()
            settings = settings_doc.to_dict() if settings_doc.exists else {}
            grace_period = int(settings.get("gracePeriod", 35))
            categories = _resolve_liga_categories_from_settings(settings)

            auto = build_liga_category(eff_rating, grace_period, categories)
            auto["assignedAt"] = firestore.SERVER_TIMESTAMP
            auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
            update_payload["ligaCategory"] = {"autoAssigned": auto, "locked": False}

    db.collection("users").document(str(user_doc_id)).set(with_schema_version(update_payload), merge=True)
    return True


def _normalize_zwift_id(value) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    return s if s.isdigit() else None


def _normalize_trainer_name(value) -> str:
    return " ".join(str(value or "").strip().lower().split())


def _trainer_requires_dual_recording(trainer_name: str) -> bool:
    if not db or not trainer_name:
        return False

    target = _normalize_trainer_name(trainer_name)
    for doc in db.collection("trainers").stream():
        td = doc.to_dict() or {}
        status = td.get("status")
        if status != "approved":
            continue

        normalized = td.get("normalizedName") or _normalize_trainer_name(td.get("name", ""))
        if normalized == target:
            return bool(td.get("dualRecordingRequired", False))
    return False


def _connected_zwift_id_from_user_data(data: dict | None) -> str | None:
    if not isinstance(data, dict):
        return None
    direct = _normalize_zwift_id(data.get("zwiftId"))
    if direct:
        return direct
    connections = data.get("connections") or {}
    zwift = connections.get("zwift") if isinstance(connections, dict) else {}
    return _normalize_zwift_id((zwift or {}).get("profileId"))

