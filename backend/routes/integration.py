import logging
import datetime

from flask import Blueprint, request, jsonify, redirect
from firebase_admin import firestore
from extensions import db, strava_service, get_zwift_game_service
from config import FRONTEND_URL
from authz import verify_user_token, AuthzError
import secrets
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

integration_bp = Blueprint('integration', __name__)

# --- STRAVA ---

@integration_bp.route('/strava/login', methods=['GET'])
def strava_login_get():
    return jsonify({'message': 'Use POST /strava/login with Authorization header'}), 405

@integration_bp.route('/strava/login', methods=['POST'])
def strava_login_post():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    uid = decoded['uid']

    body = request.get_json(silent=True) or {}
    # We can pass eLicense or ZwiftID for context, but mainly rely on UID mapping later
    e_license = body.get('eLicense')
    zwift_id = body.get('zwiftId')

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    state = secrets.token_urlsafe(32)
    db.collection('strava_oauth_states').document(state).set({
        'uid': uid,
        'eLicense': e_license,
        'zwiftId': zwift_id,
        'createdAt': firestore.SERVER_TIMESTAMP
    })

    url = strava_service.build_authorize_url(state)
    return jsonify({'url': url}), 200

@integration_bp.route('/strava/callback', methods=['GET'])
def strava_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    
    if error: return jsonify({'message': f'Strava Error: {error}'}), 400
    if not code or not state: return jsonify({'message': 'Missing code or state'}), 400

    if not db: return jsonify({'error': 'DB not available'}), 500

    state_ref = db.collection('strava_oauth_states').document(state)
    state_doc = state_ref.get()
    if not state_doc.exists:
        return jsonify({'message': 'Invalid or expired state'}), 400
    
    state_data = state_doc.to_dict() or {}
    uid = state_data.get('uid')

    # Reject states older than 10 minutes
    created_at = state_data.get('createdAt')
    if created_at:
        age = datetime.datetime.now(datetime.timezone.utc) - created_at
        if age.total_seconds() > 600:
            state_ref.delete()
            return jsonify({'message': 'OAuth state expired, please try again'}), 400

    # Try to find the real user document from auth_mappings
    user_doc_ref = None
    
    mapping_doc = db.collection('auth_mappings').document(uid).get()
    if mapping_doc.exists:
        mapping_data = mapping_doc.to_dict()
        # Check for new primary key (ZwiftID)
        mapped_zwift_id = mapping_data.get('zwiftId')
        if mapped_zwift_id:
            user_doc_ref = db.collection('users').document(str(mapped_zwift_id))
        else:
            # Fallback to old eLicense key
            mapped_elicense = mapping_data.get('eLicense')
            if mapped_elicense:
                user_doc_ref = db.collection('users').document(str(mapped_elicense))
    
    if not user_doc_ref:
         # Fallback: Just update the UID doc (drafts/unregistered)
         user_doc_ref = db.collection('users').document(uid)

    try:
        status_code, token_data = strava_service.exchange_code_for_tokens(code)
        if status_code != 200:
            return jsonify({'message': 'Failed to get Strava tokens'}), 500

        # Store tokens in the dedicated collection, keyed by the user doc ID
        token_ref = db.collection('strava_tokens').document(user_doc_ref.id)
        token_ref.set({
            'athlete_id': token_data.get('athlete', {}).get('id'),
            'access_token': token_data.get('access_token'),
            'refresh_token': token_data.get('refresh_token'),
            'expires_at': token_data.get('expires_at'),
        }, merge=True)

        # Record that Strava is connected in the user doc (no tokens here)
        user_doc_ref.set({
            'connections': {'strava': {'athlete_id': token_data.get('athlete', {}).get('id')}},
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }, merge=True)

    finally:
        try:
            state_ref.delete()
        except Exception as e:
            logger.warning(f"Failed to delete OAuth state document: {e}")

    return redirect(f"{FRONTEND_URL}/register?strava=connected")

@integration_bp.route('/strava/deauthorize', methods=['POST'])
def strava_deauthorize():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    uid = decoded['uid']

    if not db: return jsonify({'error': 'DB not available'}), 500

    # Locate user doc via mapping
    user_doc_ref = None
    mapping_doc = db.collection('auth_mappings').document(uid).get()
    if mapping_doc.exists:
        mapping_data = mapping_doc.to_dict()
        if mapping_data.get('zwiftId'):
            user_doc_ref = db.collection('users').document(str(mapping_data.get('zwiftId')))
        elif mapping_data.get('eLicense'):
             user_doc_ref = db.collection('users').document(str(mapping_data.get('eLicense')))
    
    if not user_doc_ref:
        user_doc_ref = db.collection('users').document(uid)

    access_token = None
    user_doc = user_doc_ref.get()
    if user_doc.exists:
        user_data = user_doc.to_dict() or {}
        # Check new location first
        access_token = (user_data.get('connections') or {}).get('strava', {}).get('access_token')
        # Check legacy location
        if not access_token:
             access_token = (user_data.get('strava') or {}).get('access_token')

    # Also check strava_tokens collection for the access token
    if not access_token:
        try:
            token_doc = db.collection('strava_tokens').document(user_doc_ref.id).get()
            if token_doc.exists:
                access_token = (token_doc.to_dict() or {}).get('access_token')
        except Exception as e:
            logger.warning(f"Failed to fetch Strava tokens doc: {e}")

    revoked = strava_service.deauthorize(access_token) if access_token else False

    try:
        db.collection('strava_tokens').document(user_doc_ref.id).delete()
    except Exception as e:
        logger.warning(f"Failed to delete Strava tokens doc: {e}")

    try:
        # Remove legacy token fields from user doc if they still exist
        user_doc_ref.update({
            'connections.strava': firestore.DELETE_FIELD,
            'strava': firestore.DELETE_FIELD,
        })
    except Exception as e:
        logger.warning(f"Failed to clean up Strava fields from user doc: {e}")

    return jsonify({'message': 'Strava disconnected', 'revoked': revoked}), 200

# --- ZWIFT GAME DATA ---

@integration_bp.route('/routes', methods=['GET'])
def get_routes():
    game_service = get_zwift_game_service()
    routes = game_service.get_routes()
    return jsonify({'routes': routes}), 200

@integration_bp.route('/segments', methods=['GET'])
def get_segments():
    route_id = request.args.get('routeId')
    laps = request.args.get('laps', 1)
    if not route_id: return jsonify({'message': 'Missing routeId'}), 400
    
    game_service = get_zwift_game_service()
    segments = game_service.get_event_segments(route_id, laps=int(laps))
    return jsonify({'segments': segments}), 200

# --- CLUBS ---

@integration_bp.route('/clubs', methods=['GET'])
def get_clubs():
    try:
        response = requests.get('https://dcumedlem.sportstiming.dk/clubs', timeout=10)
        response.raise_for_status()
        
        soup = BeautifulSoup(response.content, 'html.parser')
        table = soup.find('table')
        if not table: return jsonify({'message': 'Could not find clubs table'}), 500
        
        clubs = []
        rows = table.find_all('tr')[1:]
        for row in rows:
            cols = row.find_all('td')
            if len(cols) >= 3:
                clubs.append({
                    'name': cols[0].get_text(strip=True),
                    'district': cols[1].get_text(strip=True),
                    'type': cols[2].get_text(strip=True)
                })
        return jsonify({'clubs': clubs}), 200
    except Exception as e:
        return jsonify({'message': f'Failed to fetch clubs: {str(e)}'}), 500
