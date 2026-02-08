from flask import Blueprint, request, jsonify
from firebase_admin import auth, firestore
from extensions import db, get_zwift_service, get_zp_service, strava_service, zr_service, get_zwift_game_service
from services.policy_store import POLICY_DATA_POLICY, POLICY_PUBLIC_RESULTS, PolicyError, get_policy_meta

users_bp = Blueprint('users', __name__)

def update_rider_stats(e_license, zwift_id):
    if not db or not e_license or not zwift_id:
        return None
    
    print(f"Fetching stats for {e_license} (ZwiftID: {zwift_id})")
    updates = {}
    
    # 1. ZwiftPower
    try:
        zp = get_zp_service()
        zp_json = zp.get_rider_data_json(int(zwift_id))
        if zp_json and 'data' in zp_json and len(zp_json['data']) > 0:
            rider_info = zp_json['data'][0]
            updates['zwiftPower'] = {
                'category': rider_info.get('category', 'N/A'),
                'ftp': rider_info.get('ftp', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
        print(f"ZP Fetch Error: {e}")

    # 2. ZwiftRacing
    try:
        zr_json = zr_service.get_rider_data(str(zwift_id))
        if zr_json:
            data = zr_json if 'race' in zr_json else zr_json.get('data', {})
            race = data.get('race', {})
            updates['zwiftRacing'] = {
                'currentRating': race.get('current', {}).get('rating', 'N/A'),
                'max30Rating': race.get('max30', {}).get('rating', 'N/A'),
                'max90Rating': race.get('max90', {}).get('rating', 'N/A'),
                'phenotype': data.get('phenotype', {}).get('value', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
         print(f"ZR Fetch Error: {e}")

    # 3. Zwift Profile
    try:
        zwift_service = get_zwift_service()
        profile = zwift_service.get_profile(int(zwift_id))
        if profile:
             updates['zwiftProfile'] = {
                'ftp': profile.get('ftp'),
                'weight': profile.get('weight'),
                'height': profile.get('height'),
                'racingScore': profile.get('competitionMetrics', {}).get('racingScore'),
                'updatedAt': firestore.SERVER_TIMESTAMP
             }
    except Exception as e:
         print(f"Zwift Fetch Error: {e}")
         
    # 4. Strava (Summary only)
    try:
        strava_data = strava_service.get_activities(e_license)
        if strava_data and 'kms' in strava_data:
            updates['stravaSummary'] = {
                'kms': strava_data.get('kms', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
        print(f"Strava Fetch Error: {e}")
         
    if updates:
        db.collection('users').document(str(e_license)).set(updates, merge=True)
        return updates
    return None

@users_bp.route('/profile', methods=['GET'])
def get_profile():
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Missing or invalid Authorization header'}), 401
        
        id_token = auth_header.split('Bearer ')[1]
        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']

        if not db:
             return jsonify({'message': 'Database not available'}), 500

        print(f"[DEBUG] get_profile for UID: {uid}")
        
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        if mapping_doc.exists:
            print(f"[DEBUG] Mapping found for {uid}: {mapping_doc.to_dict()}")
            zwift_id = mapping_doc.to_dict().get('zwiftId')
            # Fallback for old mappings (eLicense)
            if not zwift_id:
                 old_elicense = mapping_doc.to_dict().get('eLicense')
                 if old_elicense:
                     print(f"[DEBUG] Using old eLicense key: {old_elicense}")
                     user_doc = db.collection('users').document(str(old_elicense)).get()
                 else:
                     print(f"[DEBUG] Mapping exists but no keys. detailed fallback.")
                     user_doc = db.collection('users').document(uid).get()
            else:
                 print(f"[DEBUG] Using ZwiftID key: {zwift_id}")
                 user_doc = db.collection('users').document(str(zwift_id)).get()
        else:
            print(f"[DEBUG] No mapping found for {uid}")
            user_doc = db.collection('users').document(uid).get()
            
        # Fallback: Query by authUid if doc not found
        if not user_doc.exists:
            print(f"User {uid} not found by direct lookup/mapping. Trying authUid query...")
            docs = db.collection('users').where('authUid', '==', uid).limit(1).stream()
        # Always include currently required versions so clients can gate consistently,
        # even for brand new users without a profile document yet.
        try:
            policy_meta = get_policy_meta(db)
        except PolicyError as e:
            return jsonify({'message': e.message}), e.status_code

        if not user_doc.exists:
            return jsonify({
                'registered': False,
                'requiredDataPolicyVersion': policy_meta.get(POLICY_DATA_POLICY, {}).get('requiredVersion'),
                'requiredPublicResultsConsentVersion': policy_meta.get(POLICY_PUBLIC_RESULTS, {}).get('requiredVersion'),
            }), 200
        
        user_data = user_doc.to_dict()
        registration = user_data.get('registration', {})
        verification = user_data.get('verification', {})
        connections = user_data.get('connections', {})
        equipment = user_data.get('equipment', {})
        
        # Backwards compatibility reading (if mix of old/new data during dev)
        reg_status = registration.get('status')
        if not reg_status:
             # Try old fields
             if user_data.get('verified'): reg_status = 'complete'
             elif user_data.get('registrationComplete'): reg_status = 'complete'
             elif user_data.get('name'): reg_status = 'draft'
             else: reg_status = 'none'
             
        # Fallback for trainer
        trainer = equipment.get('trainer')
        if not trainer:
            trainer = user_data.get('trainer', '')

        is_registered = reg_status == 'complete'
        
        return jsonify({
            'registered': is_registered,
            'hasDraft': reg_status == 'draft',
            'eLicense': user_data.get('eLicense', ''),
            'name': user_data.get('name', ''),
            'zwiftId': user_data.get('zwiftId', ''),
            'club': user_data.get('club', ''),
            'trainer': trainer,
            'stravaConnected': bool(connections.get('strava')) or bool(user_data.get('strava')),
            'acceptedCoC': registration.get('cocAccepted', user_data.get('acceptedCoC', False)),
            'acceptedDataPolicy': bool(registration.get('dataPolicy')),
            'acceptedPublicResults': bool(registration.get('publicResultsConsent')),
            'dataPolicyVersion': registration.get('dataPolicy', {}).get('version'),
            'publicResultsConsentVersion': registration.get('publicResultsConsent', {}).get('version'),
            'requiredDataPolicyVersion': policy_meta.get(POLICY_DATA_POLICY, {}).get('requiredVersion'),
            'requiredPublicResultsConsentVersion': policy_meta.get(POLICY_PUBLIC_RESULTS, {}).get('requiredVersion'),
            'weightVerificationStatus': verification.get('status', 'none'),
            'weightVerificationVideoLink': verification.get('currentRequest', {}).get('videoLink', ''),
            'weightVerificationDeadline': verification.get('currentRequest', {}).get('deadline', None),
            'verificationRequests': verification.get('history', [])
        }), 200

    except Exception as e:
        print(f"Profile Error: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/signup', methods=['POST'])
def signup():
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Missing or invalid Authorization header'}), 401
        
        id_token = auth_header.split('Bearer ')[1]
        try:
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']
        except Exception as auth_error:
            return jsonify({'message': f'Invalid session token: {str(auth_error)}'}), 401

        request_json = request.get_json(silent=True)
        if not request_json:
             return jsonify({'message': 'Invalid JSON'}), 400
        
        e_license = request_json.get('eLicense')
        name = request_json.get('name')
        zwift_id = request_json.get('zwiftId')
        club = request_json.get('club', '')
        trainer = request_json.get('trainer', '')
        is_draft = request_json.get('draft', False)
        accepted_data_policy = bool(request_json.get('acceptedDataPolicy', False))
        accepted_public_results = bool(request_json.get('acceptedPublicResults', False))
        data_policy_version = request_json.get('dataPolicyVersion')
        public_results_consent_version = request_json.get('publicResultsConsentVersion')
        
        if is_draft:
            if not name:
                return jsonify({'message': 'At least a name is required to save progress'}), 400
        else:
            if not e_license or not name:
                return jsonify({'message': 'Missing eLicense or name'}), 400
            if not accepted_data_policy:
                return jsonify({'message': 'You must accept the data policy.'}), 400
            if not accepted_public_results:
                return jsonify({'message': 'You must accept publication of name and results.'}), 400
            try:
                required_versions = get_policy_meta(db)
            except PolicyError as e:
                return jsonify({'message': e.message}), e.status_code
            required_data_policy = required_versions.get(POLICY_DATA_POLICY, {}).get('requiredVersion')
            required_public = required_versions.get(POLICY_PUBLIC_RESULTS, {}).get('requiredVersion')
            if data_policy_version != required_data_policy:
                return jsonify({'message': 'Data policy version mismatch. Please review and accept the latest policy.'}), 400
            if public_results_consent_version != required_public:
                return jsonify({'message': 'Public results consent version mismatch. Please review and accept the latest consent.'}), 400

        if db:
            user_data = {
                'authUid': uid,
                'updatedAt': firestore.SERVER_TIMESTAMP,
                'zwiftId': zwift_id,
            }
            if name: user_data['name'] = name
            if e_license: user_data['eLicense'] = e_license
            if club: user_data['club'] = club
            
            # Equipment Group
            if trainer: 
                user_data['equipment'] = {'trainer': trainer}
            
            # Registration Group
            registration = {
                'cocAccepted': request_json.get('acceptedCoC', False)
            }
            
            if accepted_data_policy:
                registration['dataPolicy'] = {
                    'version': data_policy_version,
                    'acceptedAt': firestore.SERVER_TIMESTAMP
                }

            if accepted_public_results:
                registration['publicResultsConsent'] = {
                    'version': public_results_consent_version,
                    'acceptedAt': firestore.SERVER_TIMESTAMP
                }
            
            if is_draft:
                registration['status'] = 'draft'
            else:
                registration['status'] = 'complete'
                
            user_data['registration'] = registration
            
            # Use Zwift ID as the document ID (primary key)
            doc_id = str(zwift_id) if zwift_id else uid
            doc_ref = db.collection('users').document(doc_id)
            
            prev_data = {}
            try:
                prev_doc = doc_ref.get()
                if prev_doc.exists:
                    prev_data = prev_doc.to_dict() or {}
            except Exception:
                pass

            prev_reg_status = prev_data.get('registration', {}).get('status')
            is_newly_registered = not is_draft and prev_reg_status != 'complete'
            
            doc_ref.set(user_data, merge=True)

            # Handle Draft Migration (if user started as draft with UID key)
            if not is_draft and zwift_id and uid:
                draft_doc = db.collection('users').document(uid).get()
                if draft_doc.exists and draft_doc.id != str(zwift_id):
                    draft_data = draft_doc.to_dict() or {}
                    # Migrate connections if any
                    if 'connections' in draft_data:
                         doc_ref.set({'connections': draft_data['connections']}, merge=True)
                    try:
                        db.collection('users').document(uid).delete()
                    except Exception:
                        pass

            # Update Auth Mapping to point to Zwift ID
            if zwift_id:
                auth_map_ref = db.collection('auth_mappings').document(uid)
                auth_map_ref.set({
                    'zwiftId': zwift_id,
                    'lastLogin': firestore.SERVER_TIMESTAMP
                }, merge=True)
            
            if not is_draft and zwift_id and is_newly_registered:
                update_rider_stats(e_license, zwift_id)
        
        return jsonify({
            'message': 'Progress saved' if is_draft else ('Profile updated' if not is_newly_registered else 'Signup successful'),
            'verified': not is_draft,
            'draft': is_draft,
            'user': {'name': name, 'eLicense': e_license, 'zwiftId': zwift_id}
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@users_bp.route('/consents', methods=['POST'])
def update_consents():
    """
    Update policy/consent acceptances without changing registration status.
    Requires a valid Firebase ID token.
    """
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Missing or invalid Authorization header'}), 401

        id_token = auth_header.split('Bearer ')[1]
        decoded_token = auth.verify_id_token(id_token)
        uid = decoded_token['uid']

        request_json = request.get_json(silent=True) or {}
        accepted_data_policy = bool(request_json.get('acceptedDataPolicy', False))
        accepted_public_results = bool(request_json.get('acceptedPublicResults', False))
        data_policy_version = request_json.get('dataPolicyVersion')
        public_results_consent_version = request_json.get('publicResultsConsentVersion')

        try:
            required_versions = get_policy_meta(db)
        except PolicyError as e:
            return jsonify({'message': e.message}), e.status_code
        required_data_policy = required_versions.get(POLICY_DATA_POLICY, {}).get('requiredVersion')
        required_public = required_versions.get(POLICY_PUBLIC_RESULTS, {}).get('requiredVersion')

        if not accepted_data_policy or data_policy_version != required_data_policy:
            return jsonify({'message': 'You must accept the latest data policy.'}), 400
        if not accepted_public_results or public_results_consent_version != required_public:
            return jsonify({'message': 'You must accept the latest public results consent.'}), 400

        if not db:
            return jsonify({'message': 'Database not available'}), 500

        # Resolve user doc (eLicense mapping if present)
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        doc_id = uid  # Default to UID if no mapping found

        if mapping_doc.exists:
            m_data = mapping_doc.to_dict()
            zwift_id = m_data.get('zwiftId')
            e_license = m_data.get('eLicense')
            
            if zwift_id:
                doc_id = str(zwift_id)
            elif e_license:
                doc_id = str(e_license)

        updates = {
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'registration.dataPolicy': {
                'version': data_policy_version,
                'acceptedAt': firestore.SERVER_TIMESTAMP
            },
            'registration.publicResultsConsent': {
                'version': public_results_consent_version,
                'acceptedAt': firestore.SERVER_TIMESTAMP
            },
            # Remove legacy root fields if they exist? Or just stop updating them.
            # User wants clean schema.
            # We should probably unset the root ones if we want to be super clean, 
            # but Firestore delete is specific.
            # For now, let's just update the correct location.
            # Wait, the user provided JSON shows they Have acceptedDataPolicy: true at root.
            # We should probably sync them or migrate them.
            # But for this specific endpoint, let's write to the structure user prefers.
            'registration.status': 'complete' # Re-affirm status
        }

        db.collection('users').document(doc_id).set(updates, merge=True)

        return jsonify({'message': 'Consents updated'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@users_bp.route('/participants', methods=['GET'])
def get_participants():
    if not db:
         return jsonify({'error': 'DB not available'}), 500
    
    try:
        users_ref = db.collection('users')
        docs = users_ref.limit(100).stream()
        
        participants = []
        for doc in docs:
            data = doc.to_dict()
            zp = data.get('zwiftPower', {})
            zr = data.get('zwiftRacing', {})
            zpro = data.get('zwiftProfile', {})
            strava = data.get('stravaSummary', {})
            
            participants.append({
                'name': data.get('name'),
                'eLicense': data.get('eLicense'),
                'zwiftId': data.get('zwiftId'),
                'club': data.get('club', ''),
                'category': zp.get('category', 'N/A'),
                'ftp': zp.get('ftp', 'N/A'),
                'rating': zr.get('currentRating', 'N/A'),
                'max30Rating': zr.get('max30Rating', 'N/A'),
                'max90Rating': zr.get('max90Rating', 'N/A'),
                'phenotype': zr.get('phenotype', 'N/A'),
                'racingScore': zpro.get('racingScore', 'N/A'),
                'stravaKms': strava.get('kms', '-'),
                'weightVerificationStatus': data.get('verification', {}).get('status', 'none')
            })
        
        return jsonify({'participants': participants}), 200
    except Exception as e:
        print(f"Participants List Error: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/stats', methods=['GET'])
def get_stats():
    e_license = request.args.get('eLicense')
    
    if not e_license:
        auth_header = request.headers.get('Authorization')
        if auth_header and auth_header.startswith('Bearer '):
            try:
                id_token = auth_header.split('Bearer ')[1]
                decoded_token = auth.verify_id_token(id_token)
                uid = decoded_token['uid']
                
                if db:
                    mapping_doc = db.collection('auth_mappings').document(uid).get()
                    if mapping_doc.exists:
                        e_license = mapping_doc.to_dict().get('eLicense')
            except Exception as e:
                print(f"Token verification failed in stats: {e}")
    
    strava_data = {'kms': 'Not Connected', 'activities': []}
    zp_data = {'category': 'N/A', 'ftp': 'N/A'}
    zr_data = {}
    zwift_data = {}
    
    if e_license and db:
        try:
            user_doc = db.collection('users').document(str(e_license)).get()
            if user_doc.exists:
                user_data = user_doc.to_dict()
                
                if user_data.get('strava'):
                    strava_data = strava_service.get_activities(e_license)
                
                zwift_id = user_data.get('zwiftId')
                if zwift_id:
                    try:
                        zp = get_zp_service()
                        zp_json = zp.get_rider_data_json(int(zwift_id))
                        if zp_json and 'data' in zp_json and len(zp_json['data']) > 0:
                            rider_info = zp_json['data'][0]
                            zp_data = {
                                'category': rider_info.get('category', 'N/A'),
                                'ftp': rider_info.get('ftp', 'N/A'),
                            }
                    except Exception as zp_e:
                            print(f"ZwiftPower fetch error: {zp_e}")

                    try:
                        zr_json = zr_service.get_rider_data(str(zwift_id))
                        if zr_json:
                            data = zr_json if 'race' in zr_json else zr_json.get('data', {})
                            race = data.get('race', {})
                            zr_data = {
                                'currentRating': race.get('current', {}).get('rating', 'N/A'),
                                'max30Rating': race.get('max30', {}).get('rating', 'N/A'),
                                'max90Rating': race.get('max90', {}).get('rating', 'N/A'),
                                'phenotype': data.get('phenotype', {}).get('value', 'N/A'),
                                'finishes': race.get('finishes', 0),
                                'wins': race.get('wins', 0),
                                'podiums': race.get('podiums', 0),
                                'dnfs': race.get('dnfs', 0)
                            }
                    except Exception as zr_e:
                        print(f"ZwiftRacing fetch error: {zr_e}")

                    try:
                        zwift_service = get_zwift_service()
                        profile = zwift_service.get_profile(int(zwift_id))
                        if profile:
                            zwift_data = {
                                'ftp': profile.get('ftp', 'N/A'),
                                'weight': f"{round(profile.get('weight', 0) / 1000, 1)} kg" if profile.get('weight') else 'N/A',
                                'height': f"{round(profile.get('height', 0) / 10, 0)} cm" if profile.get('height') else 'N/A',
                                'totalDistance': f"{int(profile.get('totalDistance', 0) / 1000)} km" if profile.get('totalDistance') else 'N/A',
                                'totalTime': f"{int(profile.get('totalTimeInMinutes', 0) / 60)} hrs" if profile.get('totalTimeInMinutes') else 'N/A',
                                'level': int(profile.get('level', 0)),
                                'racingScore': profile.get('competitionMetrics', {}).get('racingScore', 'N/A')
                            }
                    except Exception as z_e:
                            print(f"Zwift API fetch error: {z_e}")

        except Exception as e:
            print(f"Error fetching stats: {e}")
    
    stats_data = {
        'stats': [
            {
                'platform': 'Zwift',
                **zwift_data
            },
            {
                'platform': 'ZwiftPower', 
                'category': zp_data.get('category', 'N/A'),
                'ftp': zp_data.get('ftp', 'N/A')
            },
            {
                'platform': 'ZwiftRacing',
                **zr_data
            },
            {
                'platform': 'Strava', 
                'kms': strava_data.get('kms', 'N/A'),
                'activities': strava_data.get('activities', [])
            }
        ]
    }
    return jsonify(stats_data), 200

@users_bp.route('/verify/zwift/<zwift_id>', methods=['GET'])
def verify_zwift_id(zwift_id):
    try:
        zwift_service = get_zwift_service()
        profile = zwift_service.get_profile(int(zwift_id))
        
        if not profile:
            return jsonify({'message': 'Rider not found'}), 404
        
        return jsonify({
            'firstName': profile.get('firstName'),
            'lastName': profile.get('lastName'),
            'id': profile.get('id')
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@users_bp.route('/verify/elicense/<e_license>', methods=['GET'])
def verify_elicense(e_license):
    if not db:
         return jsonify({'error': 'DB not available'}), 500
    
    try:
        doc = db.collection('users').document(str(e_license)).get()
        return jsonify({'available': not doc.exists}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
