import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.race_structure import overlay_race_groups, race_has_results, template_category_coverage


TEMPLATE = [
    {
        "id": "high",
        "name": "High end",
        "categories": [{"category": "Diamond"}, {"category": "Ruby"}],
    },
    {
        "id": "mid",
        "name": "Mid",
        "categories": [
            {"category": "Emerald"},
            {"category": "Sapphire"},
            {"category": "Amethyst"},
        ],
    },
    {
        "id": "low",
        "name": "Low end",
        "categories": [
            {"category": "Platinum"},
            {"category": "Gold"},
            {"category": "Silver"},
            {"category": "Bronze"},
            {"category": "Copper"},
        ],
    },
]


def _race_groups():
    return [
        {
            "id": "high",
            "name": "High end",
            "eventId": "111",
            "eventSecret": "s1",
            "categories": [
                {"category": "Diamond", "sprints": [{"id": 1}]},
                {"category": "Ruby"},
            ],
        },
        {
            "id": "mid",
            "name": "Mid",
            "eventId": "222",
            "categories": [
                {"category": "Emerald"},
                {"category": "Sapphire"},
                {"category": "Amethyst"},
                {"category": "Platinum", "sprints": [{"id": 9}]},
            ],
        },
        {
            "id": "low",
            "name": "Low end",
            "eventId": "333",
            "categories": [
                {"category": "Gold", "sprints": [{"id": 2}]},
                {"category": "Silver"},
                {"category": "Bronze"},
                {"category": "Copper"},
            ],
        },
    ]


def test_platinum_mid_to_low_keeps_event_ids():
    result = overlay_race_groups(TEMPLATE, _race_groups())
    next_groups = result["next"]
    by_name = {g["name"]: g for g in next_groups}
    assert by_name["Mid"]["eventId"] == "222"
    assert by_name["Low end"]["eventId"] == "333"
    mid_names = [c["category"] for c in by_name["Mid"]["categories"]]
    low_names = [c["category"] for c in by_name["Low end"]["categories"]]
    assert "Platinum" not in mid_names
    assert "Platinum" in low_names
    platinum = next(c for c in by_name["Low end"]["categories"] if c["category"] == "Platinum")
    assert platinum.get("sprints") == [{"id": 9}]
    gold = next(c for c in by_name["Low end"]["categories"] if c["category"] == "Gold")
    assert gold["sprints"] == [{"id": 2}]


def test_sprints_follow_category_when_it_changes_group():
    result = overlay_race_groups(TEMPLATE, _race_groups())
    mid = next(g for g in result["next"] if g["name"] == "Mid")
    assert all(c["category"] != "Platinum" for c in mid["categories"])
    low = next(g for g in result["next"] if g["name"] == "Low end")
    platinum = next(c for c in low["categories"] if c["category"] == "Platinum")
    assert platinum.get("sprints") == [{"id": 9}]


def test_case_insensitive_group_names():
    race = _race_groups()
    race[1]["name"] = "mid"
    result = overlay_race_groups(TEMPLATE, race)
    mid = next(g for g in result["next"] if g["id"] == "mid")
    assert mid["eventId"] == "222"
    assert mid["name"] == "Mid"


def test_group_rename_dry_run_flags_dropped_event_id():
    template = [
        {**TEMPLATE[0]},
        {**TEMPLATE[1]},
        {**TEMPLATE[2], "id": "low-new", "name": "Low"},
    ]
    result = overlay_race_groups(template, _race_groups())
    assert result["diff"]["droppedEventIds"]
    assert any(w for w in result["diff"]["warnings"] if "eventId" in w)
    appended = next(g for g in result["next"] if g["name"] == "Low")
    assert appended["eventId"] == ""


def test_group_rename_same_id_keeps_event_id():
    template = [
        {**TEMPLATE[0]},
        {**TEMPLATE[1]},
        {**TEMPLATE[2], "name": "Low"},
    ]
    result = overlay_race_groups(template, _race_groups())
    low = next(g for g in result["next"] if g["id"] == "low")
    assert low["eventId"] == "333"
    assert low["name"] == "Low"
    assert result["diff"]["droppedEventIds"] == []


def test_renamed_groups_keep_sprints_via_leftover_id():
    race = [
        {
            "id": "high",
            "name": "High end",
            "sprints": [{"id": "hs"}],
            "categories": [{"category": "Division 1", "sprints": [{"id": "c1"}]}],
        },
        {
            "id": "mid",
            "name": "Mid",
            "sprints": [{"id": "ms"}],
            "categories": [{"category": "Division 4"}],
        },
        {
            "id": "low",
            "name": "Low end",
            "sprints": [{"id": "ls"}],
            "categories": [{"category": "Division 5", "sprints": [{"id": "c5"}]}],
        },
    ]
    template = [
        {
            "id": "high",
            "name": "Division 1-3",
            "categories": [{"category": "Division 1"}, {"category": "Division 5"}],
        },
        {
            "id": "mid",
            "name": "Division 4-6",
            "categories": [{"category": "Division 4"}],
        },
    ]
    result = overlay_race_groups(template, race)
    high = next(g for g in result["next"] if g["id"] == "high")
    mid = next(g for g in result["next"] if g["id"] == "mid")
    assert high["sprints"] == [{"id": "hs"}]
    assert high["name"] == "Division 1-3"
    d1 = next(c for c in high["categories"] if c["category"] == "Division 1")
    d5 = next(c for c in high["categories"] if c["category"] == "Division 5")
    assert d1["sprints"] == [{"id": "c1"}]
    assert d5["sprints"] == [{"id": "c5"}]
    assert mid["sprints"] == [{"id": "ms"}]
    assert result["diff"]["dropped"] == ["Low end"]


def test_results_skip_helper():
    assert race_has_results({"results": {}}) is False
    assert race_has_results({"results": {"Gold": []}}) is False
    assert race_has_results({"results": {"Gold": [{"zwiftId": "1"}]}}) is True


def test_template_coverage():
    names = ["Diamond", "Ruby", "Emerald", "Sapphire", "Amethyst", "Platinum", "Gold", "Silver", "Bronze", "Copper"]
    assert template_category_coverage(TEMPLATE, names)["ok"] is True
    bad = [{**TEMPLATE[0], "categories": [{"category": "Diamond"}]}]
    cov = template_category_coverage(bad, ["Diamond", "Ruby"])
    assert cov["ok"] is False
    assert "Ruby" in cov["missing"]
