"""Write a rider's liga category from a predicted vELO or an admin-chosen category.

Shared by the admin routes (predict-assign / manual-assign) and the division agent,
so an approved proposal writes exactly what the admin buttons write.
"""
from __future__ import annotations

import logging
from typing import Any

from firebase_admin import firestore

from services.category_engine import build_liga_category, build_manual_assigned, effective_rating
from services.liga_categories_core import _load_liga_settings, _resolve_categories, auto_for_predict_assign
from services.schema_validation import log_schema_issues, validate_user_doc, with_schema_version

logger = logging.getLogger(__name__)

LOCKED_MESSAGE = "Rider is locked after racing. Reset season assignments before changing category."


class AssignmentError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _real_rating(user_data: dict) -> int | None:
    zr = user_data.get("zwiftRacing") or {}
    return effective_rating(
        zr.get("currentRating", "N/A"),
        zr.get("max30Rating", "N/A"),
        zr.get("max90Rating", "N/A"),
    )


def _write(db: Any, user_doc_id: str, doc_update: dict, label: str) -> None:
    user_update = with_schema_version(doc_update)
    log_schema_issues(logger, f"users/{user_doc_id} ({label})", validate_user_doc(user_update, partial=True))
    db.collection("users").document(str(user_doc_id)).update(user_update)


def predict_assign(db: Any, user_doc_id: str, user_data: dict, predicted_velo: float) -> dict:
    """Hold the rider in the division of `predicted_velo` (manualAssigned, assignedFrom "predicted")."""
    if predicted_velo is None or predicted_velo <= 0:
        raise AssignmentError("predictedVelo must be a positive number")
    existing_lc = user_data.get("ligaCategory") or {}
    if existing_lc.get("locked"):
        raise AssignmentError(LOCKED_MESSAGE)
    liga_settings = _load_liga_settings(db)
    grace_period = liga_settings["gracePeriod"]
    categories = _resolve_categories(liga_settings)
    result = build_liga_category(predicted_velo, grace_period, categories)
    manual = {
        "category": result["category"],
        "assignedFrom": "predicted",
        "predictedVelo": float(predicted_velo),
        "assignedRating": int(predicted_velo),
        "assignedAt": firestore.SERVER_TIMESTAMP,
        "upperBoundary": result.get("upperBoundary"),
        "graceLimit": result.get("graceLimit"),
        "status": result.get("status"),
        "lastCheckedRating": int(predicted_velo),
    }
    doc_update: dict = {"ligaCategory.manualAssigned": manual}
    seeded_auto = auto_for_predict_assign(
        existing_lc.get("autoAssigned") or {}, _real_rating(user_data), grace_period, categories,
    )
    if seeded_auto is not None:
        seeded_auto["assignedAt"] = firestore.SERVER_TIMESTAMP
        seeded_auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
        doc_update["ligaCategory.autoAssigned"] = seeded_auto
        doc_update["ligaCategory.locked"] = False
    _write(db, user_doc_id, doc_update, "predict-assign")
    return {"category": result["category"], "predictedVelo": float(predicted_velo)}


def manual_assign(db: Any, user_doc_id: str, user_data: dict, category_name: str) -> dict:
    """Hold the rider in an admin-chosen division (manualAssigned, assignedFrom "admin")."""
    category_name = str(category_name or "").strip()
    if not category_name:
        raise AssignmentError("category is required")
    existing_lc = user_data.get("ligaCategory") or {}
    if existing_lc.get("locked"):
        raise AssignmentError(LOCKED_MESSAGE)
    liga_settings = _load_liga_settings(db)
    grace_period = liga_settings["gracePeriod"]
    categories = _resolve_categories(liga_settings)
    rating = _real_rating(user_data)
    manual = build_manual_assigned(category_name, rating, grace_period, categories)
    if not manual:
        raise AssignmentError(f"Unknown category: {category_name}")
    manual["assignedAt"] = firestore.SERVER_TIMESTAMP
    doc_update: dict = {"ligaCategory.manualAssigned": manual}
    if not existing_lc.get("autoAssigned") and rating is not None:
        auto = build_liga_category(rating, grace_period, categories)
        auto["assignedAt"] = firestore.SERVER_TIMESTAMP
        auto["lastCheckedAt"] = firestore.SERVER_TIMESTAMP
        doc_update["ligaCategory.autoAssigned"] = auto
        doc_update["ligaCategory.locked"] = False
    _write(db, user_doc_id, doc_update, "manual-assign")
    return {"category": manual["category"], "status": manual.get("status")}
