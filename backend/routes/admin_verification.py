"""
Admin: Weight/rider verification routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from concurrent.futures import ThreadPoolExecutor

from flask import request, jsonify

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db, get_zwift_service, strava_service
from services.user_service import UserService
from services.zwift_tokens import get_valid_access_token

import logging

logger = logging.getLogger(__name__)


@admin_bp.route('/admin/verification/rider/<rider_id>', methods=['GET'])
def verify_rider(rider_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        zwift_id = user.zwift_id
        strava_auth = user.strava_auth

        response_data = {'profile': {}, 'stravaActivities': [], 'zwiftPowerHistory': [], 'officialMetrics': {}}

        def fetch_zwift_profile():
            if not zwift_id:
                return None
            access_token = get_valid_access_token(str(user.id), get_zwift_service())
            if not access_token:
                return None
            return get_zwift_service().get_profile(user_access_token=access_token)

        def fetch_strava():
            if not strava_auth or not zwift_id:
                return None
            return strava_service.get_activities(zwift_id)

        def fetch_power_curve():
            if not zwift_id:
                return None
            access_token = get_valid_access_token(str(user.id), get_zwift_service())
            if not access_token:
                return None
            service = get_zwift_service()
            power_profile = service.get_power_profile(access_token)
            best_curve = service.get_best_power_curve_all_time(access_token)
            return {'powerProfile': power_profile, 'bestCurve': best_curve}

        with ThreadPoolExecutor(max_workers=3) as executor:
            f_profile = executor.submit(fetch_zwift_profile)
            f_strava = executor.submit(fetch_strava)
            f_power = executor.submit(fetch_power_curve)

        try:
            profile = f_profile.result(timeout=30)
            if profile:
                competition = profile.get('competitionMetrics') or {}
                response_data['profile'] = {
                    'weight': round(profile.get('weight', 0) / 1000, 1) if profile.get('weight') else None,
                    'height': round(profile.get('heightInMillimeters', 0) / 10, 0) if profile.get('heightInMillimeters') else None,
                    'maxHr': profile.get('heartRateMax', 0),
                    'img': profile.get('imageSrc'),
                    'racingScore': competition.get('racingScore'),
                    'zftp': competition.get('zftp'),
                    'zmap': competition.get('zmap'),
                }
        except Exception as e:
            logger.error(f"Zwift Profile Fetch Error: {e}")

        try:
            strava_raw = f_strava.result(timeout=30)
            if strava_raw and 'activities' in strava_raw:
                response_data['stravaActivities'] = strava_raw['activities']
        except Exception as e:
            logger.error(f"Strava Verification Fetch Error: {e}")

        try:
            power_data = f_power.result(timeout=30)
            if power_data:
                response_data['officialMetrics'] = power_data
                best_curve = (power_data.get('bestCurve') or {}).get('pointsWatts') or {}
                history = []
                for duration_sec, point in best_curve.items():
                    history.append({
                        'date': point.get('date'),
                        'event_title': f"Best effort {duration_sec}s",
                        'avg_watts': point.get('value', 0),
                        'avg_hr': 0,
                        'wkg': 0,
                        'category': '',
                        'weight': 0,
                        'height': 0,
                        'cp_curve': {str(duration_sec): point.get('value', 0)},
                    })
                response_data['zwiftPowerHistory'] = history
        except Exception as e:
            logger.error(f"Official metrics fetch error: {e}")

        return jsonify(response_data), 200

    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/verification/strava/streams/<activity_id>', methods=['GET'])
def get_strava_streams(activity_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    zwift_id = request.args.get('zwiftId')
    if not zwift_id:
        return jsonify({'message': 'Missing zwiftId'}), 400

    try:
        streams = strava_service.get_activity_streams(zwift_id, activity_id)
        if streams:
            return jsonify({'streams': streams}), 200
        return jsonify({'message': 'Failed to fetch streams'}), 404
    except Exception as e:
        return jsonify({'message': str(e)}), 500
