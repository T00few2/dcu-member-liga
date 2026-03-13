"""
Unit tests for RaceScorer.

Run with:  pytest backend/tests/test_race_scorer.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from services.results.race_scorer import RaceScorer


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

FINISH_POINTS = [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
SPRINT_POINTS = [5, 3, 2, 1]


def make_rider(zwift_id, finish_time=3600000, sprint_data=None):
    return {
        'zwiftId': str(zwift_id),
        'name': f'Rider {zwift_id}',
        'finishTime': finish_time,
        'finishRank': 0,
        'totalPoints': 0,
        'sprintData': sprint_data or {},
    }


def make_config(manual_dqs=None, manual_declassifications=None, manual_exclusions=None,
                sprints=None, segment_type='sprint'):
    return {
        'manualDQs': manual_dqs or [],
        'manualDeclassifications': manual_declassifications or [],
        'manualExclusions': manual_exclusions or [],
        'sprints': sprints or [],
        'segmentType': segment_type,
    }


@pytest.fixture
def scorer():
    return RaceScorer(
        finish_points_scheme=FINISH_POINTS,
        sprint_points_scheme=SPRINT_POINTS,
    )


# ---------------------------------------------------------------------------
# Finish points
# ---------------------------------------------------------------------------

class TestFinishPoints:

    def test_fastest_gets_most_points(self, scorer):
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),
            make_rider(3, finish_time=3800000),
        ]
        result = scorer.calculate_results(riders, make_config())
        by_id = {r['zwiftId']: r for r in result}
        assert by_id['1']['finishPoints'] == FINISH_POINTS[0]
        assert by_id['2']['finishPoints'] == FINISH_POINTS[1]
        assert by_id['3']['finishPoints'] == FINISH_POINTS[2]

    def test_dnf_rider_gets_no_finish_points(self, scorer):
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=0),   # DNF
        ]
        result = scorer.calculate_results(riders, make_config())
        by_id = {r['zwiftId']: r for r in result}
        assert by_id['1']['finishPoints'] > 0
        assert by_id['2']['finishPoints'] == 0

    def test_finish_rank_assigned_correctly(self, scorer):
        riders = [
            make_rider(3, finish_time=3800000),
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),
        ]
        result = scorer.calculate_results(riders, make_config())
        by_id = {r['zwiftId']: r for r in result}
        assert by_id['1']['finishRank'] == 1
        assert by_id['2']['finishRank'] == 2
        assert by_id['3']['finishRank'] == 3

    def test_empty_riders_returns_empty(self, scorer):
        result = scorer.calculate_results([], make_config())
        assert result == []


# ---------------------------------------------------------------------------
# Manual DQ / Declassification / Exclusion
# ---------------------------------------------------------------------------

class TestManualOverrides:

    def test_dq_rider_is_disqualified(self, scorer):
        riders = [make_rider(1), make_rider(2)]
        config = make_config(manual_dqs=['1'])
        result = scorer.calculate_results(riders, config)
        by_id = {r['zwiftId']: r for r in result}
        assert by_id['1']['disqualified'] is True
        assert by_id['1']['finishPoints'] == 0
        assert by_id['2']['disqualified'] is False

    def test_declassified_rider_appears_after_valid_riders(self, scorer):
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),  # declassified
            make_rider(3, finish_time=3800000),
        ]
        config = make_config(manual_declassifications=['2'])
        result = scorer.calculate_results(riders, config)
        by_id = {r['zwiftId']: r for r in result}
        # Declassified rider's rank should be worse than valid riders
        assert by_id['2']['declassified'] is True
        assert by_id['2']['finishRank'] > by_id['1']['finishRank']
        assert by_id['2']['finishRank'] > by_id['3']['finishRank']

    def test_excluded_rider_absent_from_results(self, scorer):
        riders = [make_rider(1), make_rider(2)]
        config = make_config(manual_exclusions=['1'])
        result = scorer.calculate_results(riders, config)
        ids = [r['zwiftId'] for r in result]
        assert '1' not in ids
        assert '2' in ids

    def test_dq_and_exclusion_together(self, scorer):
        riders = [make_rider(1), make_rider(2), make_rider(3)]
        config = make_config(manual_dqs=['2'], manual_exclusions=['3'])
        result = scorer.calculate_results(riders, config)
        by_id = {r['zwiftId']: r for r in result}
        assert '3' not in by_id
        assert by_id['2']['disqualified'] is True
        assert by_id['1']['disqualified'] is False


# ---------------------------------------------------------------------------
# Empty / edge-case scenarios
# ---------------------------------------------------------------------------

class TestEdgeCases:

    def test_all_riders_dnf(self, scorer):
        riders = [make_rider(1, finish_time=0), make_rider(2, finish_time=0)]
        result = scorer.calculate_results(riders, make_config())
        for r in result:
            assert r['finishPoints'] == 0
            assert r['finishRank'] == 0

    def test_scorer_without_points_scheme(self):
        scorer = RaceScorer(finish_points_scheme=[], sprint_points_scheme=[])
        riders = [make_rider(1), make_rider(2)]
        result = scorer.calculate_results(riders, make_config())
        for r in result:
            assert r['finishPoints'] == 0

    def test_more_riders_than_points_scheme_entries(self, scorer):
        # RaceScorer should assign 0 points beyond the end of the scheme.
        riders = [make_rider(i, finish_time=3600000 + i * 1000) for i in range(1, 25)]
        result = scorer.calculate_results(riders, make_config())
        by_id = {r['zwiftId']: r for r in result}
        # First rider gets full points; riders beyond scheme get 0.
        assert by_id['1']['finishPoints'] == FINISH_POINTS[0]
        assert by_id['20']['finishPoints'] == 0
