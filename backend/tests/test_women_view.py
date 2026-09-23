"""Women-only rescore: places and points as if men had not started."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.results.season_points_defaults import DEFAULT_SEASON_RANK_POINTS
from services.results.women_view import build_women_view, women_ids_from_user_docs


def test_women_ids_require_male_false():
    ids = women_ids_from_user_docs([
        {"zwiftId": "1", "zwiftProfile": {"male": False}},
        {"zwiftId": "2", "zwiftProfile": {"male": True}},
        {"zwiftId": "3", "zwiftProfile": {}},
        {"zwiftId": "", "zwiftProfile": {"male": False}},
    ])
    assert ids == {"1"}


def test_slower_woman_becomes_the_winner_and_takes_first_place_season_points():
    race = {
        "id": "r1",
        "date": "2026-06-01T18:00:00Z",
        "resultsPhase": "finalized",
        "stageRaceId": "event-1",
        "type": "points",
        "segmentType": "sprint",
        "sprints": [{"id": "1", "count": 1, "key": "1_1", "name": "Lutece Sprint", "direction": "forward"}],
        "results": {
            "A": [
                {
                    "zwiftId": "man",
                    "name": "Adam",
                    "finishTime": 1000,
                    "sprintData": {"1_1": {"worldTime": 10, "time": 10}},
                },
                {
                    "zwiftId": "woman",
                    "name": "Ada",
                    "finishTime": 2000,
                    "sprintData": {"1_1": {"worldTime": 20, "time": 20}},
                },
            ]
        },
    }
    view = build_women_view(
        {"r1": race},
        [{
            "id": "event-1",
            "name": "Monument",
            "seasonClass": "monument",
            "resultsPhase": "finalized",
            "bestRacesCount": 1,
            "date": "2026-06-01T18:00:00Z",
            "standings": {},
        }],
        {
            "finishPoints": [20, 10],
            "sprintPoints": [5, 3],
            "seasonRankPoints": DEFAULT_SEASON_RANK_POINTS,
        },
        {"woman"},
        catalogs=[[{"name": "Lutece Sprint", "type": "sprint", "direction": "forward"}]],
    )
    riders = view["races"][0]["results"]["A"]
    assert [rider["zwiftId"] for rider in riders] == ["woman"]
    assert riders[0]["finishRank"] == 1
    assert riders[0]["finishPoints"] == 20
    assert riders[0]["sprintPoints"] == 5
    assert riders[0]["sprintDetails"]["1_1"] == 5

    season = view["standings"]["A"]
    assert [row["zwiftId"] for row in season] == ["woman"]
    assert season[0]["totalPoints"] == 800
    assert season[0]["sprintPoints"] == 5
