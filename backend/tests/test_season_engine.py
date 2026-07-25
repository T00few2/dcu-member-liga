"""
Unit tests for SeasonEngine and stage-race finalize helpers.

Run with:  pytest backend/tests/test_season_engine.py -v
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.results.season_engine import SeasonEngine, season_mode_enabled
from services.results.season_points_defaults import (
    DEFAULT_SEASON_RANK_POINTS,
    points_for_place,
)
from services.results.stage_race_ops import (
    all_stages_finalized,
    finalize_event,
    maybe_auto_finalize_one_day,
    unfinalize_stage,
)


RANK_POINTS = [20, 17, 15, 13, 11]


def make_rider(zwift_id, total_points=0, finish_rank=0, finish_time=0):
    return {
        "zwiftId": str(zwift_id),
        "name": f"Rider {zwift_id}",
        "totalPoints": total_points,
        "finishRank": finish_rank,
        "finishTime": finish_time,
        "sprintData": {},
    }


def make_stage(race_id, *, event_id, index, phase, results, race_type="points"):
    return {
        "id": race_id,
        "name": race_id,
        "type": race_type,
        "date": f"2026-05-0{index}T19:00",
        "stageRaceId": event_id,
        "stageIndex": index,
        "resultsPhase": phase,
        "results": results,
        "manualDQs": [],
        "manualDeclassifications": [],
        "manualExclusions": [],
    }


SETTINGS = {
    "leagueRankPoints": RANK_POINTS,
    "bestRacesCount": 5,
    "seasonRankPoints": DEFAULT_SEASON_RANK_POINTS,
    "seasonBestResultsCount": 0,
}


class TestPointsForPlace:
    def test_by_place_and_range(self):
        table = DEFAULT_SEASON_RANK_POINTS["monument"]
        assert points_for_place(table, 1) == 800
        assert points_for_place(table, 16) == 50
        assert points_for_place(table, 22) == 30
        assert points_for_place(table, 100) == 0


class TestSeasonEngineTour:
    def test_tour_stage_points_only_when_stage_finalized(self):
        event = {
            "id": "tour1",
            "seasonClass": "tour",
            "resultsPhase": "provisional",
            "standings": {},
            "bestRacesCount": 2,
        }
        stages = {
            "s1": make_stage(
                "s1",
                event_id="tour1",
                index=1,
                phase="finalized",
                results={"A": [make_rider(1, total_points=100), make_rider(2, total_points=50)]},
            ),
            "s2": make_stage(
                "s2",
                event_id="tour1",
                index=2,
                phase="provisional",
                results={"A": [make_rider(1, total_points=10), make_rider(2, total_points=90)]},
            ),
        }
        standings = SeasonEngine(SETTINGS).calculate_standings([event], stages)
        by_id = {e["zwiftId"]: e for e in standings["A"]}
        # Only stage 1 counts: rider1 place 1 = 210, rider2 place 2 = 150
        assert by_id["1"]["totalPoints"] == points_for_place(
            DEFAULT_SEASON_RANK_POINTS["tour_stage"], 1
        )
        assert by_id["2"]["totalPoints"] == points_for_place(
            DEFAULT_SEASON_RANK_POINTS["tour_stage"], 2
        )
        assert all(r.get("source") == "stage" for r in by_id["1"]["results"])

    def test_tour_gc_only_when_event_finalized(self):
        event = {
            "id": "tour1",
            "seasonClass": "tour",
            "resultsPhase": "finalized",
            "bestRacesCount": 1,
            "standings": {
                "A": [
                    {"zwiftId": "1", "name": "Rider 1", "totalPoints": 40},
                    {"zwiftId": "2", "name": "Rider 2", "totalPoints": 20},
                ]
            },
        }
        stages = {
            "s1": make_stage(
                "s1",
                event_id="tour1",
                index=1,
                phase="finalized",
                results={"A": [make_rider(1, total_points=100)]},
            ),
        }
        standings = SeasonEngine(SETTINGS).calculate_standings([event], stages)
        by_id = {e["zwiftId"]: e for e in standings["A"]}
        stage_pts = points_for_place(DEFAULT_SEASON_RANK_POINTS["tour_stage"], 1)
        gc_pts = points_for_place(DEFAULT_SEASON_RANK_POINTS["tour_overall"], 1)
        assert by_id["1"]["totalPoints"] == stage_pts + gc_pts
        sources = {r["source"] for r in by_id["1"]["results"]}
        assert sources == {"stage", "gc"}


class TestSeasonEngineOneDay:
    def test_monument_gc_gated_on_event_finalize(self):
        event_prov = {
            "id": "m1",
            "seasonClass": "monument",
            "resultsPhase": "provisional",
            "standings": {
                "A": [{"zwiftId": "1", "name": "Rider 1", "totalPoints": 20}]
            },
        }
        stages = {
            "s1": make_stage(
                "s1",
                event_id="m1",
                index=1,
                phase="finalized",
                results={"A": [make_rider(1, total_points=100)]},
            ),
        }
        empty = SeasonEngine(SETTINGS).calculate_standings([event_prov], stages)
        assert empty == {} or "A" not in empty or empty["A"] == []

        event_fin = {**event_prov, "resultsPhase": "finalized"}
        standings = SeasonEngine(SETTINGS).calculate_standings([event_fin], stages)
        assert standings["A"][0]["totalPoints"] == points_for_place(
            DEFAULT_SEASON_RANK_POINTS["monument"], 1
        )
        assert standings["A"][0]["results"][0]["source"] == "gc"


class TestSeasonBestX:
    def test_best_results_count_limits_total(self):
        settings = {**SETTINGS, "seasonBestResultsCount": 1}
        event = {
            "id": "tour1",
            "seasonClass": "tour",
            "resultsPhase": "finalized",
            "standings": {
                "A": [{"zwiftId": "1", "name": "R1", "totalPoints": 99}]
            },
        }
        stages = {
            "s1": make_stage(
                "s1",
                event_id="tour1",
                index=1,
                phase="finalized",
                results={"A": [make_rider(1, total_points=100), make_rider(2, total_points=10)]},
            ),
        }
        standings = SeasonEngine(settings).calculate_standings([event], stages)
        rider = next(e for e in standings["A"] if e["zwiftId"] == "1")
        # Stage win 210 vs GC 1st 1300 — best-1 keeps GC only
        assert rider["totalPoints"] == points_for_place(
            DEFAULT_SEASON_RANK_POINTS["tour_overall"], 1
        )
        assert len(rider["results"]) == 2  # all lines retained; total is best-X


class TestSeasonMode:
    def test_enabled_by_events_or_tables(self):
        assert season_mode_enabled({}, 1) is True
        assert season_mode_enabled({"seasonRankPoints": {"tour_stage": {}}}, 0) is True
        assert season_mode_enabled({}, 0) is False


class TestFinalizeHelpers:
    def test_all_stages_finalized(self):
        assert all_stages_finalized([]) is False
        assert all_stages_finalized([{"resultsPhase": "finalized"}]) is True
        assert all_stages_finalized(
            [{"resultsPhase": "finalized"}, {"resultsPhase": "provisional"}]
        ) is False

    def test_auto_finalize_one_day(self):
        db = MagicMock()
        event = {"id": "m1", "seasonClass": "monument", "resultsPhase": "provisional"}
        stages = [{"resultsPhase": "finalized"}]
        updated = maybe_auto_finalize_one_day(db, event, stages)
        assert updated["resultsPhase"] == "finalized"
        db.collection.assert_called_with("stageRaces")

    def test_auto_finalize_skips_tour(self):
        db = MagicMock()
        event = {"id": "t1", "seasonClass": "tour", "resultsPhase": "provisional"}
        stages = [{"resultsPhase": "finalized"}]
        updated = maybe_auto_finalize_one_day(db, event, stages)
        assert updated["resultsPhase"] == "provisional"
        db.collection.assert_not_called()

    def test_finalize_event_requires_all_stages(self):
        db = MagicMock()
        event = {"id": "t1", "seasonClass": "tour", "bestRacesCount": 1}
        races = {
            "s1": {
                "id": "s1",
                "stageRaceId": "t1",
                "stageIndex": 1,
                "resultsPhase": "provisional",
                "results": {"A": [make_rider(1, total_points=10)]},
            }
        }
        try:
            finalize_event(db, event, races, SETTINGS)
            assert False, "expected ValueError"
        except ValueError as e:
            assert "All stages must be finalized" in str(e)

    def test_unfinalize_stage_blocked_when_tour_event_finalized(self):
        db = MagicMock()
        race = {"id": "s1", "stageRaceId": "t1", "resultsPhase": "finalized"}
        event = {"id": "t1", "seasonClass": "tour", "resultsPhase": "finalized"}
        try:
            unfinalize_stage(db, "s1", race, event)
            assert False, "expected ValueError"
        except ValueError as e:
            assert "Un-finalize the parent event" in str(e)

    def test_unfinalize_stage_cascades_one_day(self):
        db = MagicMock()
        race = {"id": "s1", "stageRaceId": "m1", "resultsPhase": "finalized"}
        event = {"id": "m1", "seasonClass": "monument", "resultsPhase": "finalized"}
        updated = unfinalize_stage(db, "s1", race, event)
        assert updated["resultsPhase"] == "provisional"
        # event + stage writes
        assert db.collection.call_count >= 2
