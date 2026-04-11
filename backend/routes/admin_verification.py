"""
Admin: Weight/rider verification routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta

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

            # Fetch the power profile and all time-range curves in parallel.
            with ThreadPoolExecutor(max_workers=6) as curve_executor:
                f_pp     = curve_executor.submit(service.get_power_profile, access_token)
                f_all    = curve_executor.submit(service.get_best_power_curve_all_time, access_token)
                f_30d    = curve_executor.submit(service.get_best_power_curve_last, access_token, 30)
                f_90d    = curve_executor.submit(service.get_best_power_curve_last, access_token, 90)
                f_180d   = curve_executor.submit(service.get_best_power_curve_last, access_token, 180)
                f_360d   = curve_executor.submit(service.get_best_power_curve_last, access_token, 360)

            curves = {}
            for key, fut in [('allTime', f_all), ('last30d', f_30d), ('last90d', f_90d),
                              ('last180d', f_180d), ('last360d', f_360d)]:
                try:
                    curves[key] = fut.result()
                except Exception as e:
                    logger.error(f"Error fetching {key} curve: {e}")
                    curves[key] = None

            power_profile = None
            try:
                power_profile = f_pp.result()
            except Exception as e:
                logger.error(f"Error fetching power profile: {e}")

            return {'powerProfile': power_profile, 'curves': curves}

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
            power_data = f_power.result(timeout=60)
            if power_data:
                response_data['officialMetrics'] = power_data
                curves = power_data.get('curves') or {}
                now = datetime.utcnow()

                # Each entry is given a synthetic date that places it inside exactly
                # the right time-range bucket so the frontend's filter works:
                #
                #   30-day entry  → 15 days ago   (passes 30d/90d/180d/360d/all-time)
                #   90-day entry  → 60 days ago   (passes 90d/180d/360d/all-time)
                #   180-day entry → 120 days ago  (passes 180d/360d/all-time)
                #   360-day entry → 240 days ago  (passes 360d/all-time)
                #   all-time entry→ 400 days ago  (passes all-time only)
                #
                # The chart takes max() across all matching entries, which gives the
                # correct best value for every selected range.
                range_configs = [
                    ('last30d',  now - timedelta(days=15),  'Best Power (Last 30 Days)'),
                    ('last90d',  now - timedelta(days=60),  'Best Power (Last 90 Days)'),
                    ('last180d', now - timedelta(days=120), 'Best Power (Last 180 Days)'),
                    ('last360d', now - timedelta(days=240), 'Best Power (Last 360 Days)'),
                    ('allTime',  now - timedelta(days=400), 'Best Power (All Time)'),
                ]

                history = []
                rider_weight = response_data['profile'].get('weight') or 0
                rider_height = response_data['profile'].get('height') or 0

                for curve_key, entry_dt, title in range_configs:
                    curve_data = curves.get(curve_key)
                    if not curve_data:
                        continue
                    points = curve_data.get('pointsWatts') or {}
                    if not points:
                        continue

                    # Map duration keys from '5' → 'w5', '300' → 'w300', etc.
                    cp_curve = {
                        f'w{duration_sec}': point.get('value', 0)
                        for duration_sec, point in points.items()
                    }

                    history.append({
                        'date': entry_dt.strftime('%Y-%m-%dT%H:%M:%SZ'),
                        'event_title': title,
                        'avg_watts': cp_curve.get('w1200', 0),
                        'avg_hr': 0,
                        'wkg': 0,
                        'category': '',
                        'weight': rider_weight,
                        'height': rider_height,
                        'cp_curve': cp_curve,
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
