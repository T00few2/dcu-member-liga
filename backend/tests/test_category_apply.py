import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.category_apply import (
    remap_race_groups,
    remap_user_liga_category,
)
from services.category_changelog import validate_changelog
from services.category_engine import ZR_CATEGORY_DEFS, serialize_liga_category, cats_from_defs
from services.liga_categories_core import effective_user_category


def _gems():
    return copy.deepcopy(ZR_CATEGORY_DEFS)


def _submitted_merge_silver():
    return [d for d in _gems() if d["name"] != "Silver"]


def test_self_select_easier_than_new_floor_dropped():
    ops = [{"op": "mergeUp", "from": "Silver", "into": "Gold"}]
    submitted = _submitted_merge_silver()
    validate_changelog(ZR_CATEGORY_DEFS, ops, submitted)
    lc = {
        "locked": False,
        "autoAssigned": {
            "category": "Silver",
            "upperBoundary": 1000,
            "assignedRating": 900,
            "assignedAt": "t0",
        },
        "selfSelected": {"category": "Copper"},
    }
    next_lc, stats = remap_user_liga_category(
        lc,
        ops=ops,
        new_defs=submitted,
        grace_period=35,
        eff_rating=900,
    )
    assert next_lc is not None
    assert stats["selfDrop"] is True
    assert "selfSelected" not in next_lc
    assert next_lc["autoAssigned"]["category"] == "Gold"


def test_no_velo_auto_name_remapped():
    ops = [{"op": "mergeUp", "from": "Silver", "into": "Gold"}]
    submitted = _submitted_merge_silver()
    lc = {
        "locked": False,
        "autoAssigned": {"category": "Silver", "upperBoundary": 1000, "assignedAt": "t0"},
    }
    next_lc, stats = remap_user_liga_category(
        lc,
        ops=ops,
        new_defs=submitted,
        grace_period=35,
        eff_rating=None,
    )
    assert stats["autoNameOnly"] is True
    assert next_lc["autoAssigned"]["category"] == "Gold"
    assert next_lc["autoAssigned"]["upperBoundary"] == 1150
    assert next_lc["autoAssigned"]["assignedAt"] == "t0"


def test_locked_nested_fields_remapped_still_locked():
    ops = [
        {"op": "mergeUp", "from": "Silver", "into": "Gold"},
        {"op": "rename", "from": "Gold", "to": "Guld"},
    ]
    submitted = []
    for d in _gems():
        if d["name"] == "Silver":
            continue
        row = copy.deepcopy(d)
        if row["name"] == "Gold":
            row["name"] = "Guld"
        submitted.append(row)
    lc = {
        "locked": True,
        "category": "Silver",
        "lockedAt": "lock-ts",
        "autoAssigned": {"category": "Silver", "assignedRating": 900, "assignedAt": "t0"},
        "manualAssigned": {
            "category": "Silver",
            "assignedFrom": "predicted",
            "predictedVelo": 920,
            "assignedRating": 900,
            "assignedAt": "m0",
        },
        "selfSelected": {"category": "Gold"},
    }
    next_lc, stats = remap_user_liga_category(
        lc,
        ops=ops,
        new_defs=submitted,
        grace_period=35,
        eff_rating=900,
    )
    assert next_lc["locked"] is True
    assert next_lc["category"] == "Guld"
    assert next_lc["autoAssigned"]["category"] == "Guld"
    assert next_lc["manualAssigned"]["category"] == "Guld"
    assert next_lc["manualAssigned"]["assignedFrom"] == "predicted"
    assert next_lc["manualAssigned"]["predictedVelo"] == 920
    assert stats["lockedRemap"] is True


def test_split_manual_hold_shown_in_sample():
    ops = [{"op": "split", "from": "Gold", "into": ["Gold A", "Gold B"], "mid": 1075}]
    submitted = []
    for d in _gems():
        if d["name"] != "Gold":
            submitted.append(copy.deepcopy(d))
            continue
        submitted.append({"name": "Gold A", "upper": 1150, "requiresVerification": False})
        submitted.append({"name": "Gold B", "upper": 1075, "requiresVerification": False})
    lc = {
        "locked": False,
        "autoAssigned": {"category": "Gold", "assignedRating": 1100, "assignedAt": "t0"},
        "manualAssigned": {
            "category": "Gold",
            "assignedFrom": "predicted",
            "predictedVelo": 1100,
            "assignedRating": 1100,
            "assignedAt": "m0",
        },
    }
    next_lc, stats = remap_user_liga_category(
        lc,
        ops=ops,
        new_defs=submitted,
        grace_period=35,
        eff_rating=1100,
    )
    assert stats["splitHoldMove"] is True
    assert next_lc["manualAssigned"]["category"] == "Gold A"
    assert stats["sample"]["manual"] == {"from": "Gold", "to": "Gold A"}


def test_serialize_and_signup_routing_use_custom_names():
    defs = [
        {"name": "Guld", "upper": None},
        {"name": "Kobber", "upper": 1000},
    ]
    cats = cats_from_defs(defs)
    lc = {
        "locked": False,
        "autoAssigned": {"category": "Kobber"},
        "selfSelected": {"category": "Guld"},
    }
    serialized = serialize_liga_category(lc, cats)
    assert serialized["category"] == "Guld"
    assert effective_user_category(lc, cats) == "Guld"
    # Without the saved list, both names are unknown in ZR gems and rank -1,
    # so the floor (Kobber) incorrectly wins.
    assert serialize_liga_category(lc)["category"] == "Kobber"


def test_race_group_strings_remapped_membership_unchanged():
    ops = [
        {"op": "mergeUp", "from": "Silver", "into": "Gold"},
        {"op": "rename", "from": "Gold", "to": "Guld"},
    ]
    groups = [
        {
            "id": "high",
            "name": "High end",
            "eventId": "1",
            "categories": [{"category": "Diamond"}, {"category": "Ruby"}],
        },
        {
            "id": "low",
            "name": "Low end",
            "eventId": "3",
            "categories": [
                {"category": "Gold", "sprints": [{"id": 1}]},
                {"category": "Silver", "sprints": [{"id": 2}]},
                {"category": "Bronze"},
            ],
        },
    ]
    next_groups = remap_race_groups(groups, ops)
    assert [g["id"] for g in next_groups] == ["high", "low"]
    assert next_groups[0]["categories"] == groups[0]["categories"]
    low_names = [c["category"] for c in next_groups[1]["categories"]]
    assert low_names == ["Guld", "Bronze"]
    assert next_groups[1]["categories"][0]["sprints"] == [{"id": 1}]
    assert next_groups[1]["eventId"] == "3"


def test_idempotent_second_apply_empty_changelog():
    submitted = _gems()
    lc = {
        "locked": False,
        "autoAssigned": {
            "category": "Gold",
            "upperBoundary": 1150,
            "graceLimit": 1185,
            "assignedRating": 1100,
            "assignedAt": "t0",
            "status": "ok",
            "lastCheckedRating": 1100,
        },
    }
    next_lc, stats = remap_user_liga_category(
        lc,
        ops=[],
        new_defs=submitted,
        grace_period=35,
        eff_rating=1100,
    )
    assert next_lc is None
    assert stats == {}
