"""Public endpoints for the /live-race page."""

from __future__ import annotations

import logging
import threading
import time
from datetime import datetime, timezone, timedelta
from typing import Any

import pytz
from flask import Blueprint, jsonify, request

from extensions import db, get_zwift_service, get_zwift_game_service
from routes.races import resolve_signup_subgroup_id
from services.results.constants import (
    CATEGORY_FILTER_ALL,
    DEFAULT_PROVISIONAL_REFRESH_SECONDS,
    FETCH_MODE_FINISHERS,
    MAX_LIVE_RACE_WINDOW_MINUTES,
    MIN_PROVISIONAL_REFRESH_SECONDS,
    RESULTS_PHASE_FINALIZED,
    RESULTS_PHASE_PROVISIONAL,
)
from services.results_processor import ResultsProcessor

logger = logging.getLogger(__name__)

_COPENHAGEN_TZ = pytz.timezone('Europe/Copenhagen')

live_race_bp = Blueprint('live_race', __name__)

_LIVE_RIDERS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 2.0
_CACHE_EVICT_AFTER_SEC = 300.0  # evict live-riders entries idle for 5 minutes

_REGISTERED_RIDERS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_REGISTERED_RIDERS_TTL_SEC = 7200.0  # 2 hours — map is stable for the full race

_REFRESH_LOCKS: dict[str, threading.Lock] = {}
_REFRESH_LOCKS_GUARD = threading.Lock()


def _evict_stale_cache_entries() -> None:
    now = time.time()
    for key in [k for k, (ts, _) in _LIVE_RIDERS_CACHE.items() if now - ts > _CACHE_EVICT_AFTER_SEC]:
        _LIVE_RIDERS_CACHE.pop(key, None)


def _get_registered_riders(race_id: str) -> dict[str, Any]:
    """Return the registered-riders map for a race, building it at most once per race."""
    now = time.time()
    cached = _REGISTERED_RIDERS_CACHE.get(race_id)
    if cached and (now - cached[0]) < _REGISTERED_RIDERS_TTL_SEC:
        return cached[1]
    result = _build_registered_riders_map()
    _REGISTERED_RIDERS_CACHE[race_id] = (now, result)
    return result


def _build_registered_riders_map() -> dict[str, dict[str, Any]]:
    """Index registered users by zwiftId, zwiftUserId, and connections.zwift.userId."""
    registered: dict[str, dict[str, Any]] = {}
    if not db:
        return registered
    for doc in db.collection('users').stream():
        data = doc.to_dict() or {}
        reg = data.get('registration') or {}
        if reg.get('status') != 'complete':
            continue
        zid = data.get('zwiftId')
        zuid = data.get('zwiftUserId')
        conn = data.get('connections') if isinstance(data.get('connections'), dict) else {}
        zwift_conn = conn.get('zwift') if isinstance(conn.get('zwift'), dict) else {}
        conn_user_id = zwift_conn.get('userId')
        payload = {**data, '_docId': doc.id}
        if zid:
            registered[str(zid)] = payload
        if zuid:
            registered[str(zuid)] = payload
        if conn_user_id:
            registered[str(conn_user_id)] = payload
    return registered


def _public_name(profile: dict[str, Any] | None) -> str | None:
    if not profile:
        return None
    first = str(profile.get('firstName') or profile.get('name') or '').strip()
    last = str(profile.get('lastName') or '').strip()
    full = f'{first} {last}'.strip()
    return full or None


def _public_club(profile: dict[str, Any] | None) -> str | None:
    if not profile:
        return None
    club = profile.get('club') or profile.get('team')
    if isinstance(club, str) and club.strip():
        return club.strip()
    return None


def _parse_race_date(date_val: Any) -> datetime | None:
    if date_val is None:
        return None
    if isinstance(date_val, datetime):
        return date_val if date_val.tzinfo else date_val.replace(tzinfo=timezone.utc)
    # Firestore Timestamp proto or similar object with .seconds
    if hasattr(date_val, 'seconds') and not isinstance(date_val, str):
        return datetime.fromtimestamp(date_val.seconds, tz=timezone.utc)
    # Date stored as a plain map {"seconds": ..., "nanoseconds": ...}
    if isinstance(date_val, dict) and 'seconds' in date_val:
        try:
            return datetime.fromtimestamp(float(date_val['seconds']), tz=timezone.utc)
        except (TypeError, ValueError):
            return None
    if isinstance(date_val, str):
        try:
            dt = datetime.fromisoformat(date_val.replace('Z', '+00:00'))
            if dt.tzinfo is None:
                # Stored as Copenhagen local time with no timezone suffix — localize properly (handles CEST/CET DST)
                dt = _COPENHAGEN_TZ.localize(dt)
            return dt.astimezone(timezone.utc)
        except (ValueError, AttributeError):
            return None
    return None


