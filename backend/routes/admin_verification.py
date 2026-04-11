"""
Admin: Weight/rider verification routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from flask import request, jsonify
from google.cloud.firestore_v1.base_query import FieldFilter

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db, get_zwift_service, strava_service
from services.user_service import UserService
from services.zwift_tokens import get_valid_access_token, get_token_doc

import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Dual-recording helpers (pure Python, no numpy required)
# ---------------------------------------------------------------------------

def _extract_stream(streams, stream_type):
    """Return the data array for a named stream from a Strava stream list."""
    for s in (streams or []):
        if s.get('type') == stream_type:
            return s.get('data') or []
    return []


def _resample_to_1hz(times: list, values: list) -> list:
    """
    Linearly interpolate (time, value) pairs onto an integer-second grid
    0 .. int(times[-1]).  Returns a list of floats indexed by second.
    """
    if not times or not values:
        return []
    max_t = int(times[-1])
    result = [0.0] * (max_t + 1)
    n = len(times)
    src = 0
    for t in range(max_t + 1):
        while src + 1 < n and times[src + 1] <= t:
            src += 1
        if src + 1 >= n:
            result[t] = float(values[src])
        else:
            t0, t1 = float(times[src]), float(times[src + 1])
            if t1 == t0:
                result[t] = float(values[src])
            else:
                alpha = (t - t0) / (t1 - t0)
                result[t] = float(values[src]) * (1 - alpha) + float(values[src + 1]) * alpha
    return result


def _compute_best_efforts(w_1hz: list, durations=(5, 15, 30, 60, 120, 300, 1200)) -> dict:
    """
    Rolling-window best average power at each duration.
    w_1hz must already be at 1-second resolution (output of _resample_to_1hz).
    """
    n = len(w_1hz)
    result = {}
    for d in durations:
        if d > n:
            continue
        win = sum(w_1hz[:d])
        best = win
        for i in range(d, n):
            win += w_1hz[i] - w_1hz[i - d]
            if win > best:
                best = win
        result[f'w{d}'] = round(best / d, 1)
    return result


def _parse_iso_utc(iso_str: str) -> datetime | None:
    """Parse an ISO-8601 string into a UTC-aware datetime, tolerating Z suffix."""
    if not iso_str:
        return None
    try:
        clean = iso_str.rstrip('Z').split('+')[0]
        return datetime.fromisoformat(clean).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _build_cp_comparison(zwift_curve: dict, strava_curve: dict) -> list:
    """
    Return a list of per-duration comparison dicts.
    """
    LABELS = [
        ('w5', '5s'), ('w15', '15s'), ('w30', '30s'),
        ('w60', '1m'), ('w120', '2m'), ('w300', '5m'), ('w1200', '20m'),
    ]
    rows = []
    for key, label in LABELS:
        z = zwift_curve.get(key)
        s = strava_curve.get(key)
        if z is None and s is None:
            continue
        diff_w = round((z or 0) - (s or 0), 1)
        diff_pct = round(diff_w / s * 100, 1) if s else None
        rows.append({'label': label, 'key': key,
                     'zwift': z, 'strava': s,
                     'diffW': diff_w, 'diffPct': diff_pct})
    return rows


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


# ---------------------------------------------------------------------------
# Dual-recording: list activities
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/verification/zwift-activities/<rider_id>', methods=['GET'])
def list_zwift_activities(rider_id):
    """Return recent Zwift activities stored via webhook for this rider."""
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

        token_doc = get_token_doc(str(user.id))
        if not token_doc:
            return jsonify({'activities': [], 'message': 'No Zwift connection found'}), 200

        zwift_user_id = token_doc.get('zwiftUserId')
        if not zwift_user_id:
            return jsonify({'activities': [], 'message': 'No Zwift user ID on token'}), 200

        docs = (
            db.collection('zwift_activities')
            .where(filter=FieldFilter('userId', '==', str(zwift_user_id)))
            .order_by('updatedAt', direction='DESCENDING')
            .limit(30)
            .stream()
        )

        activities = []
        for doc in docs:
            d = doc.to_dict() or {}
            raw = d.get('data') or {}
            activities.append({
                'activityId': d.get('activityId'),
                'startedAt': (raw.get('startedAt') or raw.get('startDate')
                              or raw.get('start_date') or raw.get('date')),
                'name': raw.get('name', f"Activity {d.get('activityId')}"),
                'durationMs': (raw.get('durationInMilliseconds')
                               or raw.get('duration_in_milliseconds', 0)),
                'avgWatts': (raw.get('avgWatts') or raw.get('averagePowerInWatts')
                             or raw.get('average_watts')),
                'sport': raw.get('sport', raw.get('type', 'CYCLING')),
            })

        return jsonify({'activities': activities}), 200

    except Exception as e:
        logger.error(f"list_zwift_activities error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/verification/strava-activities/<rider_id>', methods=['GET'])
def list_strava_activities(rider_id):
    """Return recent Strava activities with full timestamps for matching."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        activities = strava_service.get_activities_for_matching(str(user.id))
        return jsonify({'activities': activities}), 200

    except Exception as e:
        logger.error(f"list_strava_activities error: {e}")
        return jsonify({'message': str(e)}), 500


