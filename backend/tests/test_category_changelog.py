import copy
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.category_changelog import (
    CategoryChangelogError,
    liga_categories_fingerprint,
    reduce_ops_to_remap,
    resolve_name_through_ops,
    validate_changelog,
)
from services.category_engine import ZR_CATEGORY_DEFS


def _submitted_without(names_to_drop: set[str], rename: dict[str, str] | None = None) -> list[dict]:
    out = []
    for d in ZR_CATEGORY_DEFS:
        name = d["name"]
        if name in names_to_drop:
            continue
        row = copy.deepcopy(d)
        if rename and name in rename:
            row["name"] = rename[name]
        out.append(row)
    return out


def test_merge_only_silver_into_gold():
    ops = [{"op": "mergeUp", "from": "Silver", "into": "Gold"}]
    submitted = _submitted_without({"Silver"})
    result = validate_changelog(ZR_CATEGORY_DEFS, ops, submitted)
    assert result["remap"] == {"Silver": "Gold"}
    assert result["splits"] == []
    assert [d["name"] for d in result["produced"]] == [d["name"] for d in submitted]


def test_rename_only_gold_to_guld():
    ops = [{"op": "rename", "from": "Gold", "to": "Guld"}]
    submitted = _submitted_without(set(), {"Gold": "Guld"})
    result = validate_changelog(ZR_CATEGORY_DEFS, ops, submitted)
    assert result["remap"] == {"Gold": "Guld"}
    assert resolve_name_through_ops("Gold", None, ops) == "Guld"


def test_merge_then_rename_composite_map():
    ops = [
        {"op": "mergeUp", "from": "Silver", "into": "Gold"},
        {"op": "rename", "from": "Gold", "to": "Guld"},
    ]
    submitted = _submitted_without({"Silver"}, {"Gold": "Guld"})
    result = validate_changelog(ZR_CATEGORY_DEFS, ops, submitted)
    assert result["remap"] == {"Silver": "Guld", "Gold": "Guld"}
    assert reduce_ops_to_remap(ops) == {"Silver": "Guld", "Gold": "Guld"}
    assert resolve_name_through_ops("Silver", 900, ops) == "Guld"
    assert resolve_name_through_ops("Gold", 1100, ops) == "Guld"


def test_split_gold_into_a_b():
    ops = [{"op": "split", "from": "Gold", "into": ["Gold A", "Gold B"], "mid": 1075}]
    submitted = []
    for d in ZR_CATEGORY_DEFS:
        if d["name"] != "Gold":
            submitted.append(copy.deepcopy(d))
            continue
        submitted.append({"name": "Gold A", "upper": 1150, "requiresVerification": False})
        submitted.append({"name": "Gold B", "upper": 1075, "requiresVerification": False})
    result = validate_changelog(ZR_CATEGORY_DEFS, ops, submitted)
    assert result["remap"] == {}
    assert result["splits"][0]["from"] == "Gold"
    assert resolve_name_through_ops("Gold", 1100, ops) == "Gold A"
    assert resolve_name_through_ops("Gold", 1050, ops) == "Gold B"


def test_bounds_only_empty_map():
    submitted = copy.deepcopy(ZR_CATEGORY_DEFS)
    submitted[6]["upper"] = 1160  # Gold
    result = validate_changelog(ZR_CATEGORY_DEFS, [], submitted)
    assert result["remap"] == {}
    assert result["splits"] == []
    assert result["produced"][6]["upper"] == 1160


def test_duplicate_names_rejected():
    submitted = copy.deepcopy(ZR_CATEGORY_DEFS)
    submitted[1]["name"] = "Diamond"
    with pytest.raises(CategoryChangelogError, match="Duplicate"):
        validate_changelog(ZR_CATEGORY_DEFS, [], submitted)


def test_changelog_that_does_not_produce_submitted_list_rejected():
    ops = [{"op": "mergeUp", "from": "Silver", "into": "Gold"}]
    with pytest.raises(CategoryChangelogError, match="does not produce"):
        validate_changelog(ZR_CATEGORY_DEFS, ops, ZR_CATEGORY_DEFS)


def test_unknown_op_rejected():
    ops = [{"op": "invent"}]
    with pytest.raises(CategoryChangelogError, match="Unknown changelog op"):
        validate_changelog(ZR_CATEGORY_DEFS, ops, ZR_CATEGORY_DEFS)


def test_fingerprint_mismatch_detectable_for_stale_preview():
    before = liga_categories_fingerprint(ZR_CATEGORY_DEFS)
    after = liga_categories_fingerprint([d for d in ZR_CATEGORY_DEFS if d["name"] != "Silver"])
    assert before != after
    assert before == liga_categories_fingerprint(copy.deepcopy(ZR_CATEGORY_DEFS))
    a = liga_categories_fingerprint(ZR_CATEGORY_DEFS)
    b = liga_categories_fingerprint(copy.deepcopy(ZR_CATEGORY_DEFS))
    assert a == b
    other = copy.deepcopy(ZR_CATEGORY_DEFS)
    other[0]["requiresVerification"] = True
    assert liga_categories_fingerprint(other) != a