def _get_refresh_lock(race_id: str) -> threading.Lock:
    with _REFRESH_LOCKS_GUARD:
        lock = _REFRESH_LOCKS.get(race_id)
        if lock is None:
            lock = threading.Lock()
            _REFRESH_LOCKS[race_id] = lock
        return lock


def _get_active_race_id() -> str | None:
    if not db:
        return None
    state_doc = db.collection('liveRaceState').document('active').get()
    if not state_doc.exists:
        return None
    race_id = str((state_doc.to_dict() or {}).get('raceId') or '').strip()
    return race_id or None


def _live_window_minutes(race_data: dict[str, Any]) -> int:
    """Effective live-refresh window. Hard-capped at MAX_LIVE_RACE_WINDOW_MINUTES.

    Honors a shorter configured windowDurationMinutes (so a 60-minute crit stops
    refreshing at 1h), and falls back to the cap when nothing is configured.
    """
    automation = race_data.get('resultsAutomation')
    if not isinstance(automation, dict):
        automation = {}
    try:
        configured = int(automation.get('windowDurationMinutes') or 0)
    except (TypeError, ValueError):
        configured = 0
    if configured <= 0:
        return MAX_LIVE_RACE_WINDOW_MINUTES
    return min(configured, MAX_LIVE_RACE_WINDOW_MINUTES)


def _polling_interval_seconds(race_data: dict[str, Any]) -> int:
    """Resolve the provisional refresh interval, clamped to a safe server-side floor."""
    automation = race_data.get('resultsAutomation')
    if not isinstance(automation, dict):
        automation = {}
    raw = automation.get('pollingIntervalSeconds')
    value: int = DEFAULT_PROVISIONAL_REFRESH_SECONDS
    if raw is not None:
        try:
            parsed = int(raw)
            if parsed > 0:
                value = parsed
        except (TypeError, ValueError):
            pass
    return max(value, MIN_PROVISIONAL_REFRESH_SECONDS)


def _is_past_live_window(race_data: dict[str, Any], now: datetime) -> bool:
    race_date = _parse_race_date(race_data.get('date'))
    if race_date is None:
        return False
    window_end = race_date + timedelta(minutes=_live_window_minutes(race_data))
    return now > window_end


def _cooldown_remaining_seconds(
    race_data: dict[str, Any],
    now: datetime,
) -> tuple[int, datetime | None]:
    """Return (seconds until eligible, last provisional update)."""
    interval = _polling_interval_seconds(race_data)
    last_update = _parse_race_date(race_data.get('provisionalUpdatedAt'))
    if last_update is None:
        return 0, None
    elapsed = (now - last_update).total_seconds()
    remaining = max(0, int(interval - elapsed))
    return remaining, last_update


def _auto_activate_if_due() -> tuple[str, dict[str, Any], str] | None:
    """If a scheduled race start time has arrived, write it to liveRaceState/active and return its data."""
    if not db:
        return None
    now = datetime.now(timezone.utc)
    # Avoid order_by: it silently drops documents with incompatible/missing date types.
    best: tuple[datetime, str, dict[str, Any]] | None = None
    for doc in db.collection('races').stream():
        race_data = doc.to_dict() or {}
        race_date = _parse_race_date(race_data.get('date'))
        if race_date is None:
            continue
        if race_date <= now <= race_date + timedelta(hours=4):
            # Prefer the most recently started race (highest race_date ≤ now)
            if best is None or race_date > best[0]:
                best = (race_date, doc.id, race_data)
    if best:
        _, race_id, race_data = best
        activated_at = now.isoformat()
        db.collection('liveRaceState').document('active').set(
            {'raceId': race_id, 'activatedAt': activated_at, 'activatedBy': 'auto'}
        )
        return race_id, race_data, activated_at
    return None


