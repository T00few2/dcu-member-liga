from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, get_zwift_game_service, strava_service
from services.results_processor import ResultsProcessor
from services.category_engine import _effective_cat_name
from services.schema_validation import log_schema_issues, validate_race_doc, with_schema_version
from datetime import datetime
from authz import require_admin, AuthzError
import re

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

        # Collect all zwiftIds that have a result
        zwift_ids = set()
        for riders in results.values():
            for r in (riders or []):
                zid = str(r.get('zwiftId', '')).strip()
                if zid:
                    zwift_ids.add(zid)

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
                    # Compute effective category at lock time
                    auto = lc.get('autoAssigned') or {}
                    sel = lc.get('selfSelected') or {}
                    effective = _effective_cat_name(
                        auto.get('category'),
                        sel.get('category'),
                    )
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
        err = _validate_race_fields(data)
        if err:
            return jsonify({'message': err}), 400

        payload = with_schema_version(data)
        log_schema_issues(logger, "races/<new> (create)", validate_race_doc(payload))
        _, doc_ref = db.collection('races').add(payload)
        return jsonify({'message': 'Race created', 'id': doc_ref.id}), 201
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
        err = _validate_race_fields(data)
        if err:
            return jsonify({'message': err}), 400

        payload = with_schema_version(data)
        log_schema_issues(logger, f"races/{race_id} (update)", validate_race_doc(payload))
        db.collection('races').document(race_id).update(payload)
        return jsonify({'message': 'Race updated'}), 200
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
        fetch_mode = req_data.get('source', 'finishers')
        filter_registered = req_data.get('filterRegistered', False)
        category_filter = req_data.get('categoryFilter', 'All')
        
        results = processor.process_race_results(
            race_id, 
            fetch_mode=fetch_mode, 
            filter_registered=filter_registered,
            category_filter=category_filter
        )
        
        _lock_categories_for_race(race_id)
        return jsonify({'message': f'Results calculated (Mode: {fetch_mode}, Cat: {category_filter})', 'results': results}), 200
    except Exception as e:
        logger.error(f"Results Processing Error: {e}")
        return jsonify({'message': str(e)}), 500


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
