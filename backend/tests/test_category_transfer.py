"""Category move credits: last place in the new division, original rows unchanged."""
import copy
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.category_transfer_logic import (
    apply_credits_to_races,
    merge_transfer_credits,
    plan_credits,
    protected_ids_for_race,
    strip_transfer_rows,
    undo_blocked_by_later_result,
)
from services.results.league_engine import LeagueEngine
from services.results.race_scorer import RaceScorer

RANK = [20, 17, 15, 13, 11]
SETTINGS = {'bestRacesCount': 3, 'leagueRankPoints': RANK, 'finishPoints': [10, 8, 6, 4]}


def rider(zid, finish_time, **extra):
    row = {
        'zwiftId': str(zid),
        'name': f'Rider {zid}',
        'club': 'North',
        'finishTime': finish_time,
        'finishRank': 1,
        'finishPoints': 10,
        'sprintPoints': 3,
        'totalPoints': 13,
        'raceStatus': 'FIN' if finish_time else 'DNF',
    }
    row.update(extra)
    return row


def race(race_id, results, **extra):
    data = {
        'id': race_id,
        'name': race_id,
        'type': 'scratch',
        'date': '2026-05-01',
        'resultsPhase': 'finalized',
        'results': results,
        'manualDQs': [],
        'manualDeclassifications': [],
        'manualExclusions': [],
    }
    data.update(extra)
    return data


def test_original_place_unchanged_and_new_division_is_last():
    races = [race('r1', {'A': [rider('1', 1000), rider('2', 1100)], 'B': [rider('9', 900)]})]
    original = copy.deepcopy(races)
    credits, skipped = plan_credits(races, '1', 'B')
    assert skipped == []
    assert [item['raceId'] for item in credits] == ['r1']
    updated = apply_credits_to_races(
        races, zwift_id='1', to_category='B', credits=credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )
    assert races == original
    assert updated[0]['results']['A'] == original[0]['results']['A']
    transferred = updated[0]['results']['B']
    assert transferred[-1]['zwiftId'] == '1'
    assert transferred[-1]['categoryTransfer'] is True
    assert transferred[-1]['finishRank'] == 2
    assert transferred[-1]['sprintPoints'] == 0
    assert transferred[-1]['finishTime'] == 0

    engine = LeagueEngine(SETTINGS)
    before = engine.calculate_standings(races)
    after = engine.calculate_standings(updated)
    old_before = {row['zwiftId']: row['totalPoints'] for row in before['A']}
    old_after = {row['zwiftId']: row['totalPoints'] for row in after['A']}
    assert old_after == old_before
    new_points = {row['zwiftId']: row['totalPoints'] for row in after['B']}
    assert new_points['9'] == RANK[0]
    assert new_points['1'] == RANK[1]


def test_dnf_is_not_credited():
    races = [race('r1', {'A': [rider('1', 0)]})]
    credits, skipped = plan_credits(races, '1', 'B')
    assert credits == []
    assert skipped[0]['reason'] == 'DNF'


def test_shared_last_place_does_not_move_finishers():
    races = [race('r1', {
        'B': [
            rider('9', 900),
            rider('8', 950, declassified=True),
        ],
    })]
    races[0]['manualDeclassifications'] = ['8']
    # Rider 8 is declassified but still a timed finish in A as well? Keep them only in B.
    # A separate moved rider joins B.
    races[0]['results']['A'] = [rider('1', 1000)]
    credits, _skipped = plan_credits(races, '1', 'B')
    updated = apply_credits_to_races(
        races, zwift_id='1', to_category='B', credits=credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )
    engine = LeagueEngine(SETTINGS)
    standings = engine.calculate_standings(updated)
    points = {row['zwiftId']: row['totalPoints'] for row in standings['B']}
    assert points['9'] == RANK[0]
    assert points['8'] == points['1'] == RANK[1]


