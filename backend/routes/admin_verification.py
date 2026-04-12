"""
Admin: Weight/rider verification routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from flask import request, jsonify

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


def _parse_binary_fit_url(fit_url: str, access_token: str) -> 'tuple[dict | None, str]':
    """
    Download the binary FIT file from *fit_url* and extract per-second streams.
    Returns (streams_dict, status_string).  Requires the ``fitdecode`` package.
    """
    try:
        import fitdecode  # noqa: PLC0415
    except ImportError:
        return None, 'fitdecode_not_installed'

    import io
    try:
        import requests as _req
        # S3 presigned URLs embed auth in query params — adding an Authorization
        # header causes a SignatureDoesNotMatch 403. Detect by URL content.
        if 'X-Amz-Signature' in fit_url or 'amazonaws.com' in fit_url:
            headers = {'Accept': '*/*'}
        else:
            headers = {'Authorization': f'Bearer {access_token}', 'Accept': '*/*'}
        resp = _req.get(fit_url, headers=headers, timeout=30)
        if resp.status_code != 200:
            return None, f'http_{resp.status_code}'
        raw = resp.content
    except Exception as exc:
        return None, f'download_error:{exc}'

    time_arr, watts_arr, hr_arr, cad_arr, alt_arr = [], [], [], [], []
    base_ts = None
    try:
        with fitdecode.FitReader(io.BytesIO(raw)) as fit:
            for frame in fit:
                if not isinstance(frame, fitdecode.FitDataMessage):
                    continue
                if frame.name != 'record':
                    continue
                ts = frame.get_value('timestamp')
                if ts is None:
                    continue
                # fitdecode returns datetime objects for timestamp
                try:
                    epoch = ts.timestamp()
                except AttributeError:
                    epoch = float(ts)
                if base_ts is None:
                    base_ts = epoch
                time_arr.append(int(epoch - base_ts))
                watts_arr.append(frame.get_value('power'))
                hr_arr.append(frame.get_value('heart_rate'))
                cad_arr.append(frame.get_value('cadence'))
                alt_arr.append(frame.get_value('altitude'))
    except Exception as exc:
        return None, f'parse_error:{exc}'

    if not time_arr:
        return None, 'no_records'

    return {
        'time':      time_arr,
        'watts':     watts_arr,
        'heartrate': hr_arr,
        'cadence':   cad_arr,
        'altitude':  alt_arr,
    }, f'ok_{len(time_arr)}_points'


def _parse_json_fit_streams(data: 'dict | list') -> dict:
    """
    Parse a Zwift JSON FIT response into parallel stream arrays.

    Handles three layouts:
      • Top-level list of record objects
          [{"timestamp": N, "power": W, "heart_rate": HR, "cadence": C, "altitude": A}, ...]
      • Records wrapped under a key ("records", "data", "record"):
          {"records": [...]}  /  {"messages": {"record": [...]}}
      • Parallel arrays (Strava-style):
          {"power": [...], "heart_rate": [...], "time": [...], ...}
    """
    records = None

    if isinstance(data, list):
        records = data
    elif isinstance(data, dict):
        records = (
            data.get('records') or data.get('data') or
            data.get('record') or (data.get('messages') or {}).get('record')
        )
        if records is None and ('power' in data or 'watts' in data):
            # Parallel-arrays layout
            n = len(data.get('power') or data.get('watts') or [])
            return {
                'time':      data.get('time') or list(range(n)),
                'watts':     data.get('power') or data.get('watts') or [],
                'heartrate': data.get('heart_rate') or data.get('heartrate') or data.get('hr') or [],
                'cadence':   data.get('cadence') or [],
                'altitude':  data.get('altitude') or [],
            }

    if not records:
        return {'time': [], 'watts': [], 'heartrate': [], 'cadence': [], 'altitude': []}

    time_arr, watts_arr, hr_arr, cad_arr, alt_arr = [], [], [], [], []
    base_ts = None

    for rec in records:
        if not isinstance(rec, dict):
            continue
        ts = rec.get('timestamp')
        if ts is None:
            continue
        if isinstance(ts, str):
            dt = _parse_iso_utc(ts)
            epoch = dt.timestamp() if dt else None
        elif isinstance(ts, (int, float)):
            epoch = float(ts)
        else:
            continue
        if epoch is None:
            continue
        if base_ts is None:
            base_ts = epoch
        time_arr.append(int(epoch - base_ts))
        watts_arr.append(rec.get('power') or rec.get('watts'))
        hr_arr.append(rec.get('heart_rate') or rec.get('heartrate') or rec.get('hr'))
        cad_arr.append(rec.get('cadence'))
        alt_arr.append(rec.get('altitude'))

    return {
        'time':      time_arr,
        'watts':     watts_arr,
        'heartrate': hr_arr,
        'cadence':   cad_arr,
        'altitude':  alt_arr,
    }


def _extract_zwift_activity_fields(raw: dict) -> dict:
    """
    Extract normalised fields from a Zwift activity payload.
    The /api/thirdparty/activity endpoint uses different field names from
    what we initially guessed, so we try a wide set of candidates.
    """
    # Start date — ISO string or numeric Unix timestamp (ms or s)
    # Official Zwift API field is `startDateTime`; accept legacy variants too.
    started_at = (raw.get('startDateTime') or raw.get('startedAt') or
                  raw.get('startDate') or raw.get('start_date') or
                  raw.get('started_at') or raw.get('startTime') or
                  raw.get('activityStartDate'))
    # If numeric timestamp (ms), convert to ISO
    if isinstance(started_at, (int, float)) and started_at > 1e10:
        try:
            from datetime import timezone as _tz
            started_at = datetime.fromtimestamp(started_at / 1000, tz=_tz.utc).isoformat()
        except Exception:
            started_at = None
    elif isinstance(started_at, (int, float)):
        # seconds
        try:
            from datetime import timezone as _tz
            started_at = datetime.fromtimestamp(started_at, tz=_tz.utc).isoformat()
        except Exception:
            started_at = None

    # Duration — try ms fields first (official: totalDurationInMilliSec), then seconds
    dur_ms = (raw.get('totalDurationInMilliSec') or raw.get('durationInMilliseconds') or
              raw.get('duration_in_milliseconds'))
    if not dur_ms:
        dur_sec_field = (raw.get('duration') or raw.get('durationInSeconds') or
                         raw.get('totalDurationInSeconds') or raw.get('elapsed_time'))
        if dur_sec_field:
            dur_ms = dur_sec_field * 1000

    # Name
    name = (raw.get('activityName') or raw.get('name') or
            raw.get('activity_name') or '')

    # Average power
    avg_watts = (raw.get('avgWatts') or raw.get('averagePowerInWatts') or
                 raw.get('average_watts') or raw.get('avg_watts'))

    return {
        'startedAt': started_at or None,
        'durationMs': dur_ms or 0,
        'durationSec': int(dur_ms / 1000) if dur_ms else None,
        'avgWatts': avg_watts,
        'name': name,
        'sport': raw.get('sport') or raw.get('type') or 'CYCLING',
    }


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
            .where('userId', '==', str(zwift_user_id))
            .limit(100)
            .stream()
        )

        activities = []
        for doc in docs:
            d = doc.to_dict() or {}
            raw = d.get('data') or {}
            fields = _extract_zwift_activity_fields(raw)
            activities.append({
                'activityId': d.get('activityId'),
                'startedAt': fields['startedAt'],
                'name': fields['name'] or f"Activity {d.get('activityId')}",
                'durationMs': fields['durationMs'],
                'avgWatts': fields['avgWatts'],
                'sport': fields['sport'],
            })

        # Sort newest first in Python (avoids composite Firestore index on userId+updatedAt)
        activities.sort(key=lambda a: a.get('startedAt') or '', reverse=True)
        activities = activities[:30]

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
# Dual-recording: resolve activity from Zwift event
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/verification/event-activity/<rider_id>', methods=['GET'])
def event_activity(rider_id):
    """
    Given a Zwift event ID, locate this rider's segment result in the event,
    then look for their matching Zwift activity in the webhook store.

    Query params:
      eventId  – required; any Zwift event ID (from race admin page)

    Returns:
      found, eventStartIso, subgroupLabel, riderResult {durationSec, avgWatts},
      zwiftActivity {activityId, startedAt, durationSec, avgWatts} | null
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    event_id = request.args.get('eventId')
    if not event_id:
        return jsonify({'message': 'eventId is required'}), 400

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        token_doc = get_token_doc(str(user.id))
        if not token_doc:
            return jsonify({'message': 'No Zwift connection found for this rider'}), 404

        zwift_user_id = token_doc.get('zwiftUserId')
        if not zwift_user_id:
            return jsonify({'message': 'No Zwift user ID on token'}), 404

        zwift_user_id_str = str(zwift_user_id)

        # ── 1. Fetch event info ────────────────────────────────────────────────
        zwift_service = get_zwift_service()
        event_info = zwift_service.get_event_info(str(event_id))
        if not event_info:
            return jsonify({'message': f'Event {event_id} not found'}), 404

        subgroups = event_info.get('eventSubgroups') or []
        if not subgroups:
            return jsonify({'message': 'No subgroups found for this event'}), 404

        # ── 2. Search each subgroup for the rider ──────────────────────────────
        found_subgroup = None
        found_entry = None

        for sg in subgroups:
            sg_id = str(sg.get('id', ''))
            if not sg_id:
                continue
            try:
                by_segment = zwift_service.get_subgroup_all_segment_results(sg_id)
            except Exception as exc:
                logger.warning(f"event_activity: subgroup {sg_id} fetch failed: {exc}")
                continue

            # Flatten all segment entries; prefer the one with the longest duration
            # (that's the finish line, not a sprint intermediate).
            for entries in by_segment.values():
                for entry in entries:
                    if str(entry.get('userId', '')) == zwift_user_id_str:
                        if found_entry is None or (
                            entry.get('durationInMilliseconds', 0)
                            > found_entry.get('durationInMilliseconds', 0)
                        ):
                            found_subgroup = sg
                            found_entry = entry

            if found_entry is not None:
                break  # Found the rider; no need to search further subgroups

        if not found_entry:
            return jsonify({
                'found': False,
                'message': 'Rider not found in any subgroup of this event',
            }), 200

        event_start_iso = found_subgroup.get('eventSubgroupStart') or ''
        subgroup_label = (
            found_subgroup.get('subgroupLabel')
            or found_subgroup.get('name')
            or found_subgroup.get('label', '')
        )
        duration_ms = found_entry.get('durationInMilliseconds', 0)
        duration_sec = int(duration_ms / 1000) if duration_ms else None
        avg_watts = found_entry.get('avgWatts')

        # ── 3. Find the Zwift activity ─────────────────────────────────────────
        zwift_activity = None
        access_token = get_valid_access_token(str(user.id), get_zwift_service())

        # 3a. Try activityId from segment result (live API may include it)
        candidate_id = (found_entry.get('activityId') or found_entry.get('id'))
        if candidate_id and access_token:
            try:
                act_data = get_zwift_service().get_user_activity(
                    str(candidate_id), access_token
                )
                if act_data:
                    af = _extract_zwift_activity_fields(act_data)
                    zwift_activity = {
                        'activityId': str(candidate_id),
                        'startedAt': af['startedAt'],
                        'durationSec': af['durationSec'],
                        'avgWatts': af['avgWatts'],
                    }
            except Exception as exc:
                logger.debug(f"event_activity: segment entry id {candidate_id} not a valid activity: {exc}")

        # 3b. Search webhook store by event start time (no composite index — sort in Python)
        event_dt = _parse_iso_utc(event_start_iso) if event_start_iso else None
        if not zwift_activity and event_dt and db:
            docs = (
                db.collection('zwift_activities')
                .where('userId', '==', zwift_user_id_str)
                .limit(100)
                .stream()
            )
            best_delta = float('inf')
            for doc in docs:
                d = doc.to_dict() or {}
                raw = d.get('data') or {}
                wf = _extract_zwift_activity_fields(raw)
                act_dt = _parse_iso_utc(wf['startedAt']) if wf['startedAt'] else None
                if act_dt:
                    delta = abs((act_dt - event_dt).total_seconds())
                    if delta < best_delta and delta < 7200:  # within 2 hours
                        best_delta = delta
                        zwift_activity = {
                            'activityId': d.get('activityId'),
                            'startedAt': wf['startedAt'],
                            'durationSec': wf['durationSec'],
                            'avgWatts': wf['avgWatts'],
                        }

        return jsonify({
            'found': True,
            'eventStartIso': event_start_iso,
            'subgroupLabel': subgroup_label,
            'riderResult': {
                'durationSec': duration_sec,
                'avgWatts': avg_watts,
            },
            'zwiftActivity': zwift_activity,
        }), 200

    except Exception as e:
        logger.error(f"event_activity error: {e}")
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
    event_start_iso = request.args.get('eventStartIso')  # fallback anchor for Strava matching

    if not zwift_activity_id:
        return jsonify({'message': 'zwiftActivityId is required'}), 400

    try:
        user = UserService.get_user_by_id(rider_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        # Fetch token early — needed for both Firestore fallback and CP curve.
        access_token = get_valid_access_token(str(user.id), get_zwift_service())

        # ── 1. Fetch Zwift activity metadata (webhook store → Zwift API) ──────
        zwift_doc = db.collection('zwift_activities').document(str(zwift_activity_id)).get()
        zwift_raw = {}
        if zwift_doc.exists:
            zwift_stored = zwift_doc.to_dict() or {}
            zwift_raw = zwift_stored.get('data') or {}
        elif access_token:
            api_data = get_zwift_service().get_user_activity(
                str(zwift_activity_id), access_token
            )
            if api_data:
                zwift_raw = api_data
            else:
                return jsonify({'message': 'Zwift activity not found in database or via API.'}), 404
        else:
            return jsonify({'message': 'Zwift activity not found and no Zwift token available.'}), 404

        zf = _extract_zwift_activity_fields(zwift_raw)
        zwift_started_at = zf['startedAt']
        zwift_duration_sec = zf['durationSec']
        zwift_avg_watts = zf['avgWatts']

        # ── 1b. Fetch Zwift FIT streams ───────────────────────────────────────
        # jsonFitFileUrl (webhook key, lowercase) is a non-expiring API URL —
        # use directly from zwift_raw.  fitFileURL is a presigned S3 URL
        # (expires in ~3 h) so we fetch a fresh copy from the API.
        zwift_streams = None
        zwift_debug = {'fitFileURL': None, 'jsonFitFileURL': None,
                       'fitFetchStatus': None, 'parsedPoints': 0,
                       'activityKeys': list(zwift_raw.keys())}
        if access_token:
            try:
                # Zwift webhook stores the key as 'jsonFitFileUrl' (lowercase u);
                # thirdparty API may use 'jsonFitFileURL' (uppercase) — check both.
                json_fit_url = (zwift_raw.get('jsonFitFileUrl') or
                                zwift_raw.get('jsonFitFileURL'))

                # For fitFileURL, fetch fresh to get a non-expired presigned URL.
                fresh = get_zwift_service().get_user_activity(
                    str(zwift_activity_id), access_token
                ) or {}
                fit_file_url = fresh.get('fitFileURL')
                # Also pick up jsonFit from fresh response if not in stored data
                if not json_fit_url:
                    json_fit_url = (fresh.get('jsonFitFileURL') or
                                    fresh.get('jsonFitFileUrl'))
                    zwift_debug['activityKeys'] = list(fresh.keys())

                zwift_debug['jsonFitFileURL'] = json_fit_url
                zwift_debug['fitFileURL'] = fit_file_url
                logger.info(
                    "dual_recording: stored keys=%s fitFileURL=%s jsonFitFileURL=%s",
                    list(zwift_raw.keys()), fit_file_url or 'NONE', json_fit_url or 'NONE',
                )
                # Prefer JSON FIT; fall back to binary FIT (parsed with fitdecode)
                if json_fit_url:
                    fit_resp = get_zwift_service().get_activity_json_fit(
                        json_fit_url, access_token
                    )
                    zwift_debug['fitFetchStatus'] = 'json_ok' if fit_resp is not None else 'json_empty'
                    if fit_resp:
                        # Capture top-level structure for debugging unknown formats
                        if isinstance(fit_resp, dict):
                            zwift_debug['jsonFitStructure'] = {
                                'type': 'dict',
                                'keys': list(fit_resp.keys())[:20],
                            }
                        elif isinstance(fit_resp, list):
                            first = fit_resp[0] if fit_resp else None
                            zwift_debug['jsonFitStructure'] = {
                                'type': 'list',
                                'length': len(fit_resp),
                                'firstItemKeys': list(first.keys())[:20] if isinstance(first, dict) else str(type(first)),
                            }
                        zwift_streams = _parse_json_fit_streams(fit_resp)
                        n = len((zwift_streams or {}).get('time') or [])
                        zwift_debug['parsedPoints'] = n

                # Fall back to binary FIT if JSON FIT yielded no usable data
                if zwift_debug['parsedPoints'] == 0 and fit_file_url:
                    bin_streams, bin_status = _parse_binary_fit_url(fit_file_url, access_token)
                    bin_n = len((bin_streams or {}).get('time') or [])
                    zwift_debug['binaryFitStatus'] = bin_status
                    zwift_debug['binaryFitPoints'] = bin_n
                    if bin_n > 0:
                        zwift_streams = bin_streams
                        zwift_debug['parsedPoints'] = bin_n
                elif fit_file_url is None and json_fit_url is None:
                    zwift_debug['fitFetchStatus'] = 'no_url'
            except Exception as e:
                zwift_debug['fitFetchStatus'] = str(e)
                logger.warning("Could not fetch Zwift FIT streams: %s", e)

        # ── 2. Fetch Zwift CP curve for this activity ─────────────────────────
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
        else:
            # Anchor on Zwift start time; fall back to the event start time if unavailable.
            anchor_iso = zwift_started_at or event_start_iso
            zwift_dt = _parse_iso_utc(anchor_iso) if anchor_iso else None
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
                    'streams': zwift_streams,
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

        # ── 5. Convert both streams to race-relative time via absolute timestamps ─
        # Zwift stream t[i]  = seconds since zwift_startedAt
        # Strava stream t[i] = seconds since strava_startedAt
        # Both have absolute UTC anchors in their startedAt fields, so we can
        # compute race-relative time without any guesswork:
        #   race_t = (startedAt + stream_t) - race_anchor
        # where race_anchor = eventStartIso (if provided) else min(z_dt, s_dt).
        strava_started_at = (matched_strava or {}).get('startDate', '')

        z_dt = _parse_iso_utc(zwift_started_at) if zwift_started_at else None
        s_dt = _parse_iso_utc(strava_started_at) if strava_started_at else None

        # Choose race anchor (t=0 on the chart)
        if event_start_iso:
            race_anchor = _parse_iso_utc(event_start_iso) or z_dt or s_dt
        elif z_dt and s_dt:
            race_anchor = min(z_dt, s_dt)
        else:
            race_anchor = z_dt or s_dt

        # Seconds from race_anchor to each activity's start (may be negative
        # if the activity started before the race anchor).
        zwift_base = int((z_dt - race_anchor).total_seconds()) if (z_dt and race_anchor) else 0
        strava_base = int((s_dt - race_anchor).total_seconds()) if (s_dt and race_anchor) else 0

        # ── 6. Normalise Zwift stream & trim Strava to race window ────────────
        # Zwift: shift raw t so t=0 is race_anchor (pre-race warmup → t < 0).
        if zwift_streams and zwift_base != 0 and zwift_streams.get('time'):
            zwift_streams = {
                **zwift_streams,
                'time': [t + zwift_base for t in zwift_streams['time']],
            }

        # Strava: convert to race-relative time, then keep only the race window.
        # strava_base may be positive (Strava started before race anchor)
        # or negative (Strava started after race anchor — missing early seconds).
        s_race_times = [strava_base + t for t in s_times] if s_times else []

        win_start = 0
        win_end   = zwift_duration_sec or 0

        if s_race_times and zwift_duration_sec:
            mask = [win_start <= t <= win_end for t in s_race_times]
            t_trimmed   = [t for t, m in zip(s_race_times, mask) if m]
            w_trimmed   = [v for v, m in zip(s_watts or [], mask) if m]
            cad_trimmed = [v for v, m in zip(s_cadence or [], mask) if m]
            hr_trimmed  = [v for v, m in zip(s_hr or [], mask) if m]
            alt_trimmed = [v for v, m in zip(s_alt or [], mask) if m]
        else:
            t_trimmed   = list(s_race_times)
            w_trimmed   = list(s_watts) if s_watts else []
            cad_trimmed = list(s_cadence) if s_cadence else []
            hr_trimmed  = list(s_hr) if s_hr else []
            alt_trimmed = list(s_alt) if s_alt else []

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
                'streams': zwift_streams,
                '_debug': zwift_debug,
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
                    'time':      t_trimmed,
                    'watts':     w_trimmed,
                    'cadence':   cad_trimmed,
                    'heartrate': hr_trimmed,
                    'altitude':  alt_trimmed,
                },
            },
            'sync': {
                'zwiftBase': zwift_base,
                'stravaBase': strava_base,
                'zwiftDurationSec': zwift_duration_sec,
                'anchoredByEventStart': event_start_iso is not None,
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
