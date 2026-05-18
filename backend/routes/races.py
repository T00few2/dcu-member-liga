from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, get_zwift_game_service, strava_service
from services.results_processor import ResultsProcessor
from services.results.constants import (
    CATEGORY_FILTER_ALL,
    FETCH_MODE_FINISHERS,
    RESULTS_PHASE_FINALIZED,
    RESULTS_PHASE_PROVISIONAL,
)
from services.results.errors import FatalResultsError, ResultsProcessingError
from services.category_engine import _effective_cat_name, build_liga_category, effective_rating
from services.schema_validation import log_schema_issues, validate_race_doc, with_schema_version
from datetime import datetime, timedelta, timezone
from authz import require_admin, require_scheduler, verify_user_token, AuthzError
from services.dual_recording_admin_core import get_dual_recording_result, DualRecordingError
from services.zwift_tokens import resolve_user_doc_id_from_auth_uid
import re
from typing import Any
import uuid

import logging

logger = logging.getLogger(__name__)

_DATE_ONLY_RE = re.compile(r'^\d{4}-\d{2}-\d{2}$')
_DATETIME_LOCAL_RE = re.compile(r'^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$')

races_bp = Blueprint('races', __name__)


def _lock_categories_for_race(race_id):
    """
    After race results are published, lock ligaCategory for every registered rider
    who appears in the results. Locked riders cannot self-select a lower category.
    """
    if not db:
        return

    try:
        race_doc = db.collection('races').document(race_id).get()
        if not race_doc.exists:
            return
        results = (race_doc.to_dict() or {}).get('results', {})

        # Collect all zwiftIds that have a result and remember which category they
        # raced in for this event. A rider's first lock should reflect the category
        # they actually raced, not a freshly recomputed auto-assignment.
        zwift_ids = set()
        raced_category_by_zwift_id: dict[str, str] = {}
        for category_name, riders in results.items():
            for r in (riders or []):
                zid = str(r.get('zwiftId', '')).strip()
                if zid:
                    zwift_ids.add(zid)
                    if zid not in raced_category_by_zwift_id and category_name:
                        raced_category_by_zwift_id[zid] = str(category_name)

        if not zwift_ids:
            return

        # Build zwiftId → doc_id map from user collection (only registered riders)
        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        batch = db.batch()
        count = 0
        for doc in docs:
            data = doc.to_dict() or {}
            if str(data.get('zwiftId', '')).strip() in zwift_ids:
                lc = data.get('ligaCategory') or {}
                if not lc.get('locked'):
                    # Recompute the effective category from current stored ratings at
                    # lock time so a stale auto-assigned category (e.g. assigned when
                    # zwiftRacing data hadn't been refreshed yet) is corrected before
                    # the rider is permanently locked.
                    auto = lc.get('autoAssigned') or {}
                    sel = lc.get('selfSelected') or {}
                    zr = data.get('zwiftRacing', {})
                    eff = effective_rating(
                        zr.get('currentRating', 'N/A'),
                        zr.get('max30Rating', 'N/A'),
                        zr.get('max90Rating', 'N/A'),
                    )
                    if eff is not None:
                        recomputed = build_liga_category(eff)
                        auto_cat = recomputed['category']
                    else:
                        auto_cat = auto.get('category')
                    raced_category = raced_category_by_zwift_id.get(str(data.get('zwiftId', '')).strip())
                    effective = raced_category or _effective_cat_name(auto_cat, sel.get('category'))
                    batch.update(doc.reference, {
                        'ligaCategory.locked': True,
                        'ligaCategory.lockedAt': firestore.SERVER_TIMESTAMP,
                        'ligaCategory.category': effective,
                    })
                    count += 1

        if count:
            batch.commit()
            logger.info(f"Locked ligaCategory for {count} riders after race {race_id}")
    except Exception as exc:
        logger.error(f"_lock_categories_for_race({race_id}) failed: {exc}")

