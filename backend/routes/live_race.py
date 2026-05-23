"""Public endpoints for the /live-race page."""

from __future__ import annotations

import logging
import time
from typing import Any

from flask import Blueprint, jsonify, request

from extensions import db, get_zwift_service
from routes.races import resolve_signup_subgroup_id

logger = logging.getLogger(__name__)

live_race_bp = Blueprint('live_race', __name__)

_LIVE_RIDERS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_CACHE_TTL_SEC = 2.0
_CACHE_EVICT_AFTER_SEC = 300.0  # evict live-riders entries idle for 5 minutes

_REGISTERED_RIDERS_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
_REGISTERED_RIDERS_TTL_SEC = 7200.0  # 2 hours — map is stable for the full race


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
        'subgroupId': race_data.get('subgroupId'),
        'activatedAt': activated_at,
    }


@live_race_bp.route('/live-race/current', methods=['GET'])
def get_live_race_current():
    if not db:
        return jsonify({'error': 'DB not available'}), 500

    state_ref = db.collection('liveRaceState').document('active')
    state_doc = state_ref.get()
    if not state_doc.exists:
        return '', 204

    state = state_doc.to_dict() or {}
    race_id = str(state.get('raceId') or '').strip()
    if not race_id:
        return '', 204

    race_doc = db.collection('races').document(race_id).get()
    if not race_doc.exists:
        return '', 204

    race_data = race_doc.to_dict() or {}
    activated_at = state.get('activatedAt')
    return jsonify(_serialize_race_summary(race_id, race_data, activated_at)), 200


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
                'registered': profile is not None,
            }
        )
        as_of = row.get('asOf')
        if isinstance(as_of, (int, float)):
            max_as_of = max(max_as_of, int(as_of))

    payload = {'asOf': max_as_of, 'riders': riders_out}
    _LIVE_RIDERS_CACHE[cache_key] = (now, payload)
    return jsonify(payload), 200
