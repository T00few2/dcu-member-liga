import logging
import datetime
import threading

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
    resolve_canonical_user_doc_id,
    resolve_user_doc_id_from_auth_uid,
    save_token_doc,
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

    # Resolve the canonical user document the same way Zwift OAuth does:
    # auth_mappings → authUid query → fallback to uid.
    # This ensures tokens land at strava_tokens/{zwiftDocId}, not strava_tokens/{authUid}.
    user_doc_ref = _resolve_user_doc_ref_from_uid(uid)
    if not user_doc_ref:
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

    user_doc_ref = _resolve_user_doc_ref_from_uid(uid)
    if not user_doc_ref:
        user_doc_ref = db.collection('users').document(uid)

    access_token = None
    user_doc = user_doc_ref.get()
    if user_doc.exists:
        user_data = user_doc.to_dict() or {}
        access_token = (user_data.get('connections') or {}).get('strava', {}).get('access_token')

    # Check strava_tokens — try the resolved doc ID (zwiftId) first, then the
    # raw auth UID as a fallback for tokens stored under the old scheme.
    if not access_token:
        for candidate in dict.fromkeys([user_doc_ref.id, uid]):  # deduplicated, order preserved
            try:
                token_doc = db.collection('strava_tokens').document(candidate).get()
                if token_doc.exists:
                    access_token = (token_doc.to_dict() or {}).get('access_token')
                    break
            except Exception as e:
                logger.warning(f"Failed to fetch Strava tokens doc {candidate}: {e}")

    revoked = strava_service.deauthorize(access_token) if access_token else False

    # Delete from both possible locations so we don't leave orphaned token docs.
    for candidate in dict.fromkeys([user_doc_ref.id, uid]):
        try:
            db.collection('strava_tokens').document(candidate).delete()
        except Exception as e:
            logger.warning(f"Failed to delete Strava tokens doc {candidate}: {e}")

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
            'authUid': uid,
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
        if profile_numeric_id is not None:
            callback_update['zwiftId'] = str(profile_numeric_id)
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


def _try_link_and_verify_activity(
    db_ref: object,
    activity_id: str,
    user_doc_id: str,
    zwift_user_id: str,
) -> None:
    """Find a matching league race for *activity_id* and trigger DR if required.

    Called fire-and-forget after an ActivitySaved webhook is processed.
    All errors are swallowed so they never affect the webhook response.
    """
    try:
        from routes.admin_verification import (  # noqa: PLC0415 — lazy import avoids circular dep
            _extract_zwift_activity_fields,
            _is_dual_recording_required,
            _parse_iso_utc,
            _run_dr_verification_background,
        )

        # Load the stored activity to get start time
        act_doc = db_ref.collection('zwift_activities').document(str(activity_id)).get()
        if not act_doc.exists:
            return
        act_data = (act_doc.to_dict() or {}).get('data') or {}
        fields = _extract_zwift_activity_fields(act_data)
        started_at = fields.get('startedAt')
        if not started_at:
            return

        act_dt = _parse_iso_utc(started_at)
        if not act_dt:
            return

        # Use a slightly wider window: query races on the same day or ±1 day
        from datetime import timedelta as _td
        date_prev = (act_dt - _td(days=1)).strftime('%Y-%m-%d')
        date_next = (act_dt + _td(days=1)).strftime('%Y-%m-%d')

        race_docs = (
            db_ref.collection('races')
            .where('date', '>=', date_prev)
            .where('date', '<=', date_next)
            .stream()
        )

        matched_race_id: str | None = None
        matched_event_start: str | None = None

        for race_doc in race_docs:
            race_data = race_doc.to_dict() or {}
            for cfg in (race_data.get('eventConfiguration') or []):
                event_start_iso = cfg.get('startTime') or race_data.get('date') or ''
                event_dt = _parse_iso_utc(event_start_iso) if event_start_iso else None
                if event_dt is None:
                    # Fall back: treat the race date itself as start (accurate to ±24h)
                    event_dt = _parse_iso_utc(race_data.get('date') or '')
                if event_dt and abs((act_dt - event_dt).total_seconds()) <= 7200:
                    matched_race_id = race_doc.id
                    matched_event_start = event_start_iso or race_data.get('date')
                    break
            if matched_race_id:
                break

        if not matched_race_id:
            return

        # Tag the activity document with the likely race
        db_ref.collection('zwift_activities').document(str(activity_id)).set({
            'likelyRaceId': matched_race_id,
        }, merge=True)

        # Check if this rider requires dual recording
        if not _is_dual_recording_required(db_ref, user_doc_id):
            return

        # Resolve canonical zwift ID (user doc ID is canonical zwiftId in this system)
        user_doc = db_ref.collection('users').document(user_doc_id).get()
        canonical_zwift_id = (
            (user_doc.to_dict() or {}).get('zwiftId') or user_doc_id
            if user_doc.exists else user_doc_id
        )

        threading.Thread(
            target=_run_dr_verification_background,
            args=(db_ref, user_doc_id, canonical_zwift_id, str(activity_id),
                  matched_race_id, matched_event_start),
            daemon=True,
        ).start()

        logger.info(
            'Triggered DR verification: activity=%s race=%s rider=%s',
            activity_id, matched_race_id, canonical_zwift_id,
        )
    except Exception as exc:
        logger.error('_try_link_and_verify_activity(%s): %s', activity_id, exc)


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
                token_owner_id = token_doc.id
                user_doc_id = resolve_canonical_user_doc_id(token_owner_id) or token_owner_id
                zwift_service = get_zwift_service()
                access_token = get_valid_access_token(token_owner_id, zwift_service)
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
                        # Try to link activity to a league race and trigger DR if required
                        _try_link_and_verify_activity(db, str(activity_id), user_doc_id, str(user_id))
                    if token_owner_id != user_doc_id:
                        token_payload = get_token_doc(token_owner_id)
                        if token_payload:
                            save_token_doc(user_doc_id, token_payload)
                            delete_token_doc(token_owner_id)
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
                token_owner_id = token_doc.id
                user_doc_id = resolve_canonical_user_doc_id(token_owner_id) or token_owner_id
                zwift_service = get_zwift_service()
                access_token = get_valid_access_token(token_owner_id, zwift_service)
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
                    if token_owner_id != user_doc_id:
                        token_payload = get_token_doc(token_owner_id)
                        if token_payload:
                            save_token_doc(user_doc_id, token_payload)
                            delete_token_doc(token_owner_id)
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
                token_owner_id = token_doc.id
                user_doc_id = resolve_canonical_user_doc_id(token_owner_id) or token_owner_id
                delete_token_doc(token_owner_id)
                if token_owner_id != user_doc_id:
                    delete_token_doc(user_doc_id)
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
