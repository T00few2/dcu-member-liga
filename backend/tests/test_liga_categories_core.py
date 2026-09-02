import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.liga_categories_core import _compute_liga_update


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
