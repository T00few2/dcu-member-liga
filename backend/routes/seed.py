"""
Admin test-data seeding.

Seed invents only Zwift-shaped inputs (users + finishers + segment efforts).
Scoring, resultsPhase, event GC, and season standings run through ResultsProcessor.
"""
from __future__ import annotations

import random
import uuid
from typing import Any

from flask import Blueprint, request, jsonify
from firebase_admin import firestore

from authz import require_admin, AuthzError
from extensions import db
from services.category_config import CategoryConfigResolver
from services.category_engine import (
    ZR_CATEGORIES,
    build_liga_category,
    cats_from_defs,
)
from services.results.constants import (
    RACE_STATUS_DNF,
    RACE_STATUS_FIN,
    RESULTS_PHASE_FINALIZED,
    RESULTS_PHASE_PROVISIONAL,
)
from services.results.critical_power import resolve_critical_power
from services.results.stage_race_ops import (
    finalize_event,
    load_races_by_id,
    load_stage_races,
    recompute_and_save_event_gc,
    stages_for_event,
)
from services.results_processor import ResultsProcessor

seed_bp = Blueprint('seed', __name__)

LEGACY_PEN_CATEGORIES = ['A', 'B', 'C', 'D', 'E']


def verify_admin_auth():
    return require_admin(request)


def _load_liga_category_list(db_client) -> list[tuple[str, int, int | None]]:
    try:
        settings_doc = db_client.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
    except Exception:
        settings = {}
    defs = settings.get('ligaCategories')
    if defs and isinstance(defs, list) and len(defs) >= 2:
        try:
            return cats_from_defs(defs)
        except Exception:
            pass
    return list(ZR_CATEGORIES)


def _rating_in_category(cat_name: str, categories: list[tuple[str, int, int | None]]) -> int:
    for name, lower, upper in categories:
        if name == cat_name:
            if upper is None:
                return int(lower) + 50
            mid = (int(lower) + int(upper)) // 2
            return max(int(lower), mid)
    return 500


def _race_category_labels(race_data: dict[str, Any]) -> list[str]:
    """Category keys used for results — mirrors race config modes."""
    cats: list[str] = []
    mode = str(race_data.get('eventMode') or 'single')

    if mode == 'grouped':
        for group in race_data.get('raceGroups') or []:
            for cfg in group.get('categories') or []:
                c = str(cfg.get('category') or '').strip()
                if c and c not in cats:
                    cats.append(c)
    elif mode == 'multi' or race_data.get('eventConfiguration'):
        for cfg in race_data.get('eventConfiguration') or []:
            c = str(cfg.get('customCategory') or '').strip()
            if c and c not in cats:
                cats.append(c)

    if not cats:
        for cfg in race_data.get('singleModeCategories') or []:
            c = str(cfg.get('category') or '').strip()
            if c and c not in cats:
                cats.append(c)

    if not cats:
        return list(LEGACY_PEN_CATEGORIES)
    return cats


def _build_zwift_finisher(
    rider: dict[str, Any],
    *,
    finish_time_ms: int,
    activity_id: str | None,
) -> dict[str, Any]:
    """ZwiftFetcher.fetch_finishers-shaped rider (pre-scorer).

    Always marks the *result row* as test data so seeded results are
    identifiable. Never writes isTestData onto the users/{zwiftId} document.
    """
    finished = finish_time_ms > 0
    finisher: dict[str, Any] = {
        'zwiftId': str(rider['zwiftId']),
        'name': rider.get('name') or f"Rider {rider['zwiftId']}",
        'finishTime': int(finish_time_ms),
        'raceStatus': RACE_STATUS_FIN if finished else RACE_STATUS_DNF,
        'flaggedCheating': False,
        'flaggedSandbagging': False,
        # Result-row tag only — does not modify the user profile.
        'isTestData': True,
        'criticalP': resolve_critical_power({
            'criticalP15Seconds': random.randint(350, 900),
            'criticalP1Minute': random.randint(280, 520),
            'criticalP5Minutes': random.randint(220, 400),
            'criticalP20Minutes': random.randint(180, 340),
        }),
    }
    if activity_id:
        finisher['activityId'] = activity_id
    return finisher


