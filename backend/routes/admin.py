from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, strava_service, get_zp_service, zr_service
from authz import require_admin, require_scheduler, verify_user_token, AuthzError
from services.user_service import UserService

import logging

logger = logging.getLogger(__name__)

admin_bp = Blueprint('admin', __name__)

def verify_admin_auth():
    return require_admin(request)

@admin_bp.route('/admin/verification/rider/<rider_id>', methods=['GET'])
def verify_rider(rider_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
            return jsonify({'error': 'DB not available'}), 500

    try:
        # Try fetching by ID (ZwiftID)
        user = UserService.get_user_by_id(rider_id)
        if not user:
             # Fallback: Try eLicense (backward compat or valid alt lookup)
             logger.info(f"User not found by ID {rider_id}, trying eLicense lookup")
             user = UserService.get_user_by_elicense(rider_id)
             
        if not user:
             return jsonify({'message': 'User not found'}), 404
        
        zwift_id = user.zwift_id
        e_license = user.e_license
        strava_auth = user.strava_auth

        response_data = {'profile': {}, 'stravaActivities': [], 'zwiftPowerHistory': []}

        def fetch_zwift_profile():
            if not zwift_id:
                return None
            zwift_service = get_zwift_service()
            return zwift_service.get_profile(int(zwift_id))

        def fetch_strava():
            if not strava_auth or not e_license:
                return None
            return strava_service.get_activities(e_license)

        def fetch_zp():
            if not zwift_id:
                return None
            zp = get_zp_service()
            return zp.get_rider_data_json(int(zwift_id))

        futures = {}
        with ThreadPoolExecutor(max_workers=3) as executor:
            futures['profile'] = executor.submit(fetch_zwift_profile)
            futures['strava'] = executor.submit(fetch_strava)
            futures['zp'] = executor.submit(fetch_zp)

        try:
            profile = futures['profile'].result(timeout=30)
            if profile:
                response_data['profile'] = {
                    'weight': round(profile.get('weight', 0) / 1000, 1) if profile.get('weight') else None,
                    'height': round(profile.get('height', 0) / 10, 0) if profile.get('height') else None,
                    'maxHr': profile.get('heartRateMax', 0),
                    'img': profile.get('imageSrc')
                }
        except Exception as e:
            logger.error(f"Zwift Profile Fetch Error: {e}")

        try:
            strava_raw = futures['strava'].result(timeout=30)
            if strava_raw and 'activities' in strava_raw:
                response_data['stravaActivities'] = strava_raw['activities']
        except Exception as e:
            logger.error(f"Strava Verification Fetch Error: {e}")

        try:
            zp_json = futures['zp'].result(timeout=30)
            if zp_json and 'data' in zp_json:
                history = []
                for entry in zp_json['data']:
                    weight_val = entry.get('weight')
                    if isinstance(weight_val, list) and len(weight_val) > 0: weight_val = float(weight_val[0])
                    else: weight_val = float(weight_val) if weight_val else 0

                    height_val = entry.get('height')
                    if isinstance(height_val, list) and len(height_val) > 0: height_val = float(height_val[0])
                    else: height_val = float(height_val) if height_val else 0

                    avg_pwr = entry.get('avg_power')
                    if isinstance(avg_pwr, list) and len(avg_pwr) > 0: avg_pwr = float(avg_pwr[0])
                    else: avg_pwr = float(avg_pwr) if avg_pwr else 0

                    avg_hr = entry.get('avg_hr')
                    if isinstance(avg_hr, list) and len(avg_hr) > 0: avg_hr = float(avg_hr[0])
                    else: avg_hr = float(avg_hr) if avg_hr else 0

                    wkg = entry.get('avg_wkg')
                    if isinstance(wkg, list) and len(wkg) > 0: wkg_val = float(wkg[0]) if wkg[0] else 0
                    else: wkg_val = float(wkg) if wkg else 0

                    cp_curve = {}
                    for duration in ['w5', 'w15', 'w30', 'w60', 'w120', 'w300', 'w1200']:
                        val = entry.get(duration)
                        try:
                            if isinstance(val, list) and len(val) > 0:
                                cp_curve[duration] = int(float(val[0])) if val[0] else 0
                            else:
                                cp_curve[duration] = int(float(val)) if val else 0
                        except (ValueError, TypeError):
                            cp_curve[duration] = 0

                    history.append({
                        'date': entry.get('event_date', 0),
                        'event_title': entry.get('event_title', 'Unknown Event'),
                        'avg_watts': avg_pwr,
                        'avg_hr': avg_hr,
                        'wkg': wkg_val,
                        'category': entry.get('category', ''),
                        'weight': weight_val,
                        'height': height_val,
                        'cp_curve': cp_curve
                    })

                history.sort(key=lambda x: x['date'], reverse=True)
                response_data['zwiftPowerHistory'] = history
        except Exception as e:
            logger.error(f"ZP Verification Fetch Error: {e}")

        return jsonify(response_data), 200
    except Exception as e:
            return jsonify({'message': str(e)}), 500

@admin_bp.route('/admin/verification/strava/streams/<activity_id>', methods=['GET'])
def get_strava_streams(activity_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    e_license = request.args.get('eLicense')
    if not e_license:
            return jsonify({'message': 'Missing eLicense'}), 400

    try:
        streams = strava_service.get_activity_streams(e_license, activity_id)
        if streams:
            return jsonify({'streams': streams}), 200
        else:
            return jsonify({'message': 'Failed to fetch streams'}), 404
    except Exception as e:
        return jsonify({'message': str(e)}), 500

# --- Trainers Management ---

@admin_bp.route('/trainers', methods=['GET'])
def get_trainers():
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        trainers_ref = db.collection('trainers').order_by('name')
        docs = trainers_ref.stream()
        trainers = []
        for doc in docs:
            t = doc.to_dict()
            t['id'] = doc.id
            trainers.append(t)
        return jsonify({'trainers': trainers}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers', methods=['POST'])
def create_trainer():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    
    try:
        data = request.get_json()
        name = data.get('name')
        if not name: return jsonify({'message': 'Trainer name is required'}), 400
        
        trainer_data = {
            'name': name,
            'status': data.get('status', 'approved'),
            'dualRecordingRequired': data.get('dualRecordingRequired', False),
            'createdAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }
        _, doc_ref = db.collection('trainers').add(trainer_data)
        return jsonify({'message': 'Trainer created', 'id': doc_ref.id}), 201
    except Exception as e: return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers/<trainer_id>', methods=['PUT'])
def update_trainer(trainer_id):
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    
    try:
        data = request.get_json()
        update_data = {'updatedAt': firestore.SERVER_TIMESTAMP}
        if 'name' in data: update_data['name'] = data['name']
        if 'status' in data: update_data['status'] = data['status']
        if 'dualRecordingRequired' in data: update_data['dualRecordingRequired'] = data['dualRecordingRequired']
        
        db.collection('trainers').document(trainer_id).update(update_data)
        return jsonify({'message': 'Trainer updated'}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers/<trainer_id>', methods=['DELETE'])
def delete_trainer(trainer_id):
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        db.collection('trainers').document(trainer_id).delete()
        return jsonify({'message': 'Trainer deleted'}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers/request', methods=['POST'])
def request_trainer():
    # User-facing endpoint
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    uid = decoded['uid']
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    
    try:
        data = request.get_json()
        trainer_name = data.get('trainerName')
        if not trainer_name: return jsonify({'message': 'Trainer name is required'}), 400
        
        request_data = {
            'trainerName': trainer_name,
            'requesterName': data.get('requesterName', ''),
            'requesterUid': uid,
            'status': 'pending',
            'createdAt': firestore.SERVER_TIMESTAMP
        }
        _, doc_ref = db.collection('trainer_requests').add(request_data)
        return jsonify({'message': 'Trainer approval request submitted', 'id': doc_ref.id}), 201
    except Exception as e: return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers/requests', methods=['GET'])
def get_trainer_requests():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        requests_ref = db.collection('trainer_requests').order_by('createdAt', direction=firestore.Query.DESCENDING)
        docs = requests_ref.stream()
        requests = []
        for doc in docs:
            rd = doc.to_dict()
            rd['id'] = doc.id
            if 'createdAt' in rd and rd['createdAt']:
                rd['createdAt'] = int(rd['createdAt'].timestamp() * 1000)
            requests.append(rd)
        return jsonify({'requests': requests}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers/requests/<request_id>/approve', methods=['POST'])
def approve_trainer_request(request_id):
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        data = request.get_json()
        request_doc = db.collection('trainer_requests').document(request_id).get()
        if not request_doc.exists: return jsonify({'message': 'Request not found'}), 404
        
        request_data = request_doc.to_dict()
        trainer_name = request_data.get('trainerName')
        
        trainer_data = {
            'name': trainer_name,
            'status': 'approved',
            'dualRecordingRequired': data.get('dualRecordingRequired', False),
            'createdAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }
        db.collection('trainers').add(trainer_data)
        db.collection('trainer_requests').document(request_id).update({
            'status': 'approved',
            'approvedAt': firestore.SERVER_TIMESTAMP
        })
        return jsonify({'message': 'Trainer approved and added'}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@admin_bp.route('/trainers/requests/<request_id>/reject', methods=['POST'])
def reject_trainer_request(request_id):
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        db.collection('trainer_requests').document(request_id).update({
            'status': 'rejected',
            'rejectedAt': firestore.SERVER_TIMESTAMP
        })
        return jsonify({'message': 'Trainer request rejected'}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

# Seed endpoints (Simplified for brevity, but they follow same pattern)
# For the sake of refactoring, I'll include one, but omit the massive random generation logic
# unless specifically requested. The previous seed endpoints were HUGE.
# User asked for refactoring, so splitting them out is key. I'll create a separate file `seed.py` for them?
# Or just put them here. They are Admin functionality.
# I will put the seeding logic in a separate helper or just copy it if needed.
# Given the size, maybe `backend/routes/seed.py`?
# Yes, let's make `backend/routes/seed.py` for the seed data endpoints.


# ---------------------------------------------------------------------------
# Nightly ZwiftRacing stats refresh
# Triggered by Google Cloud Scheduler via a shared secret header.
# Uses the ZR batch endpoint to refresh all registered riders in one API call.
# ---------------------------------------------------------------------------

_FIRESTORE_BATCH_SIZE = 400  # Firestore max is 500; use 400 for safety


@admin_bp.route('/admin/refresh-zr-stats', methods=['POST'])
def refresh_zr_stats():
    """
    Refresh ZwiftRacing stats for every fully registered rider.

    Authentication: X-Scheduler-Token header must match SCHEDULER_SECRET.
    Can also be called by an admin (Firebase ID token with admin claim).

    The ZR batch endpoint accepts up to 1000 rider IDs in a single call,
    so a full refresh costs exactly one ZR API call regardless of rider count.
    """
    # Accept either scheduler secret or admin Firebase token.
    scheduler_ok = False
    try:
        require_scheduler(request)
        scheduler_ok = True
    except AuthzError:
        pass

    if not scheduler_ok:
        try:
            require_admin(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        # 1. Fetch all fully registered riders from Firestore (no limit).
        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        # Build a zwiftId → eLicense map so we can write results back.
        riders = {}  # { zwift_id_str: e_license_str }
        for doc in docs:
            data = doc.to_dict() or {}
            zwift_id = str(data.get('zwiftId', '')).strip()
            e_license = str(data.get('eLicense', doc.id)).strip()
            if zwift_id:
                riders[zwift_id] = e_license

        if not riders:
            return jsonify({'message': 'No registered riders found', 'updated': 0}), 200

        logger.info(f"ZR nightly refresh: fetching stats for {len(riders)} riders")

        # 2. Single batch call to ZR API.
        zwift_ids = [int(zid) for zid in riders.keys()]
        batch_response = zr_service.get_riders_batch(zwift_ids)

        if not batch_response:
            return jsonify({'message': 'ZR batch call returned no data', 'updated': 0}), 502

        # The ZR batch endpoint returns a list of rider objects.
        # Normalise to a dict keyed by string zwiftId for easy lookup.
        if isinstance(batch_response, list):
            zr_by_id = {str(r.get('riderId', r.get('zwiftId', ''))): r for r in batch_response}
        elif isinstance(batch_response, dict):
            # Some APIs wrap the list: { "data": [...] } or { "<id>": {...} }
            inner = batch_response.get('data', batch_response)
            if isinstance(inner, list):
                zr_by_id = {str(r.get('riderId', r.get('zwiftId', ''))): r for r in inner}
            else:
                zr_by_id = {str(k): v for k, v in inner.items()}
        else:
            logger.error(f"Unexpected ZR batch response type: {type(batch_response)}")
            return jsonify({'message': 'Unexpected ZR response format', 'updated': 0}), 502

        # 3. Write results back to Firestore in batches.
        updated = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0

        for zwift_id, e_license in riders.items():
            rider_data = zr_by_id.get(zwift_id)
            if not rider_data:
                skipped += 1
                continue

            data = rider_data if 'race' in rider_data else rider_data.get('data', {})
            race = data.get('race', {})

            doc_ref = db.collection('users').document(e_license)
            batch.set(doc_ref, {
                'zwiftRacing': {
                    'currentRating': race.get('current', {}).get('rating', 'N/A'),
                    'max30Rating':   race.get('max30', {}).get('rating', 'N/A'),
                    'max90Rating':   race.get('max90', {}).get('rating', 'N/A'),
                    'phenotype':     data.get('phenotype', {}).get('value', 'N/A'),
                    'updatedAt':     firestore.SERVER_TIMESTAMP,
                }
            }, merge=True)

            updated += 1
            batch_count += 1

            if batch_count >= _FIRESTORE_BATCH_SIZE:
                batch.commit()
                batch = db.batch()
                batch_count = 0

        if batch_count > 0:
            batch.commit()

        logger.info(f"ZR nightly refresh complete: {updated} updated, {skipped} skipped (no ZR data)")
        return jsonify({
            'message': 'ZR stats refresh complete',
            'total': len(riders),
            'updated': updated,
            'skipped': skipped,
        }), 200

    except Exception as e:
        logger.error(f"ZR nightly refresh error: {e}")
        return jsonify({'message': str(e)}), 500

