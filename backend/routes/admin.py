from concurrent.futures import ThreadPoolExecutor
from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, strava_service, get_zp_service, zr_service
from authz import require_admin, require_scheduler, verify_user_token, AuthzError
from services.user_service import UserService
from services.category_engine import (
    build_liga_category, compute_category_status, reassign_to_next_category,
    serialize_liga_category, cats_from_defs, ZR_CATEGORY_DEFS,
)

import logging

logger = logging.getLogger(__name__)

admin_bp = Blueprint('admin', __name__)

def verify_admin_auth():
    return require_admin(request)


def _load_liga_settings(db) -> dict:
    """Load league settings and return a dict with gracePeriod and categories."""
    try:
        doc = db.collection('league').document('settings').get()
        s = doc.to_dict() if doc.exists else {}
    except Exception:
        s = {}
    return {
        'gracePeriod': int(s.get('gracePeriod', 35)),
        'categories': s.get('ligaCategories'),  # None → use ZR_CATEGORIES default
    }


def _resolve_categories(settings: dict):
    """Return a CategoryList from settings, defaulting to ZR_CATEGORIES."""
    defs = settings.get('categories')
    if defs and isinstance(defs, list) and len(defs) >= 2:
        try:
            return cats_from_defs(defs)
        except Exception:
            pass
    return None  # caller should fall back to ZR_CATEGORIES default

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

        # 3. Load league settings (categories + gracePeriod) once for all updates.
        liga_settings = _load_liga_settings(db)
        nightly_grace = liga_settings['gracePeriod']
        nightly_categories = _resolve_categories(liga_settings)  # None → ZR_CATEGORIES default

        # 4. Write results back to Firestore in batches.
        updated = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0

        # Pre-fetch ligaCategory for all riders so we can update status in the same batch.
        liga_by_elicense = {}
        for doc in db.collection('users').where('registration.status', '==', 'complete').stream():
            d = doc.to_dict() or {}
            lc = d.get('ligaCategory')
            if lc:
                e_lic = str(d.get('eLicense', doc.id)).strip()
                liga_by_elicense[e_lic] = lc

        for zwift_id, e_license in riders.items():
            rider_data = zr_by_id.get(zwift_id)
            if not rider_data:
                skipped += 1
                continue

            data = rider_data if 'race' in rider_data else rider_data.get('data', {})
            race = data.get('race', {})
            new_max30 = race.get('max30', {}).get('rating', 'N/A')

            update = {
                'zwiftRacing': {
                    'currentRating': race.get('current', {}).get('rating', 'N/A'),
                    'max30Rating':   new_max30,
                    'max90Rating':   race.get('max90', {}).get('rating', 'N/A'),
                    'phenotype':     data.get('phenotype', {}).get('value', 'N/A'),
                    'updatedAt':     firestore.SERVER_TIMESTAMP,
                }
            }

            # If this rider has an assigned liga category, update it.
            lc = liga_by_elicense.get(e_license)
            liga_update = {}
            if lc and new_max30 != 'N/A':
                try:
                    # Backward compat: old flat structure has no autoAssigned sub-object
                    auto = lc.get('autoAssigned') or lc
                    locked = lc.get('locked', False)

                    if locked:
                        # Locked riders: only update status tracking in autoAssigned
                        new_status = compute_category_status(
                            int(new_max30),
                            auto.get('upperBoundary'),
                            auto.get('graceLimit'),
                        )
                        liga_update = {
                            'ligaCategory.autoAssigned.status': new_status,
                            'ligaCategory.autoAssigned.lastCheckedRating': int(new_max30),
                            'ligaCategory.autoAssigned.lastCheckedAt': firestore.SERVER_TIMESTAMP,
                        }
                    else:
                        # Unlocked riders: re-compute full category from current max30
                        season = auto.get('season', '')
                        new_auto = build_liga_category(
                            int(new_max30), season, nightly_grace, nightly_categories
                        )
                        new_auto['assignedRating'] = auto.get('assignedRating', int(new_max30))
                        new_auto['assignedAt'] = auto.get('assignedAt')
                        new_auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP
                        liga_update = {'ligaCategory.autoAssigned': new_auto}
                except Exception:
                    pass

            doc_ref = db.collection('users').document(e_license)
            # Use update() with dot-notation to safely patch sub-fields without
            # overwriting sibling keys (e.g. locked, selfSelected).
            full_update = {
                'zwiftRacing': update['zwiftRacing'],
                **liga_update,
            }
            batch.update(doc_ref, full_update)

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