def _build_segment_efforts_for_riders(
    riders: list[dict[str, Any]],
    sprints: list[dict[str, Any]],
    *,
    progress: int,
    finished_ids: set[str],
) -> dict[str | int, list[dict[str, Any]]]:
    """
    Normalised segment efforts as produced by ZwiftFetcher.fetch_segment_efforts
    (athleteId, elapsed, worldTime, avgPower) — input to RaceScorer._map_segment_efforts.
    """
    if not sprints or progress <= 0:
        return {}

    sprints_complete = (
        len(sprints)
        if progress >= 100
        else max(1, int((progress / 100.0) * len(sprints)))
    )
    active_sprints = sprints[:sprints_complete]

    by_seg: dict[str | int, list[dict[str, Any]]] = {}
    race_start_ts = 1_700_000_000_000

    for s_idx, sprint in enumerate(active_sprints):
        seg_id = sprint.get('id')
        if seg_id is None:
            continue
        count = int(sprint.get('count') or 1)
        efforts = by_seg.setdefault(seg_id, [])

        for rank, rider in enumerate(riders):
            zid = str(rider['zwiftId'])
            # At 100%: only finishers get full segment set (DNFs may have none).
            if progress >= 100 and zid not in finished_ids:
                continue
            # Mid-race: DNFs often miss the latest sprint.
            if (
                progress < 100
                and zid not in finished_ids
                and s_idx >= sprints_complete - 1
                and random.random() < 0.4
            ):
                continue

            # RaceScorer maps the Nth worldTime-ordered crossing on a segment
            # to sprint count=N. Ensure this athlete has count crossings.
            existing_for_athlete = sum(
                1 for e in efforts if str(e.get('athleteId')) == zid
            )
            while existing_for_athlete < count:
                lap = existing_for_athlete + 1
                gap_ms = rank * random.randint(2_000, 8_000) + random.randint(0, 500)
                efforts.append({
                    'athleteId': zid,
                    'elapsed': random.randint(25_000, 120_000),
                    'worldTime': race_start_ts + lap * 600_000 + gap_ms,
                    'avgPower': random.randint(200, 420),
                })
                existing_for_athlete += 1

    return by_seg


def _maybe_finalize_complete_tours(db_client, processor: ResultsProcessor) -> list[str]:
    """If every stage of a tour is finalized, finalize the event via production helper."""
    finalized_events: list[str] = []
    try:
        settings_doc = db_client.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
    except Exception:
        settings = {}

    races_by_id = load_races_by_id(db_client)
    for event in load_stage_races(db_client):
        if str(event.get('seasonClass') or '') != 'tour':
            continue
        if str(event.get('resultsPhase') or '').lower() == RESULTS_PHASE_FINALIZED:
            continue
        stages = stages_for_event(races_by_id, str(event.get('id') or ''))
        if not stages:
            continue
        if not all(
            str(s.get('resultsPhase') or '').lower() == RESULTS_PHASE_FINALIZED
            for s in stages
        ):
            continue
        try:
            finalize_event(db_client, event, races_by_id, settings)
            finalized_events.append(str(event.get('id')))
            # Refresh season standings after event finalize
            processor.recalculate_season_standings()
        except Exception:
            continue
    return finalized_events