def _serialize_race_summary(race_id: str, race_data: dict[str, Any], activated_at: Any = None) -> dict[str, Any]:
    event_config = race_data.get('eventConfiguration')
    configs_out: list[dict[str, Any]] = []
    if isinstance(event_config, list):
        for cfg in event_config:
            if not isinstance(cfg, dict):
                continue
            configs_out.append(
                {
                    'customCategory': cfg.get('customCategory'),
                    'subgroupId': cfg.get('subgroupId'),
                    'eventId': cfg.get('eventId'),
                    'laps': cfg.get('laps'),
                    'sprints': cfg.get('sprints'),
                }
            )
    race_groups_out: list[dict[str, Any]] = []
    race_groups = race_data.get('raceGroups')
    if isinstance(race_groups, list):
        for group in race_groups:
            if not isinstance(group, dict):
                continue
            cats_out: list[dict[str, Any]] = []
            for cat in group.get('categories') or []:
                if not isinstance(cat, dict):
                    continue
                cats_out.append(
                    {
                        'category': cat.get('category'),
                        'laps': cat.get('laps'),
                        'sprints': cat.get('sprints'),
                        'segmentType': cat.get('segmentType'),
                    }
                )
            race_groups_out.append(
                {
                    'id': group.get('id'),
                    'name': group.get('name'),
                    'eventId': group.get('eventId'),
                    'laps': group.get('laps'),
                    'sprints': group.get('sprints'),
                    'segmentType': group.get('segmentType'),
                    'categories': cats_out,
                }
            )

    return {
        'id': race_id,
        'name': race_data.get('name'),
        'routeId': race_data.get('routeId'),
        'routeName': race_data.get('routeName'),
        'map': race_data.get('map'),
        'laps': race_data.get('laps'),
        'totalDistance': race_data.get('totalDistance'),
        'totalElevation': race_data.get('totalElevation'),
        'date': race_data.get('date'),
        'eventMode': race_data.get('eventMode'),
        'eventConfiguration': configs_out,
        'singleModeCategories': race_data.get('singleModeCategories'),
        'raceGroups': race_groups_out,
        'sprints': race_data.get('sprints'),
        'selectedSegments': race_data.get('selectedSegments'),
        'subgroupId': race_data.get('subgroupId'),
        'activatedAt': activated_at,
        'resultsPhase': race_data.get('resultsPhase'),
        'resultsAutomation': race_data.get('resultsAutomation')
        if isinstance(race_data.get('resultsAutomation'), dict)
        else None,
    }


@live_race_bp.route('/live-race/current', methods=['GET'])
def get_live_race_current():
    if not db:
        return jsonify({'error': 'DB not available'}), 500

    state_ref = db.collection('liveRaceState').document('active')
    state_doc = state_ref.get()
    if not state_doc.exists:
        result = _auto_activate_if_due()
        if result:
            race_id, race_data, activated_at = result
            return jsonify(_serialize_race_summary(race_id, race_data, activated_at)), 200
        return '', 204

    state = state_doc.to_dict() or {}
    race_id = str(state.get('raceId') or '').strip()
    if not race_id:
        result = _auto_activate_if_due()
        if result:
            race_id, race_data, activated_at = result
            return jsonify(_serialize_race_summary(race_id, race_data, activated_at)), 200
        return '', 204

    race_doc = db.collection('races').document(race_id).get()
    if not race_doc.exists:
        return '', 204

    race_data = race_doc.to_dict() or {}
    activated_at = state.get('activatedAt')
    return jsonify(_serialize_race_summary(race_id, race_data, activated_at)), 200


@live_race_bp.route('/live-race/upcoming', methods=['GET'])
def get_upcoming_race():
    if not db:
        return jsonify({'error': 'DB not available'}), 500

    now = datetime.now(timezone.utc)
    # Avoid order_by: it silently drops documents with incompatible/missing date types.
    best: tuple[datetime, str, dict[str, Any]] | None = None
    for doc in db.collection('races').stream():
        race_data = doc.to_dict() or {}
        race_date = _parse_race_date(race_data.get('date'))
        if race_date and race_date > now:
            if best is None or race_date < best[0]:
                best = (race_date, doc.id, race_data)

    if best:
        _, race_id, race_data = best
        return jsonify(_serialize_race_summary(race_id, race_data)), 200
    return '', 204


