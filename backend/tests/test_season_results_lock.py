"""This season's stored points still come out of the scorers.

The fixture is a read of Firestore taken before the route-profile change.
It keeps Zwift ids and points and drops rider names. The test does not call
Zwift and does not write Firestore.

Category-transfer rows are stored with 0 finish points. RaceScorer still
assigns those rows last-place finish points, which is separate from the
season table. The lock covers season totals, and finish and sprint points
for riders who are not transfer credits.
"""
from __future__ import annotations

import copy
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.category_config import CategoryConfigResolver
from services.category_transfer_logic import is_category_transfer
from services.results.classification_standings import apply_classification_standings
from services.results.race_scorer import RaceScorer
from services.results.season_engine import SeasonEngine, season_mode_enabled

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "season_results_lock.json")


def _load() -> dict:
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _points_map(standings: dict) -> dict:
    out = {}
    for category, riders in (standings or {}).items():
        if not isinstance(riders, list):
            continue
        out[str(category)] = {
            str(rider.get("zwiftId")): {
                "totalPoints": _int(rider.get("totalPoints")),
                "sprintPoints": _int(rider.get("sprintPoints")),
                "komPoints": _int(rider.get("komPoints")),
            }
            for rider in riders
            if isinstance(rider, dict) and rider.get("zwiftId")
        }
    return out


def test_season_standings_match_the_stored_table():
    fixture = _load()
    settings = fixture["settings"]
    events = fixture["events"]
    races = {race["id"]: race for race in fixture["races"]}
    assert season_mode_enabled(settings, len(events))
    computed = SeasonEngine(settings).calculate_standings(events, races)
    computed = apply_classification_standings(
        computed,
        races,
        season_mode=True,
        stage_race_ids={str(event.get("id") or "") for event in events},
        catalogs=fixture["catalogs"],
    )
    assert _points_map(computed) == fixture["standings"]


def test_race_points_match_for_riders_who_were_not_transferred():
    fixture = _load()
    settings = fixture["settings"]
    scorer = RaceScorer(settings["finishPoints"], settings["sprintPoints"])
    for race in fixture["races"]:
        for category, riders in (race.get("results") or {}).items():
            config = CategoryConfigResolver.get_race_config(race, category)
            updated = scorer.calculate_results(
                copy.deepcopy(riders),
                config,
                segment_efforts_map=None,
            )
            by_id = {str(rider.get("zwiftId")): rider for rider in updated}
            for stored in riders:
                if is_category_transfer(stored):
                    continue
                got = by_id[str(stored.get("zwiftId"))]
                assert _int(got.get("finishPoints")) == _int(stored.get("finishPoints"))
                assert _int(got.get("sprintPoints")) == _int(stored.get("sprintPoints"))