@seed_bp.route('/admin/seed/stats', methods=['GET'])
def get_seed_stats():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        registered_count = 0
        test_count = 0
        for doc in db.collection('users').stream():
            data = doc.to_dict() or {}
            if data.get('isTestData') is True:
                test_count += 1
            reg = data.get('registration') or {}
            if reg.get('status') == 'complete':
                registered_count += 1
        return jsonify({
            'registeredRiderCount': registered_count,
            'testParticipantCount': test_count,
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@seed_bp.route('/admin/seed/participants', methods=['POST'])
def seed_participants():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        req_data = request.get_json(silent=True) or {}
        count = int(req_data.get('count', 20))
        count = max(1, min(500, count))

        first_names = [
            'Magnus', 'Oliver', 'William', 'Noah', 'Lucas', 'Oscar', 'Carl', 'Victor',
            'Malthe', 'Alfred', 'Emil', 'Aksel', 'Valdemar', 'August', 'Frederik',
            'Emma', 'Ida', 'Clara', 'Freja', 'Alma', 'Ella', 'Sofia', 'Anna', 'Laura',
            'Karla', 'Mathilde', 'Agnes', 'Lily', 'Josefine', 'Alberte',
        ]
        last_names = [
            'Nielsen', 'Jensen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen',
            'Larsen', 'Sørensen', 'Rasmussen', 'Petersen', 'Madsen', 'Kristensen',
            'Olsen', 'Thomsen', 'Christiansen', 'Poulsen', 'Johansen', 'Knudsen',
            'Mortensen', 'Møller',
        ]
        clubs = [
            'Aarhus Cykle Ring', 'Team Biciklet', 'Odense Cykel Club',
            'Copenhagen Cycling', 'Roskilde CK', 'Aalborg CK', 'Test Club',
        ]

        categories = _load_liga_category_list(db)
        cat_names = [name for name, _lo, _up in categories]
        try:
            settings_doc = db.collection('league').document('settings').get()
            grace_period = int((settings_doc.to_dict() or {}).get('gracePeriod', 35))
        except Exception:
            grace_period = 35

        existing_test = list(db.collection('users').where('isTestData', '==', True).stream())
        max_id = len(existing_test)

        created = []
        for i in range(count):
            idx = max_id + i + 1
            zwift_id = f"999{idx:04d}"
            name = f"{random.choice(first_names)} {random.choice(last_names)}"
            cat_name = cat_names[i % len(cat_names)]
            rating = _rating_in_category(cat_name, categories)
            auto = build_liga_category(rating, grace_period, categories)
            # Ensure assigned category matches the round-robin target even if
            # rating sits on a boundary; rebuild bounds for that name.
            for n, _lo, upper in categories:
                if n == cat_name:
                    auto['category'] = cat_name
                    auto['upperBoundary'] = upper
                    auto['graceLimit'] = (upper + grace_period) if upper is not None else None
                    auto['status'] = 'ok'
                    break
            auto['assignedAt'] = firestore.SERVER_TIMESTAMP
            auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP

            user_data = {
                'zwiftId': zwift_id,
                'name': name,
                'club': random.choice(clubs),
                'equipment': {'trainer': 'Wahoo Kickr Core'},
                'isTestData': True,
                'registration': {'status': 'complete'},
                'ligaCategory': {
                    'autoAssigned': auto,
                    'locked': False,
                },
                'zwiftPower': {'category': cat_name},
                'zwiftRacing': {
                    'currentRating': rating,
                    'max30Rating': rating,
                },
                'createdAt': firestore.SERVER_TIMESTAMP,
            }
            db.collection('users').document(zwift_id).set(user_data)
            created.append({'name': name, 'zwiftId': zwift_id, 'category': cat_name})

        return jsonify({
            'message': f'Created {len(created)} test participants',
            'participants': created,
        }), 201
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@seed_bp.route('/admin/seed/participants', methods=['DELETE'])
def clear_seed_participants():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        users_ref = db.collection('users').where('isTestData', '==', True)
        docs = list(users_ref.stream())
        deleted_count = 0
        for doc in docs:
            doc.reference.delete()
            deleted_count += 1
        return jsonify({'message': f'Deleted {deleted_count} test participants'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@seed_bp.route('/admin/seed/results', methods=['POST'])
def seed_results():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        req_data = request.get_json(silent=True) or {}
        race_ids = req_data.get('raceIds') or []
        progress = int(req_data.get('progress', 100))
        progress = max(0, min(100, progress))
        category_riders = req_data.get('categoryRiders') or {}
        finalize_requested = bool(req_data.get('finalize', True))
        # Mid-race / empty must stay provisional so production DNF sprint rules apply.
        if progress < 100:
            results_phase = RESULTS_PHASE_PROVISIONAL
        elif finalize_requested:
            results_phase = RESULTS_PHASE_FINALIZED
        else:
            results_phase = RESULTS_PHASE_PROVISIONAL

        if not race_ids:
            return jsonify({'message': 'No race IDs provided'}), 400

        processor = ResultsProcessor(db, None, None)

        # Pool = registered liga riders (same gate as live results processing).
        registered_riders: list[dict[str, Any]] = []
        for doc in db.collection('users').stream():
            data = doc.to_dict() or {}
            reg = data.get('registration') or {}
            if reg.get('status') != 'complete':
                continue
            data['_docId'] = doc.id
            if not data.get('zwiftId'):
                data['zwiftId'] = doc.id
            effective = processor._effective_registered_category(data)
            data['_effectiveCategory'] = effective
            registered_riders.append(data)

        if not registered_riders:
            return jsonify({
                'message': 'No registered riders found (registration.status=complete).',
            }), 400

        results_generated: dict[str, Any] = {}
        finalize_run_id = f"seed-{uuid.uuid4().hex[:12]}" if results_phase == RESULTS_PHASE_FINALIZED else None

        for race_id in race_ids:
            race_doc = db.collection('races').document(race_id).get()
            if not race_doc.exists:
                results_generated[race_id] = {'error': 'Race not found'}
                continue

            race_data = race_doc.to_dict() or {}
            categories = _race_category_labels(race_data)
            finishers_by_category: dict[str, list[dict[str, Any]]] = {}
            segment_efforts_by_category: dict[str, dict[str | int, Any]] = {}
            used_zwift_ids: set[str] = set()

            for category in categories:
                rider_count = int(category_riders.get(category, 5) or 0)
                if rider_count <= 0:
                    continue

                pool = [
                    p for p in registered_riders
                    if p.get('_effectiveCategory') == category
                    and str(p.get('zwiftId')) not in used_zwift_ids
                ]
                # If no exact gem match (e.g. legacy A–E race), fall back to unused pool.
                if not pool:
                    pool = [
                        p for p in registered_riders
                        if str(p.get('zwiftId')) not in used_zwift_ids
                    ]

                pool.sort(key=lambda x: str(x.get('zwiftId') or ''))
                riders_list = pool[:rider_count]
                if not riders_list:
                    continue

                for r in riders_list:
                    used_zwift_ids.add(str(r.get('zwiftId')))

                # Progress: share of riders who finish
                if progress <= 0:
                    finish_count = 0
                elif progress >= 100:
                    # Keep a small DNF share for realism
                    finish_count = max(1, len(riders_list) - max(0, len(riders_list) // 10))
                else:
                    finish_count = max(0, int(round(len(riders_list) * (progress / 100.0))))

                shuffled = list(riders_list)
                random.shuffle(shuffled)
                finisher_set = {str(r['zwiftId']) for r in shuffled[:finish_count]}

                base_time_ms = random.randint(1_800_000, 3_600_000)
                cat_finishers: list[dict[str, Any]] = []
                for rank, rider in enumerate(shuffled):
                    zid = str(rider['zwiftId'])
                    if zid in finisher_set:
                        finish_time = base_time_ms + (random.randint(5_000, 30_000) * (rank + 1))
                        activity_id = f"test-act-{zid}-{race_id[:8]}"
                    else:
                        finish_time = 0
                        activity_id = None
                    cat_finishers.append(
                        _build_zwift_finisher(
                            rider,
                            finish_time_ms=finish_time,
                            activity_id=activity_id,
                        )
                    )

                sprints = CategoryConfigResolver.get_sprints(race_data, category) or []
                segment_efforts_by_category[category] = _build_segment_efforts_for_riders(
                    shuffled,
                    sprints,
                    progress=progress,
                    finished_ids=finisher_set,
                )
                finishers_by_category[category] = cat_finishers

            if not finishers_by_category:
                results_generated[race_id] = {'error': 'No riders generated for race categories'}
                continue

            try:
                # Clear manuals so seed is clean; production scorer still reads them.
                db.collection('races').document(race_id).update({
                    'manualDQs': [],
                    'manualDeclassifications': [],
                    'manualExclusions': [],
                })
                scored = processor.ingest_prefetched_results(
                    race_id,
                    finishers_by_category,
                    segment_efforts_by_category,
                    results_phase=results_phase,
                    finalize_run_id=finalize_run_id,
                )
                # Race-level marker so clear can target seeded results only.
                # Does not touch users/{zwiftId} documents.
                db.collection('races').document(race_id).update({
                    'resultsSource': 'seed',
                })
                results_generated[race_id] = {
                    'status': 'ok',
                    'resultsPhase': results_phase,
                    'resultsSource': 'seed',
                    'categories': {
                        cat: len(riders) for cat, riders in scored.items()
                    },
                }
            except Exception as e:
                results_generated[race_id] = {'error': str(e)}

        tour_finalized = []
        if results_phase == RESULTS_PHASE_FINALIZED:
            tour_finalized = _maybe_finalize_complete_tours(db, processor)

        ok_count = sum(1 for v in results_generated.values() if v.get('status') == 'ok')
        return jsonify({
            'message': (
                f'Generated results for {ok_count} races '
                f'({results_phase}'
                + (f', finalized {len(tour_finalized)} tour event(s)' if tour_finalized else '')
                + ')'
            ),
            'results': results_generated,
            'resultsPhase': results_phase,
            'tourEventsFinalized': tour_finalized,
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@seed_bp.route('/admin/seed/results', methods=['DELETE'])
def clear_seed_results():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        req_data = request.get_json(silent=True) or {}
        race_ids = req_data.get('raceIds') or []

        clear_fields = {
            'results': firestore.DELETE_FIELD,
            'resultsPhase': firestore.DELETE_FIELD,
            'finalizedAt': firestore.DELETE_FIELD,
            'finalizeRunId': firestore.DELETE_FIELD,
            'provisionalUpdatedAt': firestore.DELETE_FIELD,
            'resultsSource': firestore.DELETE_FIELD,
        }

        affected_event_ids: set[str] = set()
        if race_ids:
            targets = list(race_ids)
        else:
            targets = [doc.id for doc in db.collection('races').stream()]

        cleared: list[str] = []
        skipped: list[str] = []

        for race_id in targets:
            race_ref = db.collection('races').document(race_id)
            race_snap = race_ref.get()
            if not race_snap.exists:
                skipped.append(race_id)
                continue
            race_data = race_snap.to_dict() or {}
            # Only wipe races explicitly marked as seeded — never real Zwift results.
            if str(race_data.get('resultsSource') or '') != 'seed':
                skipped.append(race_id)
                continue
            linked = str(race_data.get('stageRaceId') or '').strip()
            if linked:
                affected_event_ids.add(linked)
            race_ref.update(clear_fields)
            cleared.append(race_id)

        processor = ResultsProcessor(db, None, None)
        try:
            settings_doc = db.collection('league').document('settings').get()
            settings = settings_doc.to_dict() if settings_doc.exists else {}
        except Exception:
            settings = {}

        races_by_id = load_races_by_id(db)
        stage_races = {str(e.get('id')): e for e in load_stage_races(db)}
        for event_id in affected_event_ids:
            event = stage_races.get(event_id)
            if not event:
                continue
            try:
                recompute_and_save_event_gc(db, event, races_by_id, settings)
            except Exception:
                pass

        try:
            processor.save_league_standings()
        except Exception:
            pass

        msg = f'Cleared seeded results from {len(cleared)} race(s)'
        if skipped:
            msg += f' (skipped {len(skipped)} non-seed or missing)'
        return jsonify({
            'message': msg,
            'cleared': cleared,
            'skipped': skipped,
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
