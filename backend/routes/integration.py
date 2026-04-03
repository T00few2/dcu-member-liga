import logging
import datetime

from flask import Blueprint, request, jsonify, redirect
from firebase_admin import firestore
from extensions import db, strava_service, get_zwift_game_service, get_zwift_service
from config import FRONTEND_URL
from authz import verify_user_token, AuthzError
from services.schema_validation import with_schema_version
from services.zwift_tokens import (
    delete_token_doc,
    get_token_doc,
    get_valid_access_token,
    resolve_user_doc_id_from_auth_uid,
    upsert_from_token_response,
)
import secrets
import requests
from bs4 import BeautifulSoup

logger = logging.getLogger(__name__)

integration_bp = Blueprint('integration', __name__)


def _competition_metrics_to_profile(competition: dict, profile: dict) -> dict:
    """Map competitionMetrics + profile fields to the zwiftProfile Firestore shape."""
    return {
        'ftp': competition.get('ftp') or competition.get('zftp'),
        'zftp': competition.get('zftp'),
        'zmap': competition.get('zmap'),
        'racingScore': competition.get('racingScore'),
        'powerCompoundScore': competition.get('powerCompoundScore'),
        'vo2max': competition.get('vo2max'),
        'category': competition.get('category'),
        'categoryWomen': competition.get('categoryWomen'),
        'weightInGrams': competition.get('weightInGrams'),
        'weight': profile.get('weight'),
        'height': profile.get('heightInMillimeters'),
        'updatedAt': firestore.SERVER_TIMESTAMP,
    }


def _power_profile_to_firestore(power_profile: dict) -> dict:
    """Map /api/link/power-curve/power-profile response to the zwiftPowerCurve Firestore shape."""
    return {
        'zftp': power_profile.get('zftp'),
        'zmap': power_profile.get('zmap'),
        'vo2max': power_profile.get('vo2max'),
        'category': power_profile.get('category'),
        'categoryWomen': power_profile.get('categoryWomen'),
        'validPowerProfile': power_profile.get('validPowerProfile'),
        'metricsTimestamp': power_profile.get('metricsTimestamp'),
        'cpBestEfforts': power_profile.get('cpBestEfforts'),
        'relevantCpEfforts': power_profile.get('relevantCpEfforts'),
        'updatedAt': firestore.SERVER_TIMESTAMP,
    }