def test_best_of_can_drop_the_credit():
    engine_one = LeagueEngine({**SETTINGS, 'bestRacesCount': 1})
    engine_two = LeagueEngine({**SETTINGS, 'bestRacesCount': 2})
    # r1 already has a finisher in B, so the credit is 2nd. r2 is a win.
    first = race('r1', {'A': [rider('1', 1000)], 'B': [rider('9', 900)]})
    second = race('r2', {'B': [rider('1', 800), rider('3', 900)]})
    credits, _skipped = plan_credits([first], '1', 'B')
    moved = apply_credits_to_races(
        [first, second], zwift_id='1', to_category='B', credits=credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )
    kept = engine_one.calculate_standings(moved)
    both = engine_two.calculate_standings(moved)
    kept_points = next(item for item in kept['B'] if item['zwiftId'] == '1')['totalPoints']
    both_points = next(item for item in both['B'] if item['zwiftId'] == '1')['totalPoints']
    assert kept_points == RANK[0]
    assert both_points == RANK[0] + RANK[1]


def test_second_move_credits_every_real_finish_and_keeps_earlier_credit():
    races = [
        race('r1', {'A': [rider('1', 1000)], 'B': [rider('9', 900)]}),
        race('r2', {'B': [rider('1', 1200), rider('9', 1100)]}),
    ]
    first_credits, _skipped = plan_credits([races[0]], '1', 'B')
    after_first = apply_credits_to_races(
        races, zwift_id='1', to_category='B', credits=first_credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )
    second_credits, _skipped = plan_credits(after_first, '1', 'C')
    assert sorted(item['raceId'] for item in second_credits) == ['r1', 'r2']
    after_second = apply_credits_to_races(
        after_first, zwift_id='1', to_category='C', credits=second_credits,
        transfer_id='t2', finish_points_scheme=SETTINGS['finishPoints'],
    )
    assert any(row['zwiftId'] == '1' and row.get('transferId') == 't1' for row in after_second[0]['results']['B'])
    assert after_second[0]['results']['A'][0]['finishTime'] == 1000
    assert sorted(row['transferId'] for row in after_second[0]['results']['C'] + after_second[1]['results']['C']) == ['t2', 't2']


def test_results_refresh_keeps_the_real_row_and_restores_the_credit():
    races = [race('r1', {'A': [rider('1', 1000)], 'B': [rider('9', 900)]})]
    credits, _skipped = plan_credits(races, '1', 'B')
    applied = apply_credits_to_races(
        races, zwift_id='1', to_category='B', credits=credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )[0]
    transfer = {
        'id': 't1',
        'zwiftId': '1',
        'toCategory': 'B',
        'status': 'applied',
        'creditedRaceIds': ['r1'],
    }
    assert protected_ids_for_race([transfer], 'r1') == {'1'}
    rewritten = {'A': applied['results']['A'], 'B': [rider('9', 900)]}
    restored = merge_transfer_credits(rewritten, applied, [transfer], SETTINGS['finishPoints'])
    assert restored['A'][0]['finishTime'] == 1000
    assert restored['A'][0].get('categoryTransfer') is not True
    assert any(row.get('categoryTransfer') for row in restored['B'])


def test_undo_removes_only_the_latest_credit_and_blocks_after_a_real_result():
    races = [race('r1', {'A': [rider('1', 1000)], 'B': [rider('9', 900)], 'C': []})]
    credits, _skipped = plan_credits(races, '1', 'B')
    once = apply_credits_to_races(
        races, zwift_id='1', to_category='B', credits=credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )
    twice = apply_credits_to_races(
        once, zwift_id='1', to_category='C', credits=plan_credits(once, '1', 'C')[0],
        transfer_id='t2', finish_points_scheme=SETTINGS['finishPoints'],
    )
    undone = strip_transfer_rows(twice, 't2')
    assert any(row.get('transferId') == 't1' for row in undone[0]['results']['B'])
    assert not any(row.get('transferId') == 't2' for row in undone[0]['results'].get('C') or [])
    assert undo_blocked_by_later_result(
        [race('r2', {'B': [rider('1', 500)]})],
        zwift_id='1',
        to_category='B',
        preexisting_race_ids=[],
    ) is True
    assert undo_blocked_by_later_result(
        races,
        zwift_id='1',
        to_category='B',
        preexisting_race_ids=[],
    ) is False


