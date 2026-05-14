"""
Unit tests for ResultsProcessor using mocked Firestore and Zwift services.

Run with:  conda run -n py311 python -m pytest backend/tests/test_results_processor.py -v
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

from services.results.constants import (
    CATEGORY_FILTER_ALL,
    FETCH_MODE_FINISHERS,
    FETCH_MODE_LIVE,
    RESULTS_PHASE_FINALIZED,
    RESULTS_PHASE_PROVISIONAL,
)
from services.results.errors import EventInfoFetchError


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


def build_process_results_db(race_data, users=None, settings=None):
    db = MagicMock()

    race_doc = mock_doc(race_data.get('id', 'race1'), race_data)
    race_doc_ref = MagicMock()
    race_doc_ref.get.return_value = race_doc
    race_doc_ref.update = MagicMock()

    races_collection = MagicMock()
    races_collection.document.return_value = race_doc_ref

    league_settings = settings if settings is not None else {
        'finishPoints': [10, 8, 6],
        'sprintPoints': [3, 2, 1],
    }
    settings_doc = mock_doc('settings', league_settings)
    league_doc_ref = MagicMock()
    league_doc_ref.get.return_value = settings_doc
    league_collection = MagicMock()
    league_collection.document.return_value = league_doc_ref

    users_collection = MagicMock()
    users_collection.stream.return_value = iter(users or [])

    def collection_side_effect(name):
        if name == 'races':
            return races_collection
        if name == 'league':
            return league_collection
        if name == 'users':
            return users_collection
        other = MagicMock()
        other.stream.return_value = iter([])
        return other

    db.collection.side_effect = collection_side_effect
    return db


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

    def test_build_grouped_subgroup_category_map_uses_subgroup_label_order(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())

        subgroups = [
            {'id': '2', 'subgroupLabel': 'B'},
            {'id': '1', 'subgroupLabel': 'A'},
        ]
        mapped = rp._build_grouped_subgroup_category_map(subgroups, ['Diamond', 'Ruby'])
        assert mapped == {'1': 'Diamond', '2': 'Ruby'}


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
        assert by_id['2']['raceStatus'] == 'DNF'

    def test_ignores_unregistered_starters(self):
        from services.results_processor import ResultsProcessor
        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())

        finishers = []
        segment_efforts = {'seg1': [{'athleteId': '999'}]}
        registered = {}

        out = rp._append_segment_starter_dnfs(finishers, segment_efforts, registered)
        assert out == []

    def test_adds_provisional_starters_without_overwriting_existing_finishers(self):
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
            '2': {'zwiftId': '2', 'name': 'Starter Only'},
        }

        out = rp._append_provisional_segment_starters(finishers, segment_efforts, registered)
        by_id = {str(r['zwiftId']): r for r in out}
        assert set(by_id.keys()) == {'1', '2'}
        assert by_id['2']['finishTime'] == 0
        assert by_id['2']['name'] == 'Starter Only'


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


class TestProcessRaceResultsBranching:
    @pytest.mark.parametrize(
        "event_mode,race_patch,expected_sources",
        [
            (
                "grouped",
                {
                    'raceGroups': [
                        {'eventId': 'g-1', 'eventSecret': 's1', 'categories': []},
                        {'eventId': 'g-2', 'eventSecret': 's2', 'categories': []},
                    ],
                },
                2,
            ),
            (
                "multi",
                {
                    'eventConfiguration': [
                        {'eventId': 'm-1', 'subgroupId': 'sg-1', 'customCategory': 'A', 'eventSecret': 's1'},
                        {'eventId': 'm-2', 'subgroupId': 'sg-2', 'customCategory': 'B', 'eventSecret': 's2'},
                    ],
                },
                2,
            ),
        ],
    )
    def test_builds_expected_event_sources_per_mode(self, event_mode, race_patch, expected_sources):
        from services.results_processor import ResultsProcessor

        race_data = make_race_data()
        race_data.update({'eventMode': event_mode, **race_patch})
        db = build_process_results_db(race_data)

        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        rp._process_event_source = MagicMock(return_value=True)
        rp.save_league_standings = MagicMock(return_value={})

        rp.process_race_results(
            race_data['id'],
            fetch_mode=FETCH_MODE_FINISHERS,
            category_filter=CATEGORY_FILTER_ALL,
        )

        assert rp._process_event_source.call_count == expected_sources

    @pytest.mark.parametrize(
        "fetch_mode,category_filter",
        [
            (FETCH_MODE_FINISHERS, CATEGORY_FILTER_ALL),
            (FETCH_MODE_LIVE, "A"),
        ],
    )
    def test_forwards_fetch_mode_and_category_filter_to_source_processor(
        self,
        fetch_mode,
        category_filter,
    ):
        from services.results_processor import ResultsProcessor

        race_data = make_race_data()
        race_data.update({
            'eventMode': 'multi',
            'eventConfiguration': [
                {'eventId': 'm-1', 'subgroupId': 'sg-1', 'customCategory': 'A', 'eventSecret': 's1'},
            ],
        })
        db = build_process_results_db(race_data)

        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        rp._process_event_source = MagicMock(return_value=True)
        rp.save_league_standings = MagicMock(return_value={})

        rp.process_race_results(
            race_data['id'],
            fetch_mode=fetch_mode,
            category_filter=category_filter,
        )

        assert rp._process_event_source.call_count == 1
        call = rp._process_event_source.call_args
        # Positional args: source, race_data, registered_riders, scorer, all_results,
        # fetch_mode, category_filter, results_phase
        assert call.args[5] == fetch_mode
        assert call.args[6] == category_filter
        assert call.args[7] == RESULTS_PHASE_FINALIZED

    def test_process_event_source_returns_false_on_event_info_fetch_error(self):
        from services.results_processor import ResultsProcessor

        rp = ResultsProcessor(MagicMock(), MagicMock(), MagicMock())
        rp.zwift_fetcher.get_event_info = MagicMock(
            side_effect=EventInfoFetchError("bad event lookup")
        )

        source = {
            'id': 'evt-1',
            'secret': 's1',
            'customCategory': None,
            'categoryConfigMap': {},
            'groupedMode': False,
            'sprints': [],
            'segmentType': None,
        }
        ok = rp._process_event_source(
            source=source,
            race_data={'name': 'Race', 'date': '2026-05-01'},
            registered_riders={},
            scorer=MagicMock(),
            all_results={},
            fetch_mode=FETCH_MODE_FINISHERS,
            category_filter=CATEGORY_FILTER_ALL,
            results_phase=RESULTS_PHASE_FINALIZED,
        )
        assert ok is False

    def test_persists_provisional_metadata(self):
        from services.results_processor import ResultsProcessor

        race_data = make_race_data()
        race_data.update({
            'eventMode': 'multi',
            'eventConfiguration': [
                {'eventId': 'm-1', 'subgroupId': 'sg-1', 'customCategory': 'A', 'eventSecret': 's1'},
            ],
        })
        db = build_process_results_db(race_data)

        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        rp._process_event_source = MagicMock(side_effect=lambda *args, **kwargs: args[4].update({'A': []}) or True)
        rp.save_league_standings = MagicMock(return_value={})

        rp.process_race_results(
            race_data['id'],
            fetch_mode=FETCH_MODE_FINISHERS,
            category_filter=CATEGORY_FILTER_ALL,
            results_phase=RESULTS_PHASE_PROVISIONAL,
        )

        race_ref = db.collection('races').document.return_value
        assert race_ref.update.called
        payload = race_ref.update.call_args.args[0]
        assert payload.get('resultsPhase') == RESULTS_PHASE_PROVISIONAL
        assert payload.get('provisionalUpdatedAt') is not None

    def test_persists_finalized_metadata_and_finalize_run_id(self):
        from services.results_processor import ResultsProcessor

        race_data = make_race_data()
        race_data.update({
            'eventMode': 'multi',
            'eventConfiguration': [
                {'eventId': 'm-1', 'subgroupId': 'sg-1', 'customCategory': 'A', 'eventSecret': 's1'},
            ],
        })
        db = build_process_results_db(race_data)

        rp = ResultsProcessor(db, MagicMock(), MagicMock())
        rp._process_event_source = MagicMock(side_effect=lambda *args, **kwargs: args[4].update({'A': []}) or True)
        rp.save_league_standings = MagicMock(return_value={})

        rp.process_race_results(
            race_data['id'],
            fetch_mode=FETCH_MODE_FINISHERS,
            category_filter=CATEGORY_FILTER_ALL,
            results_phase=RESULTS_PHASE_FINALIZED,
            finalize_run_id='run-123',
        )

        race_ref = db.collection('races').document.return_value
        payload = race_ref.update.call_args.args[0]
        assert payload.get('resultsPhase') == RESULTS_PHASE_FINALIZED
        assert payload.get('finalizedAt') is not None
        assert payload.get('finalizeRunId') == 'run-123'
