"""
Unit tests for ResultsProcessor using mocked Firestore and Zwift services.

Run with:  pytest backend/tests/test_results_processor.py -v
"""

import sys
import os
from unittest.mock import MagicMock

# Stub heavy optional dependencies so tests run without the full production
# requirements (backoff, firebase-admin, google-cloud-firestore, etc.).
# Stub only modules that are not available in the test environment.
# firebase_admin and google.cloud.firestore require service-account credentials
# at import time, so we replace them with MagicMocks.
_STUBS = [
    'firebase_admin', 'firebase_admin.credentials', 'firebase_admin.firestore',
    'firebase_admin.auth',
    'google.cloud', 'google.cloud.firestore',
]
for _s in _STUBS:
    sys.modules.setdefault(_s, MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def mock_doc(doc_id, data):
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = True
    doc.to_dict.return_value = data
    return doc


def mock_doc_missing():
    doc = MagicMock()
    doc.exists = False
    doc.to_dict.return_value = {}
    return doc


def make_race_data(race_id='race1', event_id='event1', results=None):
    return {
        'id': race_id,
        'eventId': event_id,
        'eventSecret': 'secret',
        'sprints': [],
        'segmentType': 'sprint',
        'manualDQs': [],
        'manualDeclassifications': [],
        'manualExclusions': [],
        'results': results or {},
        'type': 'scratch',
    }


def make_rider_data(zwift_id, finish_time=3600000):
    return {
        'zwiftId': str(zwift_id),
        'name': f'Rider {zwift_id}',
        'finishTime': finish_time,
        'finishRank': 0,
        'totalPoints': 0,
        'sprintData': {},
    }


# ---------------------------------------------------------------------------
# ResultsProcessor initialisation tests
# ---------------------------------------------------------------------------

class TestResultsProcessorInit:

    def test_instantiation(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())
        assert rp is not None

    def test_raises_when_no_db(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(None, MagicMock(), MagicMock())
        with pytest.raises(Exception, match='Database not available'):
            rp.process_race_results('race1')

    def test_raises_when_race_not_found(self):
        from services.results_processor import ResultsProcessor
        db = MagicMock()
        db.collection.return_value.document.return_value.get.return_value = mock_doc_missing()
        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        with pytest.raises(Exception, match='not found'):
            rp.process_race_results('race1')

    def test_raises_when_no_event_id(self):
        from services.results_processor import ResultsProcessor
        db = MagicMock()
        race_data = make_race_data(event_id=None)
        db.collection.return_value.document.return_value.get.return_value = mock_doc('race1', race_data)
        db.collection.return_value.stream.return_value = iter([])
        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        with pytest.raises(Exception, match='No Zwift Event ID'):
            rp.process_race_results('race1')


class TestGroupedCategoryResolution:

    def test_prefers_registered_liga_category_when_grouped(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())

        finisher = {'zwiftId': '123'}
        registered = {
            '123': {
                'zwiftId': '123',
                'ligaCategory': {
                    'locked': True,
                    'category': 'Diamond',
                },
            }
        }

        resolved = rp._resolve_grouped_category(
            finisher=finisher,
            registered_riders=registered,
            configured_categories=['Diamond', 'Ruby'],
            subgroup_label='A',
        )
        assert resolved == 'Diamond'

    def test_falls_back_to_subgroup_label_when_category_matches(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())

        finisher = {'zwiftId': '999'}
        resolved = rp._resolve_grouped_category(
            finisher=finisher,
            registered_riders={},
            configured_categories=['A', 'B'],
            subgroup_label='A',
        )
        assert resolved == 'A'


class TestDnfFromSegmentStarters:

    def test_adds_registered_starter_without_finish_as_dnf(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())

        finishers = [{
            'zwiftId': '1',
            'name': 'Finisher',
            'finishTime': 1000,
        }]
        segment_efforts = {
            'seg1': [
                {'athleteId': '1', 'elapsed': 1000, 'worldTime': 10},
                {'athleteId': '2', 'elapsed': 1200, 'worldTime': 12},
            ]
        }
        registered = {
            '1': {'zwiftId': '1', 'name': 'Finisher'},
            '2': {'zwiftId': '2', 'name': 'Starter DNF'},
        }

        out = rp._append_segment_starter_dnfs(finishers, segment_efforts, registered)
        by_id = {str(r['zwiftId']): r for r in out}

        assert set(by_id.keys()) == {'1', '2'}
        assert by_id['2']['finishTime'] == 0
        assert by_id['2']['name'] == 'Starter DNF'

    def test_ignores_unregistered_starters(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())

        finishers = []
        segment_efforts = {'seg1': [{'athleteId': '999'}]}
        registered = {}

        out = rp._append_segment_starter_dnfs(finishers, segment_efforts, registered)
        assert out == []


# ---------------------------------------------------------------------------
# calculate_league_standings (pure aggregation, no Firestore writes)
# ---------------------------------------------------------------------------

class TestCalculateLeagueStandings:

    def test_returns_empty_standings_for_no_races(self):
        from services.results_processor import ResultsProcessor
        db = MagicMock()
        settings_doc = mock_doc('settings', {})
        db.collection.return_value.document.return_value.get.return_value = settings_doc
        db.collection.return_value.stream.return_value = iter([])
        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        assert rp.calculate_league_standings() == {}

    def test_aggregates_race_results_into_standings(self):
        from services.results_processor import ResultsProcessor
        db = MagicMock()

        settings_doc = mock_doc('settings', {
            'bestRacesCount': 3,
            'leagueRankPoints': [20, 17, 15],
        })

        race = make_race_data('r1', results={
            'A': [
                make_rider_data(1, finish_time=3600000),
                make_rider_data(2, finish_time=3700000),
            ]
        })
        race['date'] = '2024-01-01'
        race_doc = MagicMock()
        race_doc.id = 'r1'
        race_doc.to_dict.return_value = race

        def get_side_effect(*args, **kwargs):
            # First call is for settings; subsequent for other docs.
            return settings_doc

        db.collection.return_value.document.return_value.get.side_effect = get_side_effect
        db.collection.return_value.stream.return_value = iter([race_doc])

        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        standings = rp.calculate_league_standings()
        # Basic structure check — the engine assigns league points.
        assert isinstance(standings, dict)