@live_race_bp.route('/live-race/active/results/refresh', methods=['POST'])
def refresh_active_race_results():
    if not db:
        return jsonify({'error': 'DB not available'}), 500

    race_id = _get_active_race_id()
    if not race_id:
        return jsonify({'status': 'noop'}), 200

    race_ref = db.collection('races').document(race_id)
    race_doc = race_ref.get()
    if not race_doc.exists:
        return jsonify({'status': 'noop'}), 200

    race_data = race_doc.to_dict() or {}
    if str(race_data.get('resultsPhase') or '').strip().lower() == RESULTS_PHASE_FINALIZED:
        return jsonify({'status': 'noop'}), 200

    now = datetime.now(timezone.utc)
    if _is_past_live_window(race_data, now):
        return jsonify({'status': 'noop'}), 200

    interval_seconds = _polling_interval_seconds(race_data)
    remaining, last_update = _cooldown_remaining_seconds(race_data, now)
    if remaining > 0 and last_update is not None:
        next_eligible = last_update + timedelta(seconds=interval_seconds)
        return jsonify({
            'status': 'skipped',
            'nextEligibleAt': next_eligible.isoformat(),
        }), 200

    lock = _get_refresh_lock(race_id)
    if not lock.acquire(blocking=False):
        next_eligible = (last_update or now) + timedelta(seconds=interval_seconds)
        return jsonify({
            'status': 'skipped',
            'nextEligibleAt': next_eligible.isoformat(),
        }), 200

    try:
        remaining, last_update = _cooldown_remaining_seconds(race_data, now)
        if remaining > 0 and last_update is not None:
            next_eligible = last_update + timedelta(seconds=interval_seconds)
            return jsonify({
                'status': 'skipped',
                'nextEligibleAt': next_eligible.isoformat(),
            }), 200

        processor = ResultsProcessor(db, get_zwift_service(), get_zwift_game_service())
        processor.process_race_results(
            race_id,
            fetch_mode=FETCH_MODE_FINISHERS,
            category_filter=CATEGORY_FILTER_ALL,
            results_phase=RESULTS_PHASE_PROVISIONAL,
        )

        updated_doc = race_ref.get()
        updated_data = updated_doc.to_dict() if updated_doc.exists else {}
        provisional_updated_at = updated_data.get('provisionalUpdatedAt')
        parsed_update = _parse_race_date(provisional_updated_at) or now
        next_eligible = parsed_update + timedelta(seconds=interval_seconds)
        return jsonify({
            'status': 'updated',
            'provisionalUpdatedAt': parsed_update.isoformat(),
            'nextEligibleAt': next_eligible.isoformat(),
        }), 200
    except Exception as exc:
        logger.exception('active live-race results refresh failed for race %s', race_id)
        return jsonify({'status': 'error', 'message': str(exc)}), 500
    finally:
        lock.release()


@live_race_bp.route('/races/<race_id>/live-riders', methods=['GET'])
def get_live_riders_for_race(race_id: str):
    if not db:
        return jsonify({'error': 'DB not available'}), 500

    category = str(request.args.get('cat') or 'A').strip()
    race_doc = db.collection('races').document(race_id).get()
    if not race_doc.exists:
        return jsonify({'message': 'Race not found'}), 404

    race_data = race_doc.to_dict() or {}

    try:
        subgroup_id, err = resolve_signup_subgroup_id(
            race_data, category, get_zwift_service()
        )
    except Exception as exc:
        logger.exception('subgroup resolution failed for race %s cat=%s', race_id, category)
        return jsonify({'message': str(exc)}), 502
    if not subgroup_id:
        msg = err or f'No subgroupId for category {category!r}'
        return jsonify({'message': msg}), 404

    cache_key = f'{race_id}:{subgroup_id}:{category}'
    now = time.time()
    cached = _LIVE_RIDERS_CACHE.get(cache_key)
    if cached and (now - cached[0]) < _CACHE_TTL_SEC:
        return jsonify(cached[1]), 200

    _evict_stale_cache_entries()

    try:
        zwift = get_zwift_service()
        raw_rows = zwift.get_live_riders(subgroup_id)
    except Exception as exc:
        logger.exception('live-riders fetch failed for subgroup %s', subgroup_id)
        return jsonify({'message': str(exc)}), 502

    registered = _get_registered_riders(race_id)
    riders_out: list[dict[str, Any]] = []
    max_as_of = 0

    for row in raw_rows:
        user_id = str(row.get('userId') or '').strip()
        profile = registered.get(user_id)
        zwift_id = str(profile.get('zwiftId')) if profile and profile.get('zwiftId') else None
        riders_out.append(
            {
                'userId': user_id,
                'zwiftId': zwift_id,
                'name': _public_name(profile),
                'club': _public_club(profile),
                'lap': row.get('lap') or 0,
                'distanceCovered': row.get('distanceCovered') or 0,
                'totalDistanceInMeters': row.get('totalDistanceInMeters'),
                'routeDistanceInCentimeters': row.get('routeDistanceInCentimeters'),
                'powerOutputInWatts': row.get('powerOutputInWatts'),
                'heartRateInBpm': row.get('heartRateInBpm'),
                'speedInMillimetersPerHour': row.get('speedInMillimetersPerHour'),
                'draftSavings': row.get('draftSavings'),
                'registered': profile is not None,
            }
        )
        as_of = row.get('asOf')
        if isinstance(as_of, (int, float)):
            max_as_of = max(max_as_of, int(as_of))

    payload = {'asOf': max_as_of, 'riders': riders_out}
    _LIVE_RIDERS_CACHE[cache_key] = (now, payload)
    return jsonify(payload), 200
