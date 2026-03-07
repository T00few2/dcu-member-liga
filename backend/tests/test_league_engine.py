"""
Unit tests for LeagueEngine.

Run with:  pytest backend/tests/test_league_engine.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest
from services.results.league_engine import LeagueEngine


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_rider(zwift_id, finish_time=0, finish_rank=0, total_points=0, sprint_data=None):
    return {
        'zwiftId': str(zwift_id),
        'name': f'Rider {zwift_id}',
        'finishTime': finish_time,
        'finishRank': finish_rank,
        'totalPoints': total_points,
        'sprintData': sprint_data or {},
    }


def make_race(race_id, race_type, results, date='2024-01-01', manual_dqs=None,
              manual_declassifications=None, manual_exclusions=None, sprints=None):
    return {
        'id': race_id,
        'type': race_type,
        'date': date,
        'results': results,
        'manualDQs': manual_dqs or [],
        'manualDeclassifications': manual_declassifications or [],
        'manualExclusions': manual_exclusions or [],
        'sprints': sprints or [],
    }


RANK_POINTS = [20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]
SETTINGS = {
    'bestRacesCount': 3,
    'leagueRankPoints': RANK_POINTS,
    'finishPoints': [],
}


# ---------------------------------------------------------------------------
# Scratch race
# ---------------------------------------------------------------------------

class TestScratchRace:

    def test_fastest_wins(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),
            make_rider(3, finish_time=3800000),
        ]
        race = make_race('r1', 'scratch', {'A': riders})
        standings = engine.calculate_standings([race])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        assert cat['1'] > cat['2'] > cat['3']
        assert cat['1'] == RANK_POINTS[0]
        assert cat['2'] == RANK_POINTS[1]
        assert cat['3'] == RANK_POINTS[2]

    def test_dnf_riders_excluded_from_ranking(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=0),  # DNF
        ]
        race = make_race('r1', 'scratch', {'A': riders})
        standings = engine.calculate_standings([race])
        ids = [r['zwiftId'] for r in standings['A']]
        assert '1' in ids
        assert '2' not in ids  # DNF gets no points

    def test_manual_dq_gets_zero_points(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),
        ]
        race = make_race('r1', 'scratch', {'A': riders}, manual_dqs=['1'])
        standings = engine.calculate_standings([race])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        assert cat.get('1', 0) == 0
        assert cat['2'] == RANK_POINTS[0]

    def test_declassified_rider_goes_last(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3600000),  # Fastest
            make_rider(2, finish_time=3700000),
            make_rider(3, finish_time=3800000),
        ]
        race = make_race('r1', 'scratch', {'A': riders}, manual_declassifications=['1'])
        standings = engine.calculate_standings([race])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        # Rider 1 should have fewer points than rider 2 (placed last)
        assert cat['1'] < cat['2']

    def test_manual_exclusion_hidden_from_standings(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),
        ]
        race = make_race('r1', 'scratch', {'A': riders}, manual_exclusions=['2'])
        standings = engine.calculate_standings([race])
        ids = [r['zwiftId'] for r in standings['A']]
        assert '2' not in ids


# ---------------------------------------------------------------------------
# Points race
# ---------------------------------------------------------------------------

class TestPointsRace:

    def test_most_points_wins(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, total_points=50, finish_time=3600000),
            make_rider(2, total_points=30, finish_time=3700000),
            make_rider(3, total_points=10, finish_time=3800000),
        ]
        race = make_race('r1', 'points', {'A': riders})
        standings = engine.calculate_standings([race])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        assert cat['1'] > cat['2'] > cat['3']
        assert cat['1'] == RANK_POINTS[0]

    def test_rider_with_no_activity_excluded(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, total_points=50, finish_time=3600000),
            make_rider(2, total_points=0, finish_time=0, sprint_data={}),  # No activity
        ]
        race = make_race('r1', 'points', {'A': riders})
        standings = engine.calculate_standings([race])
        ids = [r['zwiftId'] for r in standings['A']]
        assert '1' in ids
        assert '2' not in ids


# ---------------------------------------------------------------------------
# Time trial
# ---------------------------------------------------------------------------

class TestTimeTrial:

    def _make_tt_race(self, riders, manual_dqs=None, manual_declassifications=None,
                      manual_exclusions=None):
        return make_race(
            'tt1', 'time-trial',
            {'A': riders},
            manual_dqs=manual_dqs,
            manual_declassifications=manual_declassifications,
            manual_exclusions=manual_exclusions,
            sprints=[
                {'id': 1, 'count': 1, 'key': 'seg1', 'type': 'split'},
                {'id': 2, 'count': 1, 'key': 'seg2', 'type': 'split'},
            ],
        )

    def test_fastest_finisher_wins(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3600000),
            make_rider(2, finish_time=3700000),
        ]
        race = self._make_tt_race(riders)
        standings = engine.calculate_standings([race])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        assert cat['1'] > cat['2']

    def test_finishers_rank_above_non_finishers(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=0, sprint_data={
                'seg1': {'worldTime': 1700000600000, 'time': 60000}
            }),
            make_rider(2, finish_time=3600000),
        ]
        race = self._make_tt_race(riders)
        standings = engine.calculate_standings([race])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        assert cat['2'] > cat['1']  # finisher outranks segment-only rider


# ---------------------------------------------------------------------------
# Best X races
# ---------------------------------------------------------------------------

class TestBestRaces:

    def test_only_best_races_count(self):
        """With bestRacesCount=2, only top 2 race points should be summed."""
        engine = LeagueEngine({**SETTINGS, 'bestRacesCount': 2})
        riders = [make_rider(1, finish_time=3600000)]

        races = [
            make_race(f'r{i}', 'scratch', {'A': riders}, date=f'2024-01-0{i+1}')
            for i in range(4)
        ]
        standings = engine.calculate_standings(races)
        # With bestRacesCount=2 rider gets points from 2 races only
        assert standings['A'][0]['totalPoints'] == RANK_POINTS[0] * 2

    def test_best_races_picks_highest_scoring(self):
        """Rider gets different points in different races; best two should be summed."""
        engine = LeagueEngine({**SETTINGS, 'bestRacesCount': 2})
        r1 = make_race('r1', 'scratch', {
            'A': [make_rider(1, finish_time=3600000), make_rider(2, finish_time=3700000)]
        }, date='2024-01-01')
        r2 = make_race('r2', 'scratch', {
            'A': [make_rider(2, finish_time=3600000), make_rider(1, finish_time=3700000)]
        }, date='2024-01-02')
        r3 = make_race('r3', 'scratch', {
            'A': [make_rider(2, finish_time=3600000), make_rider(1, finish_time=3700000)]
        }, date='2024-01-03')
        standings = engine.calculate_standings([r1, r2, r3])
        cat = {r['zwiftId']: r['totalPoints'] for r in standings['A']}
        # Rider 1 wins r1 (RANK_POINTS[0]) and gets RANK_POINTS[1] in r2 and r3
        # Best 2: RANK_POINTS[0] + RANK_POINTS[1]
        assert cat['1'] == RANK_POINTS[0] + RANK_POINTS[1]


# ---------------------------------------------------------------------------
# Multiple categories
# ---------------------------------------------------------------------------

class TestMultipleCategories:

    def test_categories_are_independent(self):
        engine = LeagueEngine(SETTINGS)
        race = make_race('r1', 'scratch', {
            'A': [make_rider(1, finish_time=3600000)],
            'B': [make_rider(2, finish_time=3600000)],
        })
        standings = engine.calculate_standings([race])
        assert '1' in [r['zwiftId'] for r in standings['A']]
        assert '2' in [r['zwiftId'] for r in standings['B']]

    def test_rider_in_multiple_categories_ranked_separately(self):
        engine = LeagueEngine(SETTINGS)
        # Same zwiftId appears in both categories (edge case)
        race = make_race('r1', 'scratch', {
            'A': [make_rider(99, finish_time=3600000)],
            'B': [make_rider(99, finish_time=3600000)],
        })
        standings = engine.calculate_standings([race])
        assert standings['A'][0]['zwiftId'] == '99'
        assert standings['B'][0]['zwiftId'] == '99'


# ---------------------------------------------------------------------------
# Empty / edge cases
# ---------------------------------------------------------------------------

class TestEdgeCases:

    def test_empty_races_returns_empty_standings(self):
        engine = LeagueEngine(SETTINGS)
        assert engine.calculate_standings([]) == {}

    def test_race_without_results_skipped(self):
        engine = LeagueEngine(SETTINGS)
        race = {'id': 'r1', 'type': 'scratch', 'date': '2024-01-01',
                'results': {}, 'manualDQs': [], 'manualDeclassifications': [],
                'manualExclusions': []}
        assert engine.calculate_standings([race]) == {}

    def test_no_league_rank_points_falls_back_to_raw_points(self):
        """When leagueRankPoints is empty, totalPoints from race data is used directly."""
        engine = LeagueEngine({'bestRacesCount': 3, 'leagueRankPoints': [], 'finishPoints': []})
        riders = [
            make_rider(1, total_points=42, finish_time=3600000),
        ]
        race = make_race('r1', 'points', {'A': riders})
        standings = engine.calculate_standings([race])
        assert standings['A'][0]['totalPoints'] == 42

    def test_standings_sorted_highest_points_first(self):
        engine = LeagueEngine(SETTINGS)
        riders = [
            make_rider(1, finish_time=3900000),  # Slowest
            make_rider(2, finish_time=3700000),
            make_rider(3, finish_time=3600000),  # Fastest
        ]
        race = make_race('r1', 'scratch', {'A': riders})
        standings = engine.calculate_standings([race])
        points = [r['totalPoints'] for r in standings['A']]
        assert points == sorted(points, reverse=True)

    def test_all_dq_riders_get_zero_points(self):
        engine = LeagueEngine(SETTINGS)
        riders = [make_rider(i, finish_time=3600000 + i * 1000) for i in range(1, 4)]
        race = make_race('r1', 'scratch', {'A': riders}, manual_dqs=['1', '2', '3'])
        standings = engine.calculate_standings([race])
        for r in standings['A']:
            assert r['totalPoints'] == 0
