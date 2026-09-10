import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.category_engine import build_manual_assigned
from services.liga_categories_core import (
    _compute_liga_update,
    auto_for_predict_assign,
    rebuild_auto_on_release,
)


def test_locked_rider_stays_in_locked_category_and_grace_bounds():
    existing_lc = {
        "locked": True,
        "category": "Platinum",
        "autoAssigned": {
            "assignedRating": 1288,
            "assignedAt": "seed-ts",
            # Simulate a previously overwritten auto assignment.
            "category": "Amethyst",
            "upperBoundary": 1450,
            "graceLimit": 1485,
        },
    }

    update = _compute_liga_update(
        eff_rating=1315,
        existing_lc=existing_lc,
        grace_period=35,
        categories=None,
    )

    assert update["ligaCategory.category"] == "Platinum"
    auto = update["ligaCategory.autoAssigned"]
    assert auto["category"] == "Platinum"
    assert auto["upperBoundary"] == 1300
    assert auto["graceLimit"] == 1335
    assert auto["status"] == "grace"
    assert auto["assignedRating"] == 1288
    assert auto["assignedAt"] == "seed-ts"
    assert auto["lastCheckedRating"] == 1315
    assert "lastCheckedAt" in auto


def test_unlocked_rider_only_updates_auto_assignment():
    existing_lc = {
        "locked": False,
        "autoAssigned": {
            "assignedRating": 1200,
            "assignedAt": "seed-ts",
            "category": "Platinum",
        },
    }

    update = _compute_liga_update(
        eff_rating=1315,
        existing_lc=existing_lc,
        grace_period=35,
        categories=None,
    )

    assert "ligaCategory.category" not in update
    auto = update["ligaCategory.autoAssigned"]
    assert auto["category"] == "Amethyst"
    assert auto["assignedRating"] == 1200
    assert auto["assignedAt"] == "seed-ts"
    assert auto["lastCheckedRating"] == 1315


def test_manual_assignment_survives_nightly_and_tracks_status():
    existing_lc = {
        "locked": False,
        "autoAssigned": {
            "assignedRating": 2100,
            "assignedAt": "seed-ts",
            "category": "Ruby",
        },
        "manualAssigned": {
            "category": "Ruby",
            "assignedFrom": "predicted",
            "predictedVelo": 2000,
            "assignedAt": "manual-ts",
        },
    }

    update = _compute_liga_update(
        eff_rating=2250,
        existing_lc=existing_lc,
        grace_period=35,
        categories=None,
    )

    auto = update["ligaCategory.autoAssigned"]
    assert auto["category"] == "Diamond"
    assert auto["assignedAt"] == "seed-ts"

    manual = update["ligaCategory.manualAssigned"]
    assert manual["category"] == "Ruby"
    assert manual["assignedFrom"] == "predicted"
    assert manual["upperBoundary"] == 2200
    assert manual["status"] == "over"
    assert manual["lastCheckedRating"] == 2250


def test_build_manual_assigned_uses_category_bounds_and_rating_status():
    manual = build_manual_assigned("Platinum", 1225, grace_points=35)
    assert manual is not None
    assert manual["category"] == "Platinum"
    assert manual["assignedFrom"] == "admin"
    assert manual["upperBoundary"] == 1300
    assert manual["graceLimit"] == 1335
    assert manual["assignedRating"] == 1225
    assert manual["status"] == "ok"


def test_build_manual_assigned_marks_over_limit():
    manual = build_manual_assigned("Platinum", 1400, grace_points=35)
    assert manual is not None
    assert manual["status"] == "over"


def test_build_manual_assigned_rejects_unknown_category():
    assert build_manual_assigned("NotACategory", 1200) is None


def test_predict_assign_does_not_overwrite_existing_auto():
    existing = {"category": "Ruby", "assignedRating": 1964, "assignedAt": "seed-ts"}
    assert auto_for_predict_assign(existing, 1775, 35, None) is None


def test_predict_assign_seeds_auto_from_real_rating_when_missing():
    seeded = auto_for_predict_assign({}, 1964, 35, None)
    assert seeded is not None
    assert seeded["category"] == "Ruby"
    assert seeded["assignedRating"] == 1964


def test_release_rebuilds_auto_assigned_rating_from_current_velo():
    existing = {
        "category": "Ruby",
        "assignedRating": 1775,
        "assignedAt": "seed-ts",
        "upperBoundary": 2200,
        "graceLimit": 2235,
        "status": "ok",
    }
    rebuilt = rebuild_auto_on_release(existing, 1964, 35, None)
    assert rebuilt["category"] == "Ruby"
    assert rebuilt["assignedRating"] == 1964
    assert rebuilt["assignedAt"] == "seed-ts"
    assert rebuilt["lastCheckedRating"] == 1964