def _validate_race_fields(data):
    """Return an error string if required race fields are missing or invalid, else None."""
    name = data.get('name', '')
    date = data.get('date', '')
    if not name or not isinstance(name, str) or len(name.strip()) == 0:
        return 'Race name is required'
    if len(name) > 200:
        return 'Race name is too long (max 200 characters)'
    date_str = str(date)
    if _DATE_ONLY_RE.match(date_str):
        try:
            datetime.strptime(date_str, '%Y-%m-%d')
        except ValueError:
            return 'Race date is not a valid calendar date'
    elif _DATETIME_LOCAL_RE.match(date_str):
        dt_format = '%Y-%m-%dT%H:%M:%S' if len(date_str) == 19 else '%Y-%m-%dT%H:%M'
        try:
            datetime.strptime(date_str, dt_format)
        except ValueError:
            return 'Race date/time is not a valid calendar value'
    else:
        return 'Race date must be YYYY-MM-DD or YYYY-MM-DDTHH:mm'
    return None

def verify_admin_auth():
    # Backwards-compatible wrapper used throughout this file.
    return require_admin(request)


def _parse_race_datetime(value: Any) -> datetime | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if _DATE_ONLY_RE.match(raw):
            return datetime.strptime(raw, '%Y-%m-%d')
        if raw.endswith('Z'):
            return datetime.fromisoformat(raw.replace('Z', '+00:00'))
        if _DATETIME_LOCAL_RE.match(raw):
            fmt = '%Y-%m-%dT%H:%M:%S' if len(raw) == 19 else '%Y-%m-%dT%H:%M'
            return datetime.strptime(raw, fmt)
        return datetime.fromisoformat(raw)
    except Exception:
        return None


def _should_auto_finalize_race(race_data: dict[str, Any], now_utc: datetime) -> bool:
    automation = race_data.get('resultsAutomation', {}) if isinstance(race_data.get('resultsAutomation'), dict) else {}
    if not bool(automation.get('automationEnabled', False)):
        return False
    if str(race_data.get('resultsPhase') or '').strip().lower() == RESULTS_PHASE_FINALIZED:
        return False

    race_start = _parse_race_datetime(race_data.get('date'))
    if race_start is None:
        return False
    if race_start.tzinfo is None:
        race_start = race_start.replace(tzinfo=now_utc.tzinfo)
    else:
        race_start = race_start.astimezone(now_utc.tzinfo)

    try:
        finalize_delay_minutes = int(automation.get('finalizeDelayMinutes', 30))
    except (TypeError, ValueError):
        finalize_delay_minutes = 30
    if finalize_delay_minutes < 0:
        finalize_delay_minutes = 0

    return now_utc >= race_start + timedelta(minutes=finalize_delay_minutes)


def _normalize_category(value: Any) -> str:
    raw = str(value or "").strip().upper()
    if not raw:
        return ""
    # Accept values like "A", "Category A", "A (4.0+)", etc.
    for ch in raw:
        if ch in {"A", "B", "C", "D", "E"}:
            return ch
    return raw


def _select_subgroup_id(event_payload: dict[str, Any], custom_category: Any) -> str | None:
    subgroups = event_payload.get("eventSubgroups", []) if isinstance(event_payload, dict) else []
    if not isinstance(subgroups, list) or not subgroups:
        return None

    if custom_category:
        wanted = _normalize_category(custom_category)
        label_to_number = {"A": "1", "B": "2", "C": "3", "D": "4", "E": "5"}
        for subgroup in subgroups:
            sid = subgroup.get("id")
            if sid is None:
                continue
            subgroup_label = _normalize_category(subgroup.get("subgroupLabel"))
            subgroup_name = _normalize_category(subgroup.get("name"))
            subgroup_numeric = str(subgroup.get("label") or "").strip()
            if wanted and (
                subgroup_label == wanted
                or subgroup_name == wanted
                or (wanted in label_to_number and subgroup_numeric == label_to_number[wanted])
            ):
                return str(sid)

    if len(subgroups) == 1 and subgroups[0].get("id") is not None:
        return str(subgroups[0]["id"])
    return None