# ---------------------------------------------------------------------------
# Dual-recording: main comparison endpoint
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/verification/dual-recording/<rider_id>', methods=['GET'])
def dual_recording(rider_id):
    """
    Fetch and compare the Zwift (primary) and Strava (secondary) recordings
    for a specific activity.

    Query params:
      zwiftActivityId  – required
      stravaActivityId – optional; auto-matched by timestamp if omitted
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    zwift_activity_id = request.args.get('zwiftActivityId')
    strava_activity_id = request.args.get('stravaActivityId')

    if not zwift_activity_id:
        return jsonify({'message': 'zwiftActivityId is required'}), 400

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        # ── 1. Fetch Zwift activity metadata from Firestore ──────────────────
        zwift_doc = db.collection('zwift_activities').document(str(zwift_activity_id)).get()
        if not zwift_doc.exists:
            return jsonify({'message': 'Zwift activity not found in database. '
                                       'It may not have been captured via webhook yet.'}), 404

        zwift_stored = zwift_doc.to_dict() or {}
        zwift_raw = zwift_stored.get('data') or {}

        zwift_started_at = (zwift_raw.get('startedAt') or zwift_raw.get('startDate')
                            or zwift_raw.get('start_date'))
        zwift_duration_ms = (zwift_raw.get('durationInMilliseconds')
                             or zwift_raw.get('duration_in_milliseconds') or 0)
        zwift_duration_sec = int(zwift_duration_ms / 1000) if zwift_duration_ms else None
        zwift_avg_watts = (zwift_raw.get('avgWatts') or zwift_raw.get('averagePowerInWatts')
                           or zwift_raw.get('average_watts'))

        # ── 2. Fetch Zwift CP curve for this activity ─────────────────────────
        access_token = get_valid_access_token(str(user.id), get_zwift_service())
        zwift_cp_curve = {}
        if access_token:
            try:
                curve_data = get_zwift_service().get_best_power_curve_activity(
                    access_token, str(zwift_activity_id)
                )
                points = (curve_data or {}).get('pointsWatts') or {}
                zwift_cp_curve = {
                    f'w{dur}': pt.get('value', 0)
                    for dur, pt in points.items()
                }
            except Exception as e:
                logger.error(f"Zwift CP curve fetch error: {e}")

        # ── 3. Auto-match Strava activity if not specified ────────────────────
        strava_activities = strava_service.get_activities_for_matching(str(user.id))
        matched_strava = None

        if strava_activity_id:
            matched_strava = next(
                (a for a in strava_activities if str(a['id']) == str(strava_activity_id)), None
            )
        elif zwift_started_at:
            zwift_dt = _parse_iso_utc(zwift_started_at)
            if zwift_dt:
                closest, min_delta = None, float('inf')
                for act in strava_activities:
                    act_dt = _parse_iso_utc(act.get('startDate', ''))
                    if act_dt:
                        delta = abs((act_dt - zwift_dt).total_seconds())
                        if delta < min_delta:
                            min_delta = delta
                            closest = act
                # Accept matches within 4 hours
                if closest and min_delta < 4 * 3600:
                    matched_strava = closest
                    strava_activity_id = str(matched_strava['id'])

        if not matched_strava and not strava_activity_id:
            # Return what we have from Zwift with a warning
            return jsonify({
                'zwift': {
                    'activityId': zwift_activity_id,
                    'startedAt': zwift_started_at,
                    'durationSec': zwift_duration_sec,
                    'avgWatts': zwift_avg_watts,
                    'cpCurve': zwift_cp_curve,
                },
                'strava': None,
                'sync': None,
                'comparison': None,
                'warning': 'No matching Strava activity found within 4 hours of the Zwift activity.',
            }), 200

        # ── 4. Fetch Strava streams ────────────────────────────────────────────
        raw_streams = strava_service.get_activity_streams(str(user.id), strava_activity_id)
        s_times   = _extract_stream(raw_streams, 'time')
        s_watts   = _extract_stream(raw_streams, 'watts')
        s_cadence = _extract_stream(raw_streams, 'cadence')
        s_hr      = _extract_stream(raw_streams, 'heartrate')
        s_alt     = _extract_stream(raw_streams, 'altitude')

        # ── 5. Compute time offset (seconds into Strava recording where race begins)
        strava_started_at = (matched_strava or {}).get('startDate', '')
        offset_sec = 0
        if zwift_started_at and strava_started_at:
            z_dt = _parse_iso_utc(zwift_started_at)
            s_dt = _parse_iso_utc(strava_started_at)
            if z_dt and s_dt:
                # positive = Strava started earlier (common: Garmin on before the race)
                offset_sec = int((z_dt - s_dt).total_seconds())

        # ── 6. Trim Strava streams to Zwift race window ───────────────────────
        if s_times and zwift_duration_sec:
            # Find indices for the race window
            win_start = max(0, offset_sec)
            win_end   = win_start + zwift_duration_sec

            def trim(vals, reference_times):
                return [
                    v for t, v in zip(reference_times, vals)
                    if win_start <= t <= win_end
                ]

            t_trimmed = [t - win_start for t in s_times if win_start <= t <= win_end]
            w_trimmed = trim(s_watts, s_times) if s_watts else []
        else:
            t_trimmed = list(s_times)
            w_trimmed = list(s_watts) if s_watts else []

        # ── 7. Compute Strava CP curves ───────────────────────────────────────
        strava_w_full   = _resample_to_1hz(s_times, s_watts) if s_watts else []
        strava_w_synced = _resample_to_1hz(t_trimmed, w_trimmed) if w_trimmed else []

        durations = (5, 15, 30, 60, 120, 300, 1200)
        strava_cp_raw    = _compute_best_efforts(strava_w_full,   durations)
        strava_cp_synced = _compute_best_efforts(strava_w_synced, durations)

        strava_avg_synced = (
            round(sum(strava_w_synced) / len(strava_w_synced), 1)
            if strava_w_synced else None
        )

        # ── 8. Build comparison ───────────────────────────────────────────────
        cp_diff = _build_cp_comparison(zwift_cp_curve, strava_cp_synced)

        zwift_avg  = zwift_avg_watts
        strava_avg = strava_avg_synced
        avg_diff_w   = round((zwift_avg or 0) - (strava_avg or 0), 1) if (zwift_avg and strava_avg) else None
        avg_diff_pct = round(avg_diff_w / strava_avg * 100, 1) if (avg_diff_w is not None and strava_avg) else None

        return jsonify({
            'zwift': {
                'activityId': zwift_activity_id,
                'startedAt': zwift_started_at,
                'durationSec': zwift_duration_sec,
                'avgWatts': zwift_avg_watts,
                'cpCurve': zwift_cp_curve,
            },
            'strava': {
                'activityId': int(strava_activity_id) if strava_activity_id else None,
                'name': (matched_strava or {}).get('name', ''),
                'startedAt': strava_started_at,
                'durationSec': (matched_strava or {}).get('durationSec'),
                'avgWattsRaw': (matched_strava or {}).get('averageWatts'),
                'avgWattsSynced': strava_avg_synced,
                'cpCurveRaw': strava_cp_raw,
                'cpCurveSynced': strava_cp_synced,
                'streams': {
                    'time':     s_times,
                    'watts':    s_watts,
                    'cadence':  s_cadence,
                    'heartrate': s_hr,
                    'altitude': s_alt,
                },
            },
            'sync': {
                'offsetSec': offset_sec,
                'zwiftDurationSec': zwift_duration_sec,
                'stravaWindowStart': max(0, offset_sec),
                'stravaWindowEnd': max(0, offset_sec) + (zwift_duration_sec or 0),
            },
            'comparison': {
                'cpDiff': cp_diff,
                'avgPower': {
                    'zwift': zwift_avg,
                    'strava': strava_avg,
                    'diffW': avg_diff_w,
                    'diffPct': avg_diff_pct,
                },
            },
        }), 200

    except Exception as e:
        logger.error(f"dual_recording error: {e}")
        return jsonify({'message': str(e)}), 500
