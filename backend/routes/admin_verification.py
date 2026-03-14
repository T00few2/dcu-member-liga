"""
Admin: Weight/rider verification routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from concurrent.futures import ThreadPoolExecutor

from flask import request, jsonify

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db, get_zwift_service, strava_service, get_zp_service
from services.user_service import UserService

import logging

logger = logging.getLogger(__name__)


def _parse_zp_numeric(value) -> float:
    """Coerce a ZwiftPower field (may be a single-element list) to float."""
    if isinstance(value, list):
        return float(value[0]) if value else 0.0
    return float(value) if value else 0.0


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
            return get_zwift_service().get_profile(int(zwift_id))

        def fetch_strava():
            if not strava_auth or not zwift_id:
                return None
            return strava_service.get_activities(zwift_id)

        def fetch_zp():
            if not zwift_id:
                return None
            return get_zp_service().get_rider_data_json(int(zwift_id))

        with ThreadPoolExecutor(max_workers=3) as executor:
            f_profile = executor.submit(fetch_zwift_profile)
            f_strava = executor.submit(fetch_strava)
            f_zp = executor.submit(fetch_zp)

        try:
            profile = f_profile.result(timeout=30)
            if profile:
                response_data['profile'] = {
                    'weight': round(profile.get('weight', 0) / 1000, 1) if profile.get('weight') else None,
                    'height': round(profile.get('height', 0) / 10, 0) if profile.get('height') else None,
                    'maxHr': profile.get('heartRateMax', 0),
                    'img': profile.get('imageSrc'),
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
            zp_json = f_zp.result(timeout=30)
            if zp_json and 'data' in zp_json:
                _CP_DURATIONS = ['w5', 'w15', 'w30', 'w60', 'w120', 'w300', 'w1200']
                history = []
                for entry in zp_json['data']:
                    cp_curve = {}
                    for dur in _CP_DURATIONS:
                        val = entry.get(dur)
                        try:
                            cp_curve[dur] = int(float(val[0] if isinstance(val, list) and val else val)) if val else 0
                        except (ValueError, TypeError):
                            cp_curve[dur] = 0

                    wkg_raw = entry.get('avg_wkg')
                    wkg_val = float((wkg_raw[0] if isinstance(wkg_raw, list) and wkg_raw else wkg_raw) or 0)

                    history.append({
                        'date': entry.get('event_date', 0),
                        'event_title': entry.get('event_title', 'Unknown Event'),
                        'avg_watts': _parse_zp_numeric(entry.get('avg_power')),
                        'avg_hr': _parse_zp_numeric(entry.get('avg_hr')),
                        'wkg': wkg_val,
                        'category': entry.get('category', ''),
                        'weight': _parse_zp_numeric(entry.get('weight')),
                        'height': _parse_zp_numeric(entry.get('height')),
                        'cp_curve': cp_curve,
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
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    e_license = request.args.get('eLicense')
    if not e_license:
        return jsonify({'message': 'Missing eLicense'}), 400

    try:
        user = UserService.get_user_by_elicense(e_license)
        if not user or not user.zwift_id:
            return jsonify({'message': 'User not found'}), 404
        streams = strava_service.get_activity_streams(user.zwift_id, activity_id)
        if streams:
            return jsonify({'streams': streams}), 200
        return jsonify({'message': 'Failed to fetch streams'}), 404
    except Exception as e:
        return jsonify({'message': str(e)}), 500