def test_season_points_follow_the_new_division_and_the_old_table_stays():
    from services.category_transfer_logic import score_standings

    settings = {
        'bestRacesCount': 3,
        'leagueRankPoints': RANK,
        'finishPoints': SETTINGS['finishPoints'],
        'seasonRankPoints': {'tour_stage': {'byPlace': [50, 30, 10], 'ranges': []}, 'tour_overall': {'byPlace': [100, 40], 'ranges': []}},
        'seasonBestResultsCount': 0,
    }
    event = {'id': 'e1', 'seasonClass': 'tour', 'bestRacesCount': 2, 'resultsPhase': 'finalized'}
    races = [race('r1', {'A': [rider('1', 1000), rider('2', 1100)], 'B': [rider('9', 900)]}, stageRaceId='e1')]
    credits, _skipped = plan_credits(races, '1', 'B')
    moved = apply_credits_to_races(
        races, zwift_id='1', to_category='B', credits=credits,
        transfer_id='t1', finish_points_scheme=SETTINGS['finishPoints'],
    )
    before = score_standings(races, [event], settings)
    after = score_standings(moved, [event], settings)
    old_before = next(row['totalPoints'] for row in before['A'] if row['zwiftId'] == '1')
    old_after = next(row['totalPoints'] for row in after['A'] if row['zwiftId'] == '1')
    assert old_after == old_before
    new_points = next(row['totalPoints'] for row in after['B'] if row['zwiftId'] == '1')
    assert new_points > 0
    assert new_points != old_after


def test_scorer_keeps_transfer_last_and_clears_primes():
    scorer = RaceScorer(SETTINGS['finishPoints'], [5, 3, 1])
    rows = scorer.calculate_results(
        [rider('9', 900), rider('1', 0, categoryTransfer=True, raceStatus='XFER', sprintData={'s': {'worldTime': 1, 'time': 1}})],
        {'manualDQs': [], 'manualDeclassifications': [], 'manualExclusions': [], 'sprints': [], 'segmentType': 'sprint'},
    )
    by_id = {row['zwiftId']: row for row in rows}
    assert by_id['9']['finishRank'] == 1
    assert by_id['1']['finishRank'] == 2
    assert by_id['1']['finishPoints'] == SETTINGS['finishPoints'][1]
    assert by_id['1']['sprintPoints'] == 0
    assert by_id['1']['raceStatus'] == 'XFER'


def test_womens_field_puts_the_credit_last_among_women():
    from services.results.women_view import rescore_race_for_women

    stored = race('r1', {
        'Ruby': [
            rider('9', 900),
            rider('2', 950),
            rider('1', 0, categoryTransfer=True, raceStatus='XFER'),
        ],
    })
    rescored = rescore_race_for_women(stored, {'9', '1'}, RaceScorer(SETTINGS['finishPoints'], [5, 3, 1]))
    by_id = {row['zwiftId']: row for row in rescored['results']['Ruby']}
    assert set(by_id) == {'9', '1'}
    assert by_id['9']['finishRank'] == 1
    assert by_id['1']['finishRank'] == 2
    assert by_id['1']['finishPoints'] == SETTINGS['finishPoints'][1]
    assert stored['results']['Ruby'][1]['zwiftId'] == '2'


class _Snap:
    def __init__(self, data=None, exists=False, doc_id=''):
        self._data = data or {}
        self.exists = exists
        self.id = doc_id

    def to_dict(self):
        return dict(self._data)


class _WriteGuard:
    def __init__(self):
        self.writes = 0

    def set(self, *_args, **_kwargs):
        self.writes += 1
        raise AssertionError('dry run wrote a document')

    def update(self, *_args, **_kwargs):
        self.writes += 1
        raise AssertionError('dry run wrote a document')

    def get(self):
        return _Snap(exists=False)