def _resolve_user_doc_ref_from_uid(uid: str):
    user_doc_id = resolve_user_doc_id_from_auth_uid(uid)
    if not user_doc_id:
        return None
    return db.collection('users').document(str(user_doc_id))

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
    zwift_id = body.get('zwiftId')

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    state = secrets.token_urlsafe(32)
    db.collection('strava_oauth_states').document(state).set({
        'uid': uid,
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
        mapped_zwift_id = mapping_data.get('zwiftId')
        if mapped_zwift_id:
            user_doc_ref = db.collection('users').document(str(mapped_zwift_id))
    
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
        user_doc_ref.set(with_schema_version({
            'connections': {'strava': {'athlete_id': token_data.get('athlete', {}).get('id')}},
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }), merge=True)

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
    
    if not user_doc_ref:
        user_doc_ref = db.collection('users').document(uid)

    access_token = None
    user_doc = user_doc_ref.get()
    if user_doc.exists:
        user_data = user_doc.to_dict() or {}
        access_token = (user_data.get('connections') or {}).get('strava', {}).get('access_token')

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
        user_doc_ref.update({
            'connections.strava': firestore.DELETE_FIELD,
        })
    except Exception as e:
        logger.warning(f"Failed to clean up Strava fields from user doc: {e}")

    return jsonify({'message': 'Strava disconnected', 'revoked': revoked}), 200


# --- ZWIFT OAUTH ---

@integration_bp.route('/zwift/login', methods=['GET'])
def zwift_login_get():
    return jsonify({'message': 'Use POST /zwift/login with Authorization header'}), 405


@integration_bp.route('/zwift/login', methods=['POST'])
def zwift_login_post():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    uid = decoded['uid']
    body = request.get_json(silent=True) or {}
    state = secrets.token_urlsafe(32)
    prompt_login = bool(body.get('promptLogin', False))

    db.collection('zwift_oauth_states').document(state).set({
        'uid': uid,
        'createdAt': firestore.SERVER_TIMESTAMP,
    })

    zwift_service = get_zwift_service()
    url = zwift_service.build_authorize_url(state=state, prompt_login=prompt_login)
    return jsonify({'url': url}), 200


@integration_bp.route('/zwift/callback', methods=['GET'])
def zwift_callback():
    code = request.args.get('code')
    state = request.args.get('state')
    error = request.args.get('error')
    if error:
        return jsonify({'message': f'Zwift Error: {error}'}), 400
    if not code or not state:
        return jsonify({'message': 'Missing code or state'}), 400

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    state_ref = db.collection('zwift_oauth_states').document(state)
    state_doc = state_ref.get()
    if not state_doc.exists:
        return jsonify({'message': 'Invalid or expired state'}), 400

    state_data = state_doc.to_dict() or {}
    uid = state_data.get('uid')

    created_at = state_data.get('createdAt')
    if created_at:
        age = datetime.datetime.now(datetime.timezone.utc) - created_at
        if age.total_seconds() > 600:
            state_ref.delete()
            return jsonify({'message': 'OAuth state expired, please try again'}), 400

    user_doc_ref = _resolve_user_doc_ref_from_uid(uid)
    if not user_doc_ref:
        return jsonify({'message': 'Could not resolve user document'}), 400

    zwift_service = get_zwift_service()
    try:
        status_code, token_data = zwift_service.exchange_code_for_tokens(code)
        if status_code != 200:
            return jsonify({'message': 'Failed to get Zwift tokens'}), 500

        access_token = token_data.get('access_token')
        profile = zwift_service.get_profile(user_access_token=access_token, include_competition_metrics=True) or {}
        competition = profile.get('competitionMetrics') or {}
        zwift_user_id = profile.get('userId')
        profile_numeric_id = profile.get('id')
        upsert_from_token_response(
            user_doc_ref.id,
            token_data,
            scopes=token_data.get('scope'),
            zwift_user_id=zwift_user_id,
        )

        power_profile = zwift_service.get_power_profile(access_token)

        callback_update: dict = {
            'zwiftUserId': zwift_user_id,
            'zwiftProfile': _competition_metrics_to_profile(competition, profile),
            'connections': {
                'zwift': {
                    'connected': True,
                    'connectedAt': firestore.SERVER_TIMESTAMP,
                    'scope': token_data.get('scope'),
                    'userId': zwift_user_id,
                    'profileId': profile_numeric_id,
                }
            },
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }
        if power_profile:
            callback_update['zwiftPowerCurve'] = _power_profile_to_firestore(power_profile)

        user_doc_ref.set(with_schema_version(callback_update), merge=True)

        try:
            zwift_service.subscribe_activity(access_token)
            zwift_service.subscribe_racing_score(access_token)
            zwift_service.subscribe_power_curve(access_token)
        except Exception as exc:
            logger.warning(f"Failed to subscribe to Zwift webhooks for {zwift_user_id}: {exc}")
    finally:
        try:
            state_ref.delete()
        except Exception as exc:
            logger.warning(f"Failed to delete Zwift OAuth state document: {exc}")

    return redirect(f"{FRONTEND_URL}/register?zwift=connected")


@integration_bp.route('/zwift/deauthorize', methods=['POST'])
def zwift_deauthorize():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    uid = decoded['uid']
    user_doc_ref = _resolve_user_doc_ref_from_uid(uid)
    if not user_doc_ref:
        return jsonify({'message': 'User not found'}), 404

    token_doc = get_token_doc(user_doc_ref.id) or {}
    refresh_token = token_doc.get('refresh_token')
    revoked = False
    if refresh_token:
        revoked = get_zwift_service().revoke_token(refresh_token)

    delete_token_doc(user_doc_ref.id)

    try:
        user_doc_ref.update({
            'connections.zwift': firestore.DELETE_FIELD,
        })
    except Exception as exc:
        logger.warning(f"Failed to clean up Zwift fields from user doc: {exc}")

    return jsonify({'message': 'Zwift disconnected', 'revoked': revoked}), 200


@integration_bp.route('/zwift/subscriptions/sync', methods=['POST'])
def zwift_sync_subscriptions():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    uid = decoded['uid']
    user_doc_ref = _resolve_user_doc_ref_from_uid(uid)
    if not user_doc_ref:
        return jsonify({'message': 'User not found'}), 404

    zwift_service = get_zwift_service()
    access_token = get_valid_access_token(user_doc_ref.id, zwift_service)
    if not access_token:
        return jsonify({'message': 'Zwift account not connected'}), 400

    body = request.get_json(silent=True) or {}
    subscribe_activity = bool(body.get('activity', True))
    subscribe_racing = bool(body.get('racingScore', True))
    subscribe_power_curve = bool(body.get('powerCurve', True))

    result: dict[str, dict[str, object]] = {}
    if subscribe_activity:
        status, payload = zwift_service.subscribe_activity(access_token)
        result['activity'] = {'status': status, 'payload': payload}
    if subscribe_racing:
        status, payload = zwift_service.subscribe_racing_score(access_token)
        result['racingScore'] = {'status': status, 'payload': payload}
    if subscribe_power_curve:
        status, payload = zwift_service.subscribe_power_curve(access_token)
        result['powerCurve'] = {'status': status, 'payload': payload}

    user_doc_ref.set(with_schema_version({
        'connections': {
            'zwift': {
                'subscriptions': {
                    'activity': subscribe_activity,
                    'racingScore': subscribe_racing,
                    'powerCurve': subscribe_power_curve,
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                }
            }
        }
    }), merge=True)
    return jsonify({'message': 'Subscription sync complete', 'result': result}), 200


@integration_bp.route('/zwift/webhook', methods=['POST'])
def zwift_webhook():
    if not db:
        return jsonify({'error': 'DB not available'}), 500

    payload = request.get_json(silent=True) or {}
    notification_id = payload.get('notificationId')
    if not notification_id:
        return jsonify({'message': 'Missing notificationId'}), 400

    notif_type = payload.get('notificationType')
    user_id = payload.get('userId')
    activity_id = payload.get('activityId')

    db.collection('zwift_webhooks').document(str(notification_id)).set(with_schema_version({
        'notificationId': notification_id,
        'notificationType': notif_type,
        'userId': user_id,
        'activityId': activity_id,
        'payload': payload,
        'receivedAt': firestore.SERVER_TIMESTAMP,
    }), merge=True)

    if notif_type == 'ActivitySaved' and user_id and activity_id:
        try:
            token_docs = (
                db.collection('zwift_tokens')
                .where('zwiftUserId', '==', user_id)
                .limit(1)
                .stream()
            )
            token_doc = next(token_docs, None)
            if token_doc:
                user_doc_id = token_doc.id
                zwift_service = get_zwift_service()
                access_token = get_valid_access_token(user_doc_id, zwift_service)
                if access_token:
                    activity = zwift_service.get_user_activity(str(activity_id), access_token)
                    if activity:
                        db.collection('zwift_activities').document(str(activity_id)).set(with_schema_version({
                            'activityId': str(activity_id),
                            'userId': user_id,
                            'source': 'webhook',
                            'data': activity,
                            'updatedAt': firestore.SERVER_TIMESTAMP,
                        }), merge=True)
        except Exception as exc:
            logger.error(f"Failed to process ActivitySaved webhook {notification_id}: {exc}")

    elif notif_type == 'RacingScoreUpdated' and user_id:
        try:
            token_docs = (
                db.collection('zwift_tokens')
                .where('zwiftUserId', '==', user_id)
                .limit(1)
                .stream()
            )
            token_doc = next(token_docs, None)
            if token_doc:
                user_doc_id = token_doc.id
                zwift_service = get_zwift_service()
                access_token = get_valid_access_token(user_doc_id, zwift_service)
                if access_token:
                    # Both racing-score and power-curve subscriptions fire RacingScoreUpdated.
                    # Fetch and store both in one pass.
                    profile = zwift_service.get_profile(user_access_token=access_token, include_competition_metrics=True)
                    power_profile = zwift_service.get_power_profile(access_token)
                    update: dict = {'updatedAt': firestore.SERVER_TIMESTAMP}
                    if profile:
                        competition = profile.get('competitionMetrics') or {}
                        update['zwiftProfile'] = _competition_metrics_to_profile(competition, profile)
                    if power_profile:
                        update['zwiftPowerCurve'] = _power_profile_to_firestore(power_profile)
                    if len(update) > 1:
                        db.collection('users').document(user_doc_id).set(with_schema_version(update), merge=True)
        except Exception as exc:
            logger.error(f"Failed to process RacingScoreUpdated webhook {notification_id}: {exc}")

    elif notif_type == 'UserDisconnected' and user_id:
        try:
            token_docs = (
                db.collection('zwift_tokens')
                .where('zwiftUserId', '==', user_id)
                .limit(1)
                .stream()
            )
            token_doc = next(token_docs, None)
            if token_doc:
                user_doc_id = token_doc.id
                db.collection('zwift_tokens').document(user_doc_id).delete()
                db.collection('users').document(user_doc_id).set(with_schema_version({
                    'connections': {'zwift': firestore.DELETE_FIELD},
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                }), merge=True)
                logger.info(f"Cleared Zwift connection for user {user_doc_id} after UserDisconnected webhook")
        except Exception as exc:
            logger.error(f"Failed to process UserDisconnected webhook {notification_id}: {exc}")

    return '', 204

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
