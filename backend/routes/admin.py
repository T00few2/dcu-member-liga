from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, strava_service, get_zp_service
from authz import require_admin, AuthzError

admin_bp = Blueprint('admin', __name__)

def verify_admin_auth():
    return require_admin(request)

@admin_bp.route('/admin/verification/rider/<e_license>', methods=['GET'])
def verify_rider(e_license):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
            return jsonify({'error': 'DB not available'}), 500

    try:
        user_doc = db.collection('users').document(str(e_license)).get()
        if not user_doc.exists:
            return jsonify({'message': 'User not found'}), 404
        
        user_data = user_doc.to_dict()
        zwift_id = user_data.get('zwiftId')
        
        response_data = {'profile': {}, 'stravaActivities': [], 'zwiftPowerHistory': []}

        # Zwift Profile
        if zwift_id:
            try:
                zwift_service = get_zwift_service()
                profile = zwift_service.get_profile(int(zwift_id))
                if profile:
                    response_data['profile'] = {
                        'weight': round(profile.get('weight', 0) / 1000, 1) if profile.get('weight') else None,
                        'height': round(profile.get('height', 0) / 10, 0) if profile.get('height') else None,
                        'maxHr': profile.get('heartRateMax', 0)
                    }
            except Exception as e:
                print(f"Zwift Profile Fetch Error: {e}")

        # Strava
        try:
            strava_raw = strava_service.get_activities(e_license)
            if strava_raw and 'activities' in strava_raw:
                response_data['stravaActivities'] = strava_raw['activities'] 
        except Exception as e:
            print(f"Strava Verification Fetch Error: {e}")

        # ZwiftPower
        if zwift_id:
            try:
                zp = get_zp_service()
                zp_json = zp.get_rider_data_json(int(zwift_id))
                
                if zp_json and 'data' in zp_json:
                    history = []
                    for entry in zp_json['data']:
                        # Simplify parsing logic for readability in this port
                        # (Assume same helper logic as original or simplified)
                        
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
                            except:
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
                print(f"ZP Verification Fetch Error: {e}")

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
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        return jsonify({'message': 'Unauthorized'}), 401
    try:
        id_token = auth_header.split('Bearer ')[1]
        decoded = auth.verify_id_token(id_token)
        uid = decoded['uid']
    except:
        return jsonify({'message': 'Unauthorized'}), 401
    
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