def _hydrate_event_config_subgroup_ids(data: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    event_config = data.get("eventConfiguration")
    if not isinstance(event_config, list) or not event_config:
        return data, []

    zwift_service = get_zwift_service()
    warnings: list[str] = []
    event_cache: dict[str, dict[str, Any] | None] = {}

    for idx, cfg in enumerate(event_config):
        if not isinstance(cfg, dict):
            continue
        if cfg.get("subgroupId"):
            continue

        event_id = str(cfg.get("eventId") or "").strip()
        if not event_id:
            continue

        if event_id not in event_cache:
            event_cache[event_id] = zwift_service.get_public_event_info(event_id)
        event_payload = event_cache[event_id]
        if not event_payload:
            warnings.append(
                f"eventConfiguration[{idx}] eventId={event_id}: public event lookup failed"
            )
            continue

        subgroup_id = _select_subgroup_id(event_payload, cfg.get("customCategory"))
        if subgroup_id:
            cfg["subgroupId"] = subgroup_id
            # Store event start time for webhook activity matching (if not already set)
            if not cfg.get("startTime"):
                for sg in (event_payload.get("eventSubgroups") or []):
                    if str(sg.get("id")) == subgroup_id:
                        start_iso = sg.get("eventSubgroupStart")
                        if start_iso:
                            cfg["startTime"] = start_iso
                        break
            continue

        warnings.append(
            f"eventConfiguration[{idx}] eventId={event_id}: subgroupId not resolved "
            f"(customCategory={cfg.get('customCategory')!r})"
        )

    data["eventConfiguration"] = event_config
    return data, warnings


def _pick_mode_config_for_user(race_data: dict[str, Any], user_category: str) -> tuple[str | None, str | None, str | None]:
    event_mode = str(race_data.get("eventMode") or "single").strip().lower()
    wanted = _normalize_category(user_category)

    if event_mode == "multi":
        cfgs = race_data.get("eventConfiguration") if isinstance(race_data.get("eventConfiguration"), list) else []
        if not cfgs:
            return None, None, None
        chosen = None
        for cfg in cfgs:
            if not isinstance(cfg, dict):
                continue
            if _normalize_category(cfg.get("customCategory")) == wanted:
                chosen = cfg
                break
        if chosen is None:
            chosen = cfgs[0] if isinstance(cfgs[0], dict) else None
        if not chosen:
            return None, None, None
        subgroup_id = str(chosen.get("subgroupId") or "").strip() or None
        event_id = str(chosen.get("eventId") or "").strip() or None
        event_secret = str(chosen.get("eventSecret") or "").strip() or None
        return subgroup_id, event_id, event_secret

    if event_mode == "grouped":
        groups = race_data.get("raceGroups") if isinstance(race_data.get("raceGroups"), list) else []
        if not groups:
            return None, None, None
        chosen = None
        for group in groups:
            if not isinstance(group, dict):
                continue
            categories = group.get("categories") if isinstance(group.get("categories"), list) else []
            if any(_normalize_category((c or {}).get("category")) == wanted for c in categories if isinstance(c, dict)):
                chosen = group
                break
        if chosen is None:
            chosen = groups[0] if isinstance(groups[0], dict) else None
        if not chosen:
            return None, None, None
        subgroup_id = str(chosen.get("subgroupId") or "").strip() or None
        event_id = str(chosen.get("eventId") or "").strip() or None
        event_secret = str(chosen.get("eventSecret") or "").strip() or None
        return subgroup_id, event_id, event_secret

    subgroup_id = str(race_data.get("subgroupId") or "").strip() or None
    event_id = str(race_data.get("eventId") or "").strip() or None
    event_secret = str(race_data.get("eventSecret") or "").strip() or None
    return subgroup_id, event_id, event_secret


def _resolve_signup_subgroup_id(
    race_data: dict[str, Any],
    user_category: str,
    zwift_service,
) -> tuple[str | None, str | None]:
    subgroup_id, event_id, event_secret = _pick_mode_config_for_user(race_data, user_category)
    if subgroup_id:
        return subgroup_id, None
    if not event_id:
        return None, "No event/subgroup configuration found for rider category"

    event_payload = zwift_service.get_public_event_info(event_id, event_secret=event_secret)
    if not event_payload:
        return None, f"Unable to resolve subgroup from eventId {event_id}"

    resolved = _select_subgroup_id(event_payload, user_category)
    if not resolved:
        resolved = _select_subgroup_id(event_payload, None)
    if not resolved:
        return None, f"Could not resolve subgroup for eventId {event_id}"
    return resolved, None

@races_bp.route('/races', methods=['GET'])
def get_races():
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        races_ref = db.collection('races').order_by('date')
        docs = races_ref.stream()
        races = []
        for doc in docs:
            r = doc.to_dict()
            r['id'] = doc.id
            races.append(r)
        return jsonify({'races': races}), 200
    except Exception as e:
        logger.error(f"Get races error: {e}")
        return jsonify({'message': str(e)}), 500


@races_bp.route('/races/<race_id>/signup', methods=['POST'])
def signup_race(race_id: str):
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    uid = str(decoded.get("uid") or "").strip()
    if not uid:
        return jsonify({'message': 'Invalid auth token (missing uid)'}), 401

    try:
        user_doc_id = resolve_user_doc_id_from_auth_uid(uid) or uid
        user_doc = db.collection('users').document(str(user_doc_id)).get()
        if not user_doc.exists:
            return jsonify({'message': 'User profile not found'}), 404
        user_data = user_doc.to_dict() or {}
        if str(((user_data.get('registration') or {}).get('status') or '')).strip().lower() != 'complete':
            return jsonify({'message': 'User is not fully registered'}), 403

        zwift_user_id = str(
            user_data.get('zwiftUserId')
            or ((user_data.get('connections') or {}).get('zwift') or {}).get('userId')
            or ''
        ).strip()
        if not zwift_user_id:
            return jsonify({'message': 'Missing zwiftUserId. Reconnect Zwift first.'}), 400

        race_doc = db.collection('races').document(str(race_id)).get()
        if not race_doc.exists:
            return jsonify({'message': 'Race not found'}), 404
        race_data = race_doc.to_dict() or {}

        user_category = str(((user_data.get('ligaCategory') or {}).get('category') or '')).strip()
        zwift_service = get_zwift_service()
        subgroup_id, subgroup_error = _resolve_signup_subgroup_id(race_data, user_category, zwift_service)
        if subgroup_error:
            return jsonify({'message': subgroup_error}), 400
        if not subgroup_id:
            return jsonify({'message': 'Could not determine event subgroup for signup'}), 400

        status_code, payload = zwift_service.batch_register_participants(
            event_subgroup_id=subgroup_id,
            public_ids=[zwift_user_id],
        )

        if status_code == 200:
            unknown_ids = payload.get("unknownPublicIds") if isinstance(payload, dict) else None
            unknown_ids = unknown_ids if isinstance(unknown_ids, list) else []
            if zwift_user_id in unknown_ids:
                return jsonify({
                    'message': 'Signup request accepted, but your Zwift public ID was not recognized by Zwift.',
                    'subgroupId': subgroup_id,
                    'unknownPublicIds': unknown_ids,
                }), 200
            return jsonify({
                'message': 'Signup completed in Zwift.',
                'subgroupId': subgroup_id,
                'unknownPublicIds': unknown_ids,
            }), 200

        zwift_message = None
        if isinstance(payload, dict):
            for key in ("message", "error", "detail", "description"):
                value = payload.get(key)
                if isinstance(value, str) and value.strip():
                    zwift_message = value.strip()
                    break

        logger.warning(
            "Zwift signup failed race=%s user=%s subgroup=%s status=%s payload=%s",
            race_id,
            user_doc_id,
            subgroup_id,
            status_code,
            payload,
        )
        return jsonify({
            'message': zwift_message or f'Zwift signup failed ({status_code})',
            'subgroupId': subgroup_id,
            'zwiftStatus': status_code,
            'zwiftError': payload,
        }), status_code if status_code in {400, 401, 403, 404, 409, 422, 500} else 502
    except Exception as e:
        logger.error(f"Race signup error race={race_id}: {e}")
        return jsonify({'message': str(e)}), 500


def _strip_hr_from_dr_result(payload: dict[str, Any]) -> dict[str, Any]:
    """Remove heart-rate arrays before returning DR payload on public results page."""
    result = dict(payload or {})
    zwift = result.get("zwift")
    if isinstance(zwift, dict):
        streams = zwift.get("streams")
        if isinstance(streams, dict) and isinstance(streams.get("heartrate"), list):
            streams = dict(streams)
            streams["heartrate"] = []
            zwift = dict(zwift)
            zwift["streams"] = streams
            result["zwift"] = zwift

    strava = result.get("strava")
    if isinstance(strava, dict):
        streams = strava.get("streams")
        if isinstance(streams, dict) and isinstance(streams.get("heartrate"), list):
            streams = dict(streams)
            streams["heartrate"] = []
            strava = dict(strava)
            strava["streams"] = streams
            result["strava"] = strava
    return result


@races_bp.route('/races/<race_id>/dr-verifications/<rider_id>', methods=['GET'])
def get_public_dr_verification_detail(race_id: str, rider_id: str):
    """
    Return DR detail payload for public race results.
    Requires any valid signed-in user; returns cache-backed DR payload.
    """
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_doc = db.collection('races').document(str(race_id)).get()
        if not race_doc.exists:
            return jsonify({'message': 'Race not found'}), 404

        result = get_dual_recording_result(
            db=db,
            rider_id=str(rider_id),
            zwift_activity_id=None,
            strava_activity_id=None,
            event_start_iso=None,
            race_id=str(race_id),
            logger=logger,
        )
        return jsonify(_strip_hr_from_dr_result(result)), 200
    except DualRecordingError as exc:
        return jsonify({'message': exc.message}), exc.status_code
    except ValueError as exc:
        return jsonify({'message': str(exc)}), 404
    except Exception as e:
        logger.error(f"Public DR detail error race={race_id} rider={rider_id}: {e}")
        return jsonify({'message': str(e)}), 500


@races_bp.route('/races/<race_id>/dr-verifications', methods=['GET'])
def get_public_race_dr_verifications(race_id: str):
    """
    Return DR verification summary docs for public race results.
    Requires any valid signed-in user.
    """
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_doc = db.collection('races').document(str(race_id)).get()
        if not race_doc.exists:
            return jsonify({'message': 'Race not found'}), 404

        out: list[dict[str, Any]] = []
        docs = db.collection('races').document(str(race_id)).collection('dr_verifications').stream()
        for d in docs:
            payload = d.to_dict() or {}
            payload['zwiftId'] = str(payload.get('zwiftId') or d.id)
            out.append(payload)
        return jsonify({'verifications': out}), 200
    except Exception as e:
        logger.error(f"Public DR list error race={race_id}: {e}")
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races', methods=['POST'])
def create_race():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
        
    try:
        data = request.get_json(silent=True) or {}
        data, hydrate_warnings = _hydrate_event_config_subgroup_ids(data)
        err = _validate_race_fields(data)
        if err:
            return jsonify({'message': err}), 400

        payload = with_schema_version(data)
        log_schema_issues(logger, "races/<new> (create)", validate_race_doc(payload))
        _, doc_ref = db.collection('races').add(payload)
        body: dict[str, Any] = {'message': 'Race created', 'id': doc_ref.id, 'race': {**payload, 'id': doc_ref.id}}
        if hydrate_warnings:
            body['warnings'] = hydrate_warnings
        return jsonify(body), 201
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races/<race_id>', methods=['DELETE'])
def delete_race(race_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        db.collection('races').document(race_id).delete()
        return jsonify({'message': 'Race deleted'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races/<race_id>', methods=['PUT'])
def update_race(race_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        data = request.get_json(silent=True) or {}
        data, hydrate_warnings = _hydrate_event_config_subgroup_ids(data)
        err = _validate_race_fields(data)
        if err:
            return jsonify({'message': err}), 400

        payload = with_schema_version(data)
        log_schema_issues(logger, f"races/{race_id} (update)", validate_race_doc(payload))
        db.collection('races').document(race_id).update(payload)
        body: dict[str, Any] = {'message': 'Race updated', 'race': {**payload, 'id': race_id}}
        if hydrate_warnings:
            body['warnings'] = hydrate_warnings
        return jsonify(body), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races/<race_id>/results/<category>/sprints', methods=['PUT'])
def update_sprint_data(race_id, category):
    """
    Update sprint data for riders in a specific category and recalculate all points.
    
    Request body:
    {
        "updates": [
            {
                "zwiftId": "12345",
                "sprintData": {
                    "sprint_key": { "worldTime": 1234567890, "time": 12345, "avgPower": 250 },
                    ...
                }
            },
            ...
        ]
    }
    """
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        req_data = request.get_json()
        updates = req_data.get('updates', [])
        
        if not updates:
            return jsonify({'message': 'No updates provided'}), 400
        
        # Fetch current race data
        race_doc = db.collection('races').document(race_id).get()
        if not race_doc.exists:
            return jsonify({'message': 'Race not found'}), 404
        
        race_data = race_doc.to_dict()
        results = race_data.get('results', {})
        
        if category not in results:
            return jsonify({'message': f'Category {category} not found in results'}), 404
        
        # Create lookup by zwiftId
        riders_by_id = {str(r['zwiftId']): r for r in results[category]}
        
        # Apply updates
        updated_count = 0
        for update in updates:
            zid = str(update.get('zwiftId'))
            new_sprint_data = update.get('sprintData', {})
            
            if zid in riders_by_id:
                rider = riders_by_id[zid]
                if 'sprintData' not in rider:
                    rider['sprintData'] = {}
                
                # Merge sprint data (update specific keys)
                for key, data in new_sprint_data.items():
                    if key not in rider['sprintData']:
                        rider['sprintData'][key] = {}
                    rider['sprintData'][key].update(data)
                
                updated_count += 1
        
        # Save updated results first
        payload = with_schema_version({
            'results': results
        })
        log_schema_issues(logger, f"races/{race_id} (sprint update)", validate_race_doc(payload, partial=True))
        db.collection('races').document(race_id).update(payload)
        
        # Now recalculate all points
        zwift_service = get_zwift_service()
        game_service = get_zwift_game_service()
        processor = ResultsProcessor(db, zwift_service, game_service)
        
        updated_results = processor.recalculate_race_points(race_id)
        
        return jsonify({
            'message': f'Updated {updated_count} riders, points recalculated',
            'results': updated_results
        }), 200
    except FatalResultsError as e:
        logger.error(f"Sprint data update fatal error: {e}")
        return jsonify({'message': str(e)}), 422
    except ResultsProcessingError as e:
        logger.error(f"Sprint data update domain error: {e}")
        return jsonify({'message': str(e)}), 500
    except Exception as e:
        logger.error(f"Sprint data update error: {e}")
        return jsonify({'message': str(e)}), 500


@races_bp.route('/races/<race_id>/results/refresh', methods=['POST'])
def refresh_results(race_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        zwift_service = get_zwift_service()
        game_service = get_zwift_game_service()
        processor = ResultsProcessor(db, zwift_service, game_service)
        
        req_data = request.get_json(silent=True) or {}
        fetch_mode = str(req_data.get('source', FETCH_MODE_FINISHERS) or FETCH_MODE_FINISHERS).strip().lower()
        category_filter = req_data.get('categoryFilter', CATEGORY_FILTER_ALL)
        results_phase = str(req_data.get('phase', RESULTS_PHASE_FINALIZED) or RESULTS_PHASE_FINALIZED).strip().lower()
        finalize_run_id = req_data.get('finalizeRunId')
        
        results = processor.process_race_results(
            race_id, 
            fetch_mode=fetch_mode, 
            category_filter=category_filter,
            results_phase=results_phase,
            finalize_run_id=str(finalize_run_id) if finalize_run_id else None,
        )
        
        _lock_categories_for_race(race_id)
        race_doc = db.collection('races').document(race_id).get()
        race_data = race_doc.to_dict() if race_doc.exists else {}
        return jsonify({
            'message': f'Results calculated (Mode: {fetch_mode}, Cat: {category_filter}, Phase: {results_phase})',
            'results': results,
            'resultsPhase': race_data.get('resultsPhase'),
            'provisionalUpdatedAt': race_data.get('provisionalUpdatedAt'),
            'finalizedAt': race_data.get('finalizedAt'),
            'finalizeRunId': race_data.get('finalizeRunId'),
        }), 200
    except FatalResultsError as e:
        logger.error(f"Results Processing fatal error: {e}")
        return jsonify({'message': str(e)}), 422
    except ResultsProcessingError as e:
        logger.error(f"Results Processing domain error: {e}")
        return jsonify({'message': str(e)}), 500
    except Exception as e:
        logger.error(f"Results Processing unexpected error: {e}")
        return jsonify({'message': str(e)}), 500


@races_bp.route('/races/<race_id>/results/finalize', methods=['POST'])
def finalize_results(race_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        zwift_service = get_zwift_service()
        game_service = get_zwift_game_service()
        processor = ResultsProcessor(db, zwift_service, game_service)

        req_data = request.get_json(silent=True) or {}
        category_filter = req_data.get('categoryFilter', CATEGORY_FILTER_ALL)
        finalize_run_id = str(req_data.get('finalizeRunId') or f"manual-{uuid.uuid4()}")

        results = processor.process_race_results(
            race_id,
            fetch_mode=FETCH_MODE_FINISHERS,
            category_filter=category_filter,
            results_phase=RESULTS_PHASE_FINALIZED,
            finalize_run_id=finalize_run_id,
        )
        _lock_categories_for_race(race_id)
        race_doc = db.collection('races').document(race_id).get()
        race_data = race_doc.to_dict() if race_doc.exists else {}
        return jsonify({
            'message': 'Race finalized',
            'results': results,
            'resultsPhase': race_data.get('resultsPhase'),
            'provisionalUpdatedAt': race_data.get('provisionalUpdatedAt'),
            'finalizedAt': race_data.get('finalizedAt'),
            'finalizeRunId': race_data.get('finalizeRunId'),
        }), 200
    except FatalResultsError as e:
        logger.error(f"Finalize results fatal error: {e}")
        return jsonify({'message': str(e)}), 422
    except ResultsProcessingError as e:
        logger.error(f"Finalize results domain error: {e}")
        return jsonify({'message': str(e)}), 500
    except Exception as e:
        logger.error(f"Finalize results unexpected error: {e}")
        return jsonify({'message': str(e)}), 500


@races_bp.route('/admin/races/results/finalize-pending', methods=['POST'])
def finalize_pending_races():
    scheduler_ok = False
    try:
        require_scheduler(request)
        scheduler_ok = True
    except AuthzError:
        pass
    if not scheduler_ok:
        try:
            verify_admin_auth()
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    now = datetime.utcnow().replace(tzinfo=timezone.utc)
    run_id = str(uuid.uuid4())
    candidates = 0
    finalized = 0
    skipped = 0
    errors = 0
    finalized_ids: list[str] = []
    skipped_ids: list[str] = []
    error_items: list[dict[str, str]] = []

    try:
        zwift_service = get_zwift_service()
        game_service = get_zwift_game_service()
        processor = ResultsProcessor(db, zwift_service, game_service)

        for race_doc in db.collection('races').stream():
            race_id = race_doc.id
            race_data = race_doc.to_dict() or {}
            if not _should_auto_finalize_race(race_data, now):
                skipped += 1
                skipped_ids.append(race_id)
                continue

            candidates += 1
            try:
                processor.process_race_results(
                    race_id,
                    fetch_mode=FETCH_MODE_FINISHERS,
                    category_filter=CATEGORY_FILTER_ALL,
                    results_phase=RESULTS_PHASE_FINALIZED,
                    finalize_run_id=run_id,
                )
                _lock_categories_for_race(race_id)
                finalized += 1
                finalized_ids.append(race_id)
            except Exception as exc:
                errors += 1
                error_items.append({'raceId': race_id, 'error': str(exc)})

        return jsonify({
            'message': 'Pending race finalization processed',
            'runId': run_id,
            'candidates': candidates,
            'finalized': finalized,
            'skipped': skipped,
            'errors': errors,
            'finalizedRaceIds': finalized_ids,
            'skippedRaceIds': skipped_ids,
            'errorItems': error_items,
        }), 200
    except Exception as exc:
        logger.error(f"Pending finalization error: {exc}")
        return jsonify({'message': str(exc)}), 500


@races_bp.route('/route-elevation/<int:segment_id>', methods=['GET'])
def get_route_elevation(segment_id):
    """Return distance + altitude streams for a Strava segment, cached in Firestore."""
    if not db:
        return jsonify({'error': 'Database unavailable'}), 503

    cache_ref = db.collection('elevation_cache').document(str(segment_id))
    cached = cache_ref.get()
    if cached.exists:
        return jsonify(cached.to_dict())

    streams = strava_service.get_segment_streams(segment_id)
    if not streams:
        return jsonify({'error': 'Could not fetch elevation data'}), 502

    cache_ref.set(streams)
    return jsonify(streams)


@races_bp.route('/route-elevation/<int:segment_id>/profile-segments', methods=['PUT'])
def update_route_profile_segments(segment_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'Database unavailable'}), 503

    try:
        req_data = request.get_json(silent=True) or {}
        raw_segments = req_data.get('profileSegments')
        if not isinstance(raw_segments, list):
            return jsonify({'message': 'profileSegments must be a list'}), 400

        raw_lead_in = req_data.get('leadInDistance')
        lead_in_distance = None
        if raw_lead_in is not None:
            try:
                lead_in_distance = float(raw_lead_in)
            except (TypeError, ValueError):
                return jsonify({'message': 'leadInDistance must be a number'}), 400

        cleaned_segments = []
        for i, seg in enumerate(raw_segments):
            if not isinstance(seg, dict):
                return jsonify({'message': f'profileSegments[{i}] must be an object'}), 400
            name = str(seg.get('name', '')).strip()
            seg_type = str(seg.get('type', '')).strip().lower()
            direction = str(seg.get('direction', 'forward')).strip().lower()
            try:
                from_km = float(seg.get('fromKm', 0))
                to_km = float(seg.get('toKm', 0))
            except (TypeError, ValueError):
                return jsonify({'message': f'profileSegments[{i}] fromKm/toKm must be numbers'}), 400

            if not name:
                return jsonify({'message': f'profileSegments[{i}] name is required'}), 400
            if seg_type not in {'sprint', 'climb', 'segment'}:
                return jsonify({'message': f'profileSegments[{i}] type must be sprint, climb, or segment'}), 400
            if direction not in {'forward', 'reverse'}:
                return jsonify({'message': f'profileSegments[{i}] direction must be forward or reverse'}), 400

            cleaned_segments.append({
                'name': name,
                'type': seg_type,
                'fromKm': from_km,
                'toKm': to_km,
                'direction': direction,
            })

        update_data = {'profileSegments': cleaned_segments}
        if lead_in_distance is not None:
            update_data['leadInDistance'] = lead_in_distance

        cache_ref = db.collection('elevation_cache').document(str(segment_id))
        cache_ref.set(update_data, merge=True)
        return jsonify({'message': 'Route profile segments updated', 'count': len(cleaned_segments)}), 200
    except Exception as e:
        logger.error(f"Route profile segment update error for {segment_id}: {e}")
        return jsonify({'message': str(e)}), 500
