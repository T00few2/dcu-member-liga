from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, get_zp_service, strava_service, zr_service, stats_queue
from services.policy_store import POLICY_DATA_POLICY, POLICY_PUBLIC_RESULTS, PolicyError, get_policy_meta
from services.user_service import UserService
from services.category_engine import build_liga_category, ZR_CATEGORIES, serialize_liga_category
from authz import verify_user_token, AuthzError

import logging

logger = logging.getLogger(__name__)

users_bp = Blueprint('users', __name__)

def update_rider_stats(e_license, zwift_id):
    if not db or not e_license or not zwift_id:
        return None
    
    logger.info(f"Fetching stats for {e_license} (ZwiftID: {zwift_id})")
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
        logger.error(f"ZP Fetch Error: {e}")

    # 2. ZwiftRacing
    try:
        zr_json = zr_service.get_rider_data(str(zwift_id))
        if zr_json:
            data = zr_json if 'race' in zr_json else zr_json.get('data', {})
            race = data.get('race', {})
            max30 = race.get('max30', {}).get('rating', 'N/A')
            updates['zwiftRacing'] = {
                'currentRating': race.get('current', {}).get('rating', 'N/A'),
                'max30Rating': max30,
                'max90Rating': race.get('max90', {}).get('rating', 'N/A'),
                'phenotype': data.get('phenotype', {}).get('value', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            # Auto-assign ligaCategory on first-time registration if not already set.
            if max30 != 'N/A' and db and e_license:
                existing_doc = db.collection('users').document(str(e_license)).get()
                existing_lc = (existing_doc.to_dict() or {}).get('ligaCategory') if existing_doc.exists else None
                if not existing_lc:
                    auto = build_liga_category(int(max30))
                    auto['assignedAt'] = firestore.SERVER_TIMESTAMP
                    updates['ligaCategory'] = {
                        'autoAssigned': auto,
                        'locked': False,
                    }
                    logger.info(f"Auto-assigned ligaCategory {auto['category']} for {e_license}")
    except Exception as e:
         logger.error(f"ZR Fetch Error: {e}")

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
         logger.error(f"Zwift Fetch Error: {e}")
         
    # 4. Strava (Summary only)
    try:
        strava_data = strava_service.get_activities(e_license)
        if strava_data and 'kms' in strava_data:
            updates['stravaSummary'] = {
                'kms': strava_data.get('kms', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
        logger.error(f"Strava Fetch Error: {e}")
         
    if updates:
        db.collection('users').document(str(e_license)).set(updates, merge=True)
        return updates
    return None

@users_bp.route('/profile', methods=['GET'])
def get_profile():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code
        uid = decoded_token['uid']

        if not db:
             return jsonify({'message': 'Database not available'}), 500

        user = UserService.get_user_by_auth_uid(uid)

        # Always include currently required versions so clients can gate consistently,
        # even for brand new users without a profile document yet.
        try:
            policy_meta = get_policy_meta(db)
        except PolicyError as e:
            return jsonify({'message': e.message}), e.status_code

        if not user:
            return jsonify({
                'registered': False,
                'requiredDataPolicyVersion': policy_meta.get(POLICY_DATA_POLICY, {}).get('requiredVersion'),
                'requiredPublicResultsConsentVersion': policy_meta.get(POLICY_PUBLIC_RESULTS, {}).get('requiredVersion'),
            }), 200
        
        lc = serialize_liga_category(user._data.get('ligaCategory'))

        return jsonify({
            'registered': user.is_registered,
            'hasDraft': user.registration.get('status') == 'draft',
            'welcomeSeen': user._data.get('welcomeSeen', False),
            'eLicense': user.e_license,
            'name': user.name,
            'zwiftId': user.zwift_id,
            'club': user.club,
            'trainer': user.trainer,
            'stravaConnected': bool(user._data.get('connections', {}).get('strava')) or bool(user._data.get('strava')),
            'acceptedCoC': user.registration.get('cocAccepted', user._data.get('acceptedCoC', False)),
            'acceptedDataPolicy': user.accepted_data_policy,
            'acceptedPublicResults': user.accepted_public_results,
            'dataPolicyVersion': user.data_policy_version,
            'publicResultsConsentVersion': user.public_results_consent_version,
            'requiredDataPolicyVersion': policy_meta.get(POLICY_DATA_POLICY, {}).get('requiredVersion'),
            'requiredPublicResultsConsentVersion': policy_meta.get(POLICY_PUBLIC_RESULTS, {}).get('requiredVersion'),
            'weightVerificationStatus': user.verification_status,
            'weightVerificationVideoLink': user.weight_verification_video_link,
            'weightVerificationDeadline': user.weight_verification_deadline,
            'verificationRequests': user.verification_history,
            'ligaCategory': lc,
        }), 200

    except Exception as e:
        logger.error(f"Profile Error: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/signup', methods=['POST'])
def signup():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code
        uid = decoded_token['uid']
        email = decoded_token.get('email')

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
            if not name:
                return jsonify({'message': 'Missing name'}), 400
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
                'email': email,
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

            @firestore.transactional
            def _promote_registration(transaction, ref, data):
                prev_doc = ref.get(transaction=transaction)
                prev_reg_status = (prev_doc.to_dict() or {}).get('registration', {}).get('status') if prev_doc.exists else None
                newly_registered = not is_draft and prev_reg_status != 'complete'
                transaction.set(ref, data, merge=True)
                return newly_registered

            is_newly_registered = _promote_registration(db.transaction(), doc_ref, user_data)

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

            # Update Auth Mapping
            auth_map_data = {
                'lastLogin': firestore.SERVER_TIMESTAMP
            }
            if zwift_id: auth_map_data['zwiftId'] = zwift_id
            if e_license: auth_map_data['eLicense'] = e_license
            
            db.collection('auth_mappings').document(uid).set(auth_map_data, merge=True)
            
            if not is_draft and zwift_id and is_newly_registered:
                stats_queue.enqueue(str(e_license), str(zwift_id))
        
        return jsonify({
            'message': 'Progress saved' if is_draft else ('Profile updated' if not is_newly_registered else 'Signup successful'),
            'verified': not is_draft,
            'draft': is_draft,
            'user': {'name': name, 'eLicense': e_license, 'zwiftId': zwift_id}
        }), 200
    except Exception as e:
        logger.error(f"Signup Error: {e}")
        return jsonify({'message': str(e)}), 500


@users_bp.route('/consents', methods=['POST'])
def update_consents():
    """
    Update policy/consent acceptances without changing registration status.
    Requires a valid Firebase ID token.
    """
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code
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

        user = UserService.get_user_by_auth_uid(uid)
        doc_id = user.id if user else uid

        updates = {
            'updatedAt': firestore.SERVER_TIMESTAMP,
            'registration': {
                'dataPolicy': {
                    'version': data_policy_version,
                    'acceptedAt': firestore.SERVER_TIMESTAMP
                },
                'publicResultsConsent': {
                    'version': public_results_consent_version,
                    'acceptedAt': firestore.SERVER_TIMESTAMP
                },
                'status': 'complete' # Re-affirm status
            }
        }

        db.collection('users').document(str(doc_id)).set(updates, merge=True)

        return jsonify({'message': 'Consents updated'}), 200
    except Exception as e:
        logger.error(f"Consents Error: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/welcome-seen', methods=['POST'])
def set_welcome_seen():
    try:
        try:
            decoded_token = verify_user_token(request)
        except AuthzError as e:
            return jsonify({'message': e.message}), e.status_code
        uid = decoded_token['uid']
        
        if not db:
            return jsonify({'message': 'Database not available'}), 500

        user = UserService.get_user_by_auth_uid(uid)
        if not user:
            # Fallback if no user document exists yet
            db.collection('users').document(uid).set({'welcomeSeen': True}, merge=True)
        else:
            db.collection('users').document(str(user.id)).set({'welcomeSeen': True}, merge=True)
            
        return jsonify({'message': 'Updated'}), 200
    except Exception as e:
        logger.error(f"Welcome-seen Error: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/category/select', methods=['POST'])
def select_category():
    """
    Allows a fully registered rider to self-select their liga category.

    Rules:
    - The chosen category must be the same as, or higher than, the auto-assigned category.
    - Once a rider has completed at least one race (ligaCategory.locked == True), their
      category is locked and cannot be changed via this endpoint (admin force-move only).
    """
    try:
        decoded_token = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    uid = decoded_token['uid']

    if not db:
        return jsonify({'message': 'Database not available'}), 500

    user = UserService.get_user_by_auth_uid(uid)
    if not user or not user.is_registered:
        return jsonify({'message': 'User not registered'}), 403

    data = request.get_json(silent=True) or {}
    chosen = (data.get('category') or '').strip()

    # Validate chosen category exists
    cat_names = [name for name, _, _ in ZR_CATEGORIES]
    if chosen not in cat_names:
        return jsonify({'message': f'Unknown category: {chosen}'}), 400

    existing_lc = user._data.get('ligaCategory') or {}

    # Enforce lock: no self-selection after first completed race
    if existing_lc.get('locked'):
        return jsonify({'message': 'Din kategori er låst efter gennemført løb. Kontakt admin for at rykke op.'}), 403

    # Get the auto-assigned category (floor for self-selection)
    auto = existing_lc.get('autoAssigned') or {}
    auto_cat = auto.get('category')

    # Determine order (lower index = higher/harder category)
    def cat_index(name):
        try:
            return cat_names.index(name)
        except ValueError:
            return len(cat_names)  # unknown → worst rank

    # Chosen must be same or higher (lower index) than auto-assigned
    if auto_cat and cat_index(chosen) > cat_index(auto_cat):
        return jsonify({'message': f'Du kan ikke vælge en lavere kategori end din auto-tildelte ({auto_cat}).'}), 400

    doc_id = str(user.id)
    db.collection('users').document(doc_id).update({
        'ligaCategory.selfSelected': {
            'category': chosen,
            'selfSelectedAt': firestore.SERVER_TIMESTAMP,
        }
    })

    return jsonify({'message': f'Kategori opdateret til {chosen}', 'ligaCategory': chosen}), 200


@users_bp.route('/participants', methods=['GET'])
def get_participants():
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
         return jsonify({'error': 'DB not available'}), 500

    try:
        participants = []
        raw_limit = request.args.get('limit', '1000')
        try:
            fetch_limit = min(int(raw_limit), 2000)
        except (ValueError, TypeError):
            fetch_limit = 1000
        user_objects = UserService.get_all_participants(limit=fetch_limit)
        
        for user in user_objects:
            data = user._data
            zp = data.get('zwiftPower', {})
            zr = data.get('zwiftRacing', {})
            zpro = data.get('zwiftProfile', {})
            strava = data.get('stravaSummary', {})
            lc = serialize_liga_category(data.get('ligaCategory'))

            participants.append({
                'name': user.name,
                'eLicense': user.e_license,
                'zwiftId': user.zwift_id,
                'club': user.club,
                'category': zp.get('category', 'N/A'),
                'ftp': zp.get('ftp', 'N/A'),
                'rating': zr.get('currentRating', 'N/A'),
                'max30Rating': zr.get('max30Rating', 'N/A'),
                'max90Rating': zr.get('max90Rating', 'N/A'),
                'phenotype': zr.get('phenotype', 'N/A'),
                'racingScore': zpro.get('racingScore', 'N/A'),
                'stravaKms': strava.get('kms', '-'),
                'weightVerificationStatus': user.verification_status,
                'ligaCategory': lc,
            })
        
        return jsonify({'participants': participants}), 200
    except Exception as e:
        logger.error(f"Participants List Error: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/stats', methods=['GET'])
def get_stats():
    e_license = request.args.get('eLicense')
    
    if not e_license:
        try:
            decoded_token = verify_user_token(request)
            uid = decoded_token['uid']
            if db:
                mapping_doc = db.collection('auth_mappings').document(uid).get()
                if mapping_doc.exists:
                    e_license = mapping_doc.to_dict().get('eLicense')
        except AuthzError:
            pass  # Unauthenticated access is allowed for this endpoint
        except Exception as e:
            logger.error(f"Token lookup failed in stats: {e}")
    
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
                            logger.error(f"ZwiftPower fetch error: {zp_e}")

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
                        logger.error(f"ZwiftRacing fetch error: {zr_e}")

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
                            logger.error(f"Zwift API fetch error: {z_e}")

        except Exception as e:
            logger.error(f"Error fetching stats: {e}")
    
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
        logger.error(f"Zwift verify error for {zwift_id}: {e}")
        return jsonify({'message': str(e)}), 500

@users_bp.route('/verify/elicense/<e_license>', methods=['GET'])
def verify_elicense(e_license):
    if not db:
         return jsonify({'error': 'DB not available'}), 500
    
    try:
        doc = db.collection('users').document(str(e_license)).get()
        return jsonify({'available': not doc.exists}), 200
    except Exception as e:
        logger.error(f"eLicense verify error for {e_license}: {e}")
        return jsonify({'message': str(e)}), 500