# ---------------------------------------------------------------------------
# Liga Category Enforcement
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/liga-categories/config', methods=['POST'])
def save_liga_categories_config():
    """
    Save a custom set of liga category definitions to league settings.

    Body: { "categories": [{ "name": str, "upper": int | null }, ...] }

    The list must be ordered from highest to lowest, with exactly one entry
    having upper=null (the top/uncapped category, which must be first).
    The saved config is used by assign-liga-categories and the nightly refresh.
    """
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        body = request.get_json(silent=True) or {}
        categories = body.get('categories')

        if not categories or not isinstance(categories, list):
            return jsonify({'message': "'categories' must be a non-empty list"}), 400
        if len(categories) < 2:
            return jsonify({'message': 'At least 2 categories are required'}), 400

        for cat in categories:
            name = cat.get('name', '')
            if not isinstance(name, str) or not name.strip():
                return jsonify({'message': 'Each category must have a non-empty name'}), 400
            upper = cat.get('upper')
            if upper is not None and not isinstance(upper, (int, float)):
                return jsonify({'message': 'upper must be a number or null'}), 400

        null_upper_count = sum(1 for c in categories if c.get('upper') is None)
        if null_upper_count != 1:
            return jsonify({'message': 'Exactly one category must have upper=null (the top)'}), 400
        if categories[0].get('upper') is not None:
            return jsonify({'message': 'The category with upper=null must be first'}), 400

        # Validate that upper boundaries are strictly decreasing
        uppers = [c['upper'] for c in categories[1:]]  # skip the null at index 0
        for i in range(len(uppers) - 1):
            if uppers[i] is not None and uppers[i + 1] is not None and uppers[i] <= uppers[i + 1]:
                return jsonify({'message': 'Upper boundaries must be strictly decreasing'}), 400

        # Normalise: strip whitespace from names, ensure upper is int or None
        normalised = [
            {'name': c['name'].strip(), 'upper': int(c['upper']) if c.get('upper') is not None else None}
            for c in categories
        ]

        db.collection('league').document('settings').set(
            {'ligaCategories': normalised}, merge=True
        )
        return jsonify({'message': 'Category configuration saved', 'count': len(normalised)}), 200

    except Exception as e:
        logger.error(f"Save liga categories config error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/assign-liga-categories', methods=['POST'])
def assign_liga_categories():
    """
    Bulk-assign liga categories to all registered riders based on their
    current max30 vELO rating.

    Body: { "season": "2025-03-01", "gracePeriod": 35 }

    Reads seasonStart / gracePeriod from league settings if not in body.
    Overwrites any existing ligaCategory on each user document.
    """
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        body = request.get_json(silent=True) or {}

        # Load league settings for defaults.
        settings_doc = db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}

        season = body.get('season') or settings.get('seasonStart', '')
        grace_period = int(body.get('gracePeriod', settings.get('gracePeriod', 35)))

        if not season:
            return jsonify({'message': 'season is required (set in body or league settings)'}), 400

        # Resolve category definitions: body → settings → ZR_CATEGORIES default.
        cat_defs = body.get('categories') or settings.get('ligaCategories')
        categories = cats_from_defs(cat_defs) if cat_defs else None

        # Persist season / gracePeriod back to settings.
        db.collection('league').document('settings').set(
            {'seasonStart': season, 'gracePeriod': grace_period},
            merge=True,
        )

        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        assigned = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0

        for doc in docs:
            data = doc.to_dict() or {}
            e_license = str(data.get('eLicense', doc.id)).strip()
            zr = data.get('zwiftRacing', {})
            max30 = zr.get('max30Rating', 'N/A')

            if max30 == 'N/A' or max30 is None:
                skipped += 1
                continue

            try:
                auto = build_liga_category(int(max30), season, grace_period, categories)
                auto['assignedAt'] = firestore.SERVER_TIMESTAMP
                auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP

                doc_ref = db.collection('users').document(e_license)
                # Fully reset ligaCategory: new autoAssigned, clear selfSelected, unlock
                batch.set(doc_ref, {
                    'ligaCategory': {
                        'autoAssigned': auto,
                        'locked': False,
                    }
                }, merge=True)

                assigned += 1
                batch_count += 1

                if batch_count >= _FIRESTORE_BATCH_SIZE:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
            except Exception as ex:
                logger.warning(f"Could not assign category for {e_license}: {ex}")
                skipped += 1

        if batch_count > 0:
            batch.commit()

        logger.info(f"Liga category assignment: {assigned} assigned, {skipped} skipped")
        return jsonify({
            'message': 'Liga categories assigned',
            'season': season,
            'gracePeriod': grace_period,
            'assigned': assigned,
            'skipped': skipped,
        }), 200

    except Exception as e:
        logger.error(f"Liga category assignment error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/liga-categories', methods=['GET'])
def get_liga_categories():
    """
    Return all registered riders with their ligaCategory data,
    sorted so 'over' riders appear first, then 'grace', then 'ok'.
    """
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        riders = []
        for doc in docs:
            data = doc.to_dict() or {}
            lc = serialize_liga_category(data.get('ligaCategory'))
            zr = data.get('zwiftRacing', {})

            riders.append({
                'zwiftId': data.get('zwiftId', ''),
                'name': data.get('name', ''),
                'eLicense': data.get('eLicense', doc.id),
                'club': data.get('club', ''),
                'max30Rating': zr.get('max30Rating', 'N/A'),
                'ligaCategory': lc,
            })

        # Sort: over → grace → ok → no category
        status_order = {'over': 0, 'grace': 1, 'ok': 2}
        riders.sort(key=lambda r: status_order.get(
            (r.get('ligaCategory') or {}).get('status', ''), 3
        ))

        return jsonify({'riders': riders}), 200

    except Exception as e:
        logger.error(f"Get liga categories error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/liga-categories/<zwift_id>/reassign', methods=['POST'])
def reassign_liga_category(zwift_id):
    """
    Manually move a rider up to the next category tier.
    Their grace limit resets to the new category's boundary + gracePeriod.
    """
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        user = UserService.get_user_by_id(zwift_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        data = user._data
        e_license = str(data.get('eLicense', zwift_id)).strip()
        lc = data.get('ligaCategory')
        if not lc:
            return jsonify({'message': 'Rider has no assigned liga category'}), 400

        liga_settings = _load_liga_settings(db)
        grace_period = liga_settings['gracePeriod']
        categories = _resolve_categories(liga_settings)

        zr = data.get('zwiftRacing', {})
        max30 = zr.get('max30Rating', 'N/A')
        if max30 == 'N/A':
            return jsonify({'message': 'Rider has no max30Rating'}), 400

        # Backward compat: old flat structure has no autoAssigned sub-object
        auto = lc.get('autoAssigned') or lc
        current_cat = auto.get('category')

        update_fields = reassign_to_next_category(current_cat, int(max30), grace_period, categories)
        update_fields['lastCheckedAt'] = firestore.SERVER_TIMESTAMP

        # Build the updated autoAssigned (merge new fields into existing)
        new_auto = {**auto, **update_fields}

        doc_update = {'ligaCategory.autoAssigned': new_auto}
        if lc.get('locked'):
            # Also update the frozen category so results reflect the forced move
            doc_update['ligaCategory.category'] = update_fields['category']

        db.collection('users').document(e_license).update(doc_update)

        return jsonify({
            'message': f"Rider moved to {update_fields['category']}",
            'category': update_fields['category'],
            'status': update_fields['status'],
        }), 200

    except Exception as e:
        logger.error(f"Reassign liga category error: {e}")
        return jsonify({'message': str(e)}), 500