class _Query:
    def __init__(self, docs):
        self._docs = docs

    def stream(self):
        return list(self._docs)

    def document(self, doc_id):
        for doc in self._docs:
            if doc.id == doc_id:
                return doc
        return _Snap(exists=False, doc_id=doc_id)


class _FakeDb:
    def __init__(self, races):
        self.guard = _WriteGuard()
        self._races = races
        self._settings = _Snap({
            'finishPoints': SETTINGS['finishPoints'],
            'leagueRankPoints': RANK,
            'bestRacesCount': 3,
            'ligaCategories': [
                {'name': 'Diamond', 'upper': None},
                {'name': 'Ruby', 'upper': 2200},
            ],
        }, exists=True, doc_id='settings')

    def collection(self, name):
        if name == 'league':
            return _Query([self._settings])
        if name == 'races':
            return _RaceQuery(self._races, self.guard)
        if name == 'stageRaces':
            return _Query([])
        return _Query([])


class _RaceQuery(_Query):
    def __init__(self, docs, guard):
        super().__init__(docs)
        self.guard = guard

    def document(self, doc_id):
        parent = super().document(doc_id)
        parent.collection = lambda _name: _Query([])
        parent.set = self.guard.set
        parent.update = self.guard.update
        return parent


def test_dry_run_writes_nothing():
    from services.category_transfer import build_move_preview

    races = [race('r1', {'Ruby': [rider('1', 1000)], 'Diamond': [rider('9', 900)]})]
    db = _FakeDb([type('Doc', (), {
        'id': 'r1',
        'exists': True,
        'to_dict': lambda self, payload=races[0]: {key: value for key, value in payload.items() if key != 'id'},
    })()])
    preview = build_move_preview(
        db,
        zwift_id='1',
        user_data={'name': 'Ada', 'ligaCategory': {'category': 'Ruby', 'locked': True}},
        to_category='Diamond',
    )
    assert db.guard.writes == 0
    assert preview['dryRun'] is True
    assert preview['races'][0]['assignedPlace'] == 2
    assert preview['message'] == 'Dry run — no writes'


def test_move_up_and_the_panel_share_apply_move(monkeypatch):
    from services.category_transfer import _profile_fields, move_rider_up

    calls = []

    def fake_apply(_db, **kwargs):
        calls.append(kwargs)
        return {'message': 'Rider moved to Silver', 'transferId': 't1', 'category': 'Silver', 'races': []}

    monkeypatch.setattr('services.category_transfer.apply_move', fake_apply)
    monkeypatch.setattr(
        'services.category_transfer._load_liga_settings',
        lambda _db: {'gracePeriod': 35, 'categories': None},
    )

    class _Db:
        def collection(self, name):
            raise AssertionError(f'move up must not write {name} itself')

    user = {
        'name': 'Mathias',
        'zwiftRacing': {'currentRating': 901, 'max30Rating': 901},
        'ligaCategory': {
            'locked': True,
            'category': 'Copper',
            'autoAssigned': {'category': 'Copper', 'assignedRating': 0, 'status': 'over'},
        },
    }
    locked = move_rider_up(_Db(), user_doc_id='u1', zwift_id='1', user_data=user)
    unlocked_user = {
        'zwiftRacing': user['zwiftRacing'],
        'ligaCategory': {'locked': False, 'autoAssigned': {'category': 'Copper', 'status': 'over'}},
    }
    unlocked = move_rider_up(_Db(), user_doc_id='u1', zwift_id='1', user_data=unlocked_user)
    assert [call['to_category'] for call in calls] == ['Silver', 'Silver']
    assert locked['transferId'] == unlocked['transferId'] == 't1'

    fields = _profile_fields(user, 'Silver', None, 35)
    assert fields['ligaCategory.category'] == 'Silver'
    assert fields['ligaCategory.locked'] is True
    assert fields['ligaCategory.manualAssigned']['category'] == 'Silver'
    assert fields['ligaCategory.autoAssigned']['category'] == 'Silver'
    assert fields['ligaCategory.autoAssigned']['status'] == 'ok'
