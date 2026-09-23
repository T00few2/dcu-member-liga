"""Sprint and KOM season totals from route profile segment types."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.classification_jerseys import build_classification_jerseys
from services.results.classification_standings import (
    apply_classification_standings,
    banner_class,
    index_profile_segments,
)


PARIS = [
    {"name": "Lutece Sprint", "type": "sprint", "direction": "forward"},
    {"name": "Monceau Sprint", "type": "sprint", "direction": "forward"},
    {"name": "Montmartre KOM", "type": "climb", "direction": "forward"},
    {"name": "Tchou Tchou Sprint", "type": "sprint", "direction": "reverse"},
    {"name": "Champs-Elysees", "type": "segment", "direction": "forward"},
]


def _race(race_id, results, *, sprints, phase="finalized", stage_race_id="event-1"):
    return {
        "id": race_id,
        "resultsPhase": phase,
        "stageRaceId": stage_race_id,
        "segmentType": "sprint",
        "sprints": sprints,
        "results": results,
    }


def _rider(zwift_id, details, name=None):
    return {
        "zwiftId": str(zwift_id),
        "name": name or f"Rider {zwift_id}",
        "sprintDetails": details,
    }


SPRINTS = [
    {"id": "1", "count": 1, "key": "1_1", "name": "Lutece Sprint", "direction": "forward"},
    {"id": "2", "count": 1, "key": "2_1", "name": "Montmartre KOM", "direction": "forward"},
    {"id": "3", "count": 1, "key": "3_1", "name": "Champs-Elysees", "direction": "forward"},
]


def test_banner_class_uses_profile_type_not_the_name():
    index = index_profile_segments(PARIS)
    assert banner_class({"name": "Montmartre KOM", "direction": "forward"}, index) == "kom"
    assert banner_class({"name": "Lutece Sprint", "direction": "forward"}, index) == "sprint"
    assert banner_class({"name": "Champs-Elysees", "direction": "forward"}, index) is None
    assert banner_class({"name": "Tchou Tchou Sprint", "direction": "reverse"}, index) == "sprint"


def test_sums_every_finalized_race_and_ignores_untyped_banners():
    races = {
        "r1": _race("r1", {
            "A": [_rider(1, {"1_1": 5, "2_1": 3, "3_1": 5})],
        }, sprints=SPRINTS),
        "r2": _race("r2", {
            "A": [_rider(1, {"1_1": 3, "2_1": 5})],
        }, sprints=SPRINTS),
    }
    standings = apply_classification_standings(
        {"A": [{"zwiftId": "1", "name": "Ada", "totalPoints": 40, "raceCount": 2, "results": []}]},
        races,
        season_mode=True,
        stage_race_ids={"event-1"},
        catalogs=[PARIS],
    )
    rider = standings["A"][0]
    assert rider["sprintPoints"] == 8
    assert rider["komPoints"] == 8
    assert rider["sprintResults"] == [
        {"raceId": "r1", "points": 5, "lastBannerPoints": 5},
        {"raceId": "r2", "points": 3, "lastBannerPoints": 3},
    ]
    assert rider["totalPoints"] == 40


def test_provisional_race_does_not_count_and_split_times_are_ignored():
    races = {
        "provisional": _race(
            "provisional",
            {"A": [_rider(1, {"1_1": 5})]},
            sprints=SPRINTS,
            phase="provisional",
        ),
        "split": _race(
            "split",
            {"A": [_rider(1, {"1_1": 5_000_000_000})]},
            sprints=SPRINTS,
        ),
    }
    standings = apply_classification_standings(
        {"A": [{"zwiftId": "1", "name": "Ada", "totalPoints": 10, "results": []}]},
        races,
        season_mode=True,
        stage_race_ids={"event-1"},
        catalogs=[PARIS],
    )
    assert standings["A"][0]["sprintPoints"] == 0
    assert standings["A"][0]["komPoints"] == 0


def test_rider_with_only_classification_points_is_added():
    races = {
        "r1": _race("r1", {"A": [_rider(9, {"2_1": 5}, name="Bea")]}, sprints=SPRINTS),
    }
    standings = apply_classification_standings(
        {"A": [{"zwiftId": "1", "name": "Ada", "totalPoints": 10, "results": []}]},
        races,
        season_mode=True,
        stage_race_ids={"event-1"},
        catalogs=[PARIS],
    )
    by_id = {row["zwiftId"]: row for row in standings["A"]}
    assert by_id["9"]["komPoints"] == 5
    assert by_id["9"]["totalPoints"] == 0
    assert by_id["9"]["name"] == "Bea"


def test_last_banner_points_are_the_final_occurrence():
    sprints = [
        {"id": "2", "lap": 1, "count": 1, "key": "2_1", "name": "Montmartre KOM", "direction": "forward"},
        {"id": "1", "lap": 1, "count": 1, "key": "1_1", "name": "Lutece Sprint", "direction": "forward"},
        {"id": "2", "lap": 2, "count": 2, "key": "2_2", "name": "Montmartre KOM", "direction": "forward"},
        {"id": "1", "lap": 2, "count": 2, "key": "1_2", "name": "Lutece Sprint", "direction": "forward"},
    ]
    standings = apply_classification_standings(
        {"A": [{"zwiftId": "1", "name": "Ada", "totalPoints": 10, "results": []}]},
        {"r1": _race("r1", {"A": [_rider(1, {"2_1": 5, "2_2": 1, "1_1": 3, "1_2": 2})]}, sprints=sprints)},
        season_mode=True,
        stage_race_ids={"event-1"},
        catalogs=[PARIS],
    )
    rider = standings["A"][0]
    assert rider["komPoints"] == 6
    assert rider["komResults"] == [{"raceId": "r1", "points": 6, "lastBannerPoints": 1}]
    assert rider["sprintResults"] == [{"raceId": "r1", "points": 5, "lastBannerPoints": 2}]


def test_unsaved_route_uses_zwift_catalog_type():
    sprints = [{"id": "1055881124", "count": 1, "key": "1055881124_1", "name": "Montmartre KOM", "direction": "forward"}]
    standings = apply_classification_standings(
        {"1. Division": [{"zwiftId": "1", "name": "Ada", "totalPoints": 10, "results": []}]},
        {"r1": _race("r1", {"1. Division": [_rider(1, {"1055881124_1": 5})]}, sprints=sprints)},
        season_mode=True,
        stage_race_ids={"event-1"},
        catalogs=[],
    )
    assert standings["1. Division"][0]["komPoints"] == 5
    assert standings["1. Division"][0]["sprintPoints"] == 0


def test_manual_exclusion_is_skipped():
    race = _race("r1", {"A": [_rider(1, {"1_1": 5})]}, sprints=SPRINTS)
    race["manualExclusions"] = ["1"]
    standings = apply_classification_standings(
        {"A": [{"zwiftId": "1", "name": "Ada", "totalPoints": 10, "results": []}]},
        {"r1": race},
        season_mode=True,
        stage_race_ids={"event-1"},
        catalogs=[PARIS],
    )
    assert standings["A"][0]["sprintPoints"] == 0


def test_classification_jerseys_keep_catalog_image_and_drop_empty_slots():
    catalog = {
        7: {"name": "Green", "imageName": "green_thumb", "imageUrl": "https://cdn.example/green.png"},
    }
    stored = build_classification_jerseys(
        {
            "individual": {"jerseySignature": 7, "jerseyName": "", "imageName": ""},
            "sprint": None,
            "kom": {"jerseySignature": "nope"},
        },
        catalog,
    )
    assert stored == {
        "individual": {
            "jerseySignature": 7,
            "jerseyName": "Green",
            "imageName": "green_thumb",
            "imageUrl": "https://cdn.example/green.png",
        }
    }
