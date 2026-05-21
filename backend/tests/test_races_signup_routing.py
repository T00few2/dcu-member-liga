"""Tests for race signup event/pen routing helpers."""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import races  # noqa: E402


THE_CLASSIC_RACE = {
    "eventMode": "grouped",
    "raceGroups": [
        {
            "name": "High End",
            "eventId": "5593351",
            "eventSecret": "secret",
            "categories": [{"category": "Diamond"}, {"category": "Ruby"}],
        },
        {
            "name": "Mid",
            "eventId": "5593352",
            "eventSecret": "secret",
            "categories": [
                {"category": "Emerald"},
                {"category": "Sapphire"},
                {"category": "Amethyst"},
            ],
        },
        {
            "name": "Low End",
            "eventId": "5593353",
            "eventSecret": "secret",
            "categories": [
                {"category": "Platinum"},
                {"category": "Gold"},
                {"category": "Silver"},
                {"category": "Copper"},
            ],
        },
    ],
}

ZWIFT_EVENT_PAYLOADS = {
    "5593351": {
        "eventSubgroups": [
            {"id": "7158672", "subgroupLabel": "A", "label": 1},
            {"id": "7158673", "subgroupLabel": "B", "label": 2},
        ]
    },
    "5593352": {
        "eventSubgroups": [
            {"id": "7158674", "subgroupLabel": "B", "label": 2},
            {"id": "7158675", "subgroupLabel": "A", "label": 1},
            {"id": "7158676", "subgroupLabel": "C", "label": 3},
        ]
    },
    "5593353": {
        "eventSubgroups": [
            {"id": "7158677", "subgroupLabel": "B", "label": 2},
            {"id": "7158678", "subgroupLabel": "C", "label": 3},
            {"id": "7158679", "subgroupLabel": "A", "label": 1},
            {"id": "7158680", "subgroupLabel": "D", "label": 4},
        ]
    },
}


class FakeZwiftService:
    def get_public_event_info(
        self,
        event_id: str,
        event_secret: str | None = None,
    ):
        return ZWIFT_EVENT_PAYLOADS.get(str(event_id))


@pytest.mark.parametrize(
    ("category", "expected_event_id", "expected_subgroup_id"),
    [
        ("Diamond", "5593351", "7158672"),
        ("Ruby", "5593351", "7158673"),
        ("Emerald", "5593352", "7158675"),
        ("Sapphire", "5593352", "7158674"),
        ("Amethyst", "5593352", "7158676"),
        ("Platinum", "5593353", "7158679"),
        ("Gold", "5593353", "7158677"),
        ("Silver", "5593353", "7158678"),
        ("Copper", "5593353", "7158680"),
    ],
)
def test_grouped_signup_routes_category_to_event_and_pen(
    category: str,
    expected_event_id: str,
    expected_subgroup_id: str,
) -> None:
    _, event_id, _ = races._pick_mode_config_for_user(
        THE_CLASSIC_RACE,
        category,
    )
    assert event_id == expected_event_id

    subgroup_id, error = races._resolve_signup_subgroup_id(
        THE_CLASSIC_RACE,
        category,
        FakeZwiftService(),
    )
    assert error is None
    assert subgroup_id == expected_subgroup_id


def test_silver_does_not_collide_with_emerald() -> None:
    assert races._normalize_liga_category("Silver") != (
        races._normalize_liga_category("Emerald")
    )
    _, event_id, _ = races._pick_mode_config_for_user(
        THE_CLASSIC_RACE,
        "Silver",
    )
    assert event_id == "5593353"


def test_subgroup_label_normalization_supports_e_pen() -> None:
    payload = {
        "eventSubgroups": [
            {"id": "1", "subgroupLabel": "A", "label": 1},
            {"id": "2", "subgroupLabel": "B", "label": 2},
            {"id": "3", "subgroupLabel": "C", "label": 3},
            {"id": "4", "subgroupLabel": "D", "label": 4},
            {"id": "5", "subgroupLabel": "E", "label": 5},
        ]
    }
    assert races._select_subgroup_id_by_index(payload, 4) == "5"
    assert races._select_subgroup_id(payload, "E") == "5"


def test_unknown_category_does_not_fallback_to_first_group() -> None:
    _, event_id, _ = races._pick_mode_config_for_user(
        THE_CLASSIC_RACE,
        "Bronze",
    )
    assert event_id is None


def test_multi_mode_matches_liga_category_by_name() -> None:
    race = {
        "eventMode": "multi",
        "eventConfiguration": [
            {"eventId": "100", "customCategory": "Silver", "eventSecret": "s"},
            {"eventId": "200", "customCategory": "Gold", "eventSecret": "s"},
        ],
    }
    _, event_id, _ = races._pick_mode_config_for_user(race, "Silver")
    assert event_id == "100"
