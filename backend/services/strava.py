import requests
import time
from datetime import datetime
from config import STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, BACKEND_URL, STRAVA_SERVICE_REFRESH_TOKEN
from firebase_admin import firestore

import logging

logger = logging.getLogger(__name__)

class StravaService:
    def __init__(self, db):
        self.db = db
        self._service_access_token = None
        self._service_token_expiry = 0

    def _resolve_doc_id(self, rider_id):
        """Return the canonical users/ document ID for a rider."""
        return str(rider_id)

    def _token_ref(self, doc_id):
        return self.db.collection('strava_tokens').document(str(doc_id))

    def _write_tokens(self, doc_id, token_data):
        """Persist tokens to the dedicated strava_tokens collection."""
        self._token_ref(doc_id).set({
            'access_token': token_data['access_token'],
            'refresh_token': token_data['refresh_token'],
            'expires_at': token_data['expires_at'],
        }, merge=True)

    def _refresh_token(self, rider_id, refresh_token):
        token_url = "https://www.strava.com/oauth/token"
        payload = {
            'client_id': STRAVA_CLIENT_ID,
            'client_secret': STRAVA_CLIENT_SECRET,
            'grant_type': 'refresh_token',
            'refresh_token': refresh_token
        }

        try:
            res = requests.post(token_url, data=payload)
            data = res.json()

            if res.status_code != 200:
                logger.error(f"Failed to refresh token: HTTP {res.status_code}")
                return None

            if self.db:
                doc_id = self._resolve_doc_id(rider_id)
                self._write_tokens(doc_id, data)

            return data['access_token']
        except Exception as e:
            logger.error(f"Error refreshing token: {e}")
            return None

    def build_authorize_url(self, state):
        redirect_uri = f"{BACKEND_URL}/strava/callback"
        scope = "read,activity:read_all" 
        
        strava_url = (
            f"https://www.strava.com/oauth/authorize"
            f"?client_id={STRAVA_CLIENT_ID}"
            f"&response_type=code"
            f"&redirect_uri={redirect_uri}"
            f"&approval_prompt=force"
            f"&scope={scope}"
            f"&state={state}" 
        )
        return strava_url

    def exchange_code_for_tokens(self, code):
        token_url = "https://www.strava.com/oauth/token"
        payload = {
            'client_id': STRAVA_CLIENT_ID,
            'client_secret': STRAVA_CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code'
        }
        res = requests.post(token_url, data=payload)
        data = res.json()
        return res.status_code, data

    def deauthorize(self, access_token):
        if not access_token:
            return False
        try:
            res = requests.post(
                "https://www.strava.com/oauth/deauthorize",
                data={'access_token': access_token}
            )
            return res.status_code == 200
        except Exception as e:
            logger.error(f"Error deauthorizing Strava token: {e}")
            return False

    def _get_valid_token(self, rider_id):
        if not rider_id or not self.db:
            return None

        try:
            doc_id = self._resolve_doc_id(rider_id)

            token_doc = self._token_ref(doc_id).get()
            if not token_doc.exists:
                # Token may be stored under authUid if the rider connected Strava
                # before the auth_mappings entry was created (older registrations).
                # Look up authUid from the user document and try that key.
                try:
                    user_ref = self.db.collection('users').document(doc_id).get()
                    if user_ref.exists:
                        auth_uid = (user_ref.to_dict() or {}).get('authUid')
                        if auth_uid:
                            token_doc = self._token_ref(auth_uid).get()
                except Exception as e:
                    logger.warning(f"Strava token uid fallback failed for {rider_id}: {e}")

            if token_doc.exists:
                strava_auth = token_doc.to_dict()
            else:
                return None

            if not strava_auth:
                return None

            access_token = strava_auth.get('access_token')
            refresh_token = strava_auth.get('refresh_token')
            expires_at = strava_auth.get('expires_at')

            # Check expiry (add buffer of 5 minutes)
            if expires_at and time.time() > (expires_at - 300):
                logger.info(f"Token expired for {rider_id}, refreshing...")
                new_token = self._refresh_token(rider_id, refresh_token)
                if new_token:
                    return new_token
                return None

            return access_token
        except Exception as e:
            logger.error(f"Error getting valid token: {e}")
            return None

    def get_activities(self, rider_id):
        strava_kms = "Not Connected"
        recent_activities = []
        
        access_token = self._get_valid_token(rider_id)
        
        if access_token:
            try:
                acts_res = requests.get(
                    "https://www.strava.com/api/v3/athlete/activities?per_page=10",
                    headers={'Authorization': f"Bearer {access_token}"}
                )
                
                if acts_res.status_code == 200:
                    activities = acts_res.json()
                    total_meters = sum(a['distance'] for a in activities)
                    strava_kms = f"{round(total_meters / 1000, 1)} km (Last 10 rides)"
                    
                    for a in activities:
                        recent_activities.append({
                            'id': a['id'],
                            'name': a['name'],
                            'distance': f"{round(a['distance'] / 1000, 2)} km",
                            'date': a['start_date_local'][:10], 
                            'moving_time': f"{round(a['moving_time'] / 60)} min" if a['moving_time'] else "0 min",
                            'average_watts': a.get('average_watts'),
                            'average_heartrate': a.get('average_heartrate'),
                            'suffer_score': a.get('suffer_score')
                        })
                else:
                    strava_kms = "Error fetching"
            except Exception as e:
                logger.error(f"Error fetching strava stats: {e}")
                
        return {
            'kms': strava_kms,
            'activities': recent_activities
        }

    def get_activity_streams(
        self,
        rider_id,
        activity_id,
        keys='time,watts,cadence,heartrate,altitude',
        resolution='high',
        series_type='time',
    ):
        """Fetch activity streams. Pass resolution=None for the raw, un-downsampled stream.

        Strava caps a 'high' resolution stream at 10,000 points, so rides longer than
        ~2h47m come back time-averaged — which flattens short peaks. Callers that need
        exact peak power (the power curve) must ask for the full stream.
        """
        access_token = self._get_valid_token(rider_id)
        if not access_token:
            return None

        try:
            url = f"https://www.strava.com/api/v3/activities/{activity_id}/streams"
            params = {'keys': keys}
            if resolution:
                params['resolution'] = resolution
                params['series_type'] = series_type
            res = requests.get(
                url,
                params=params,
                headers={'Authorization': f"Bearer {access_token}"},
            )

            if res.status_code == 200:
                return res.json()
            else:
                logger.error(f"Error fetching streams: {res.status_code} {res.text}")
                return None
        except Exception as e:
            logger.error(f"Error fetching streams: {e}")
            return None

    def _get_service_token(self):
        """Get a service-level Strava access token for fetching public data (e.g. segment streams)."""
        if self._service_access_token and time.time() < self._service_token_expiry:
            return self._service_access_token

        # Prefer the refresh token stored in Firestore (handles rotation), fall back to env
        refresh_token = None
        if self.db:
            try:
                doc = self.db.collection('system').document('strava_service_token').get()
                if doc.exists:
                    refresh_token = doc.to_dict().get('refresh_token')
            except Exception as e:
                logger.warning(f"Could not read service token from Firestore: {e}")

        if not refresh_token:
            refresh_token = STRAVA_SERVICE_REFRESH_TOKEN

        # Last resort: borrow any connected user's refresh token — segment streams
        # are public data, so any authenticated Strava user can fetch them.
        if not refresh_token and self.db:
            try:
                docs = self.db.collection('strava_tokens').limit(1).stream()
                for doc in docs:
                    refresh_token = doc.to_dict().get('refresh_token')
                    break
            except Exception as e:
                logger.warning(f"Could not find fallback user token: {e}")

        if not refresh_token:
            logger.warning("No Strava token available for segment stream fetch.")
            return None

        try:
            res = requests.post('https://www.strava.com/oauth/token', data={
                'client_id': STRAVA_CLIENT_ID,
                'client_secret': STRAVA_CLIENT_SECRET,
                'grant_type': 'refresh_token',
                'refresh_token': refresh_token,
            })
            data = res.json()
            if res.status_code != 200:
                logger.error(f"Service token refresh failed: {res.status_code} {data}")
                return None

            self._service_access_token = data['access_token']
            self._service_token_expiry = data['expires_at'] - 300

            # Persist the (possibly rotated) refresh token back to Firestore
            if self.db:
                try:
                    self.db.collection('system').document('strava_service_token').set({
                        'refresh_token': data['refresh_token'],
                        'expires_at': data['expires_at'],
                    }, merge=True)
                except Exception as e:
                    logger.warning(f"Could not persist rotated service token: {e}")

            return self._service_access_token
        except Exception as e:
            logger.error(f"Error obtaining service token: {e}")
            return None

    def get_activities_for_matching(self, rider_id, per_page=30):
        """
        Return recent activities with full UTC timestamps and raw numeric fields,
        used for auto-matching a Strava activity to a Zwift activity.
        """
        access_token = self._get_valid_token(rider_id)
        if not access_token:
            return []
        try:
            res = requests.get(
                f"https://www.strava.com/api/v3/athlete/activities?per_page={per_page}",
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=15,
            )
            if res.status_code != 200:
                logger.error(f"Strava activities-for-matching failed: {res.status_code}")
                return []
            return [
                {
                    'id': a['id'],
                    'name': a['name'],
                    'startDate': a['start_date'],          # UTC ISO-8601
                    'startDateLocal': a['start_date_local'],
                    'durationSec': a.get('elapsed_time', 0),
                    'movingTimeSec': a.get('moving_time', 0),
                    'averageWatts': a.get('average_watts'),
                    'averageHeartrate': a.get('average_heartrate'),
                    'distanceM': a.get('distance', 0),
                    'sport': a.get('sport_type', a.get('type', 'Ride')),
                    'hasPowerMeter': bool(a.get('device_watts', False)),
                }
                for a in res.json()
            ]
        except Exception as e:
            logger.error(f"Error fetching Strava activities for matching: {e}")
            return []

    #: Strava sport types whose watts belong on a cycling power curve. Running power
    #: (from a footpod or watch) also reports device_watts=True, but it is produced by
    #: a different activity entirely and is not comparable to bike watts — a 20-minute
    #: 5K would otherwise register as a 20-minute cycling best effort. E-bikes and
    #: handcycles are excluded for the same reason: the watts are not leg power on a bike.
    CYCLING_SPORT_TYPES = frozenset({
        'Ride',
        'VirtualRide',
        'GravelRide',
        'MountainBikeRide',
    })

    @classmethod
    def _is_cycling_activity(cls, activity: dict) -> bool:
        """True when the activity's sport type belongs on a cycling power curve."""
        sport = activity.get('sport_type') or activity.get('type')
        return sport in cls.CYCLING_SPORT_TYPES

    @staticmethod
    def _activity_start_epoch(activity: dict) -> int | None:
        """Unix seconds for a summary activity's UTC start, or None if unparseable."""
        raw = activity.get('start_date') or ''
        try:
            return int(datetime.fromisoformat(raw.replace('Z', '+00:00')).timestamp())
        except (AttributeError, ValueError):
            return None

    def get_power_activities(self, rider_id: str, after_timestamp: int, max_activities: int = 50) -> list:
        """Return the most recent cycling activities with power since `after_timestamp`.

        Two filters, both required. `device_watts` drops rides whose watts Strava
        estimated rather than measured. The sport-type filter drops everything that is
        not cycling: a run recorded with running power also reports device_watts=True,
        and merging those watts into a cycling curve inflates it badly — a 21-minute
        5K at 430W lands squarely on the 20-minute best effort.

        Walks the activity list newest-first using `before` as a cursor. Strava returns
        activities oldest-first whenever `after` is supplied, so a single `after` page
        would hand back the *start* of the window and silently drop everything recent —
        exactly the rides a 90-day peak-power curve depends on. Both filters are applied
        before `max_activities`, so non-cycling activities no longer eat into the budget.
        """
        access_token = self._get_valid_token(rider_id)
        if not access_token:
            return []

        per_page = 200
        max_pages = 10
        seen_ids: set = set()
        collected: list = []
        cursor = None

        for _ in range(max_pages):
            params = {'per_page': per_page}
            if cursor is not None:
                params['before'] = cursor
            try:
                res = requests.get(
                    "https://www.strava.com/api/v3/athlete/activities",
                    params=params,
                    headers={'Authorization': f'Bearer {access_token}'},
                    timeout=15,
                )
            except Exception as e:
                logger.error(f"Error fetching power activities: {e}")
                break

            if res.status_code != 200:
                logger.error(f"get_power_activities failed: {res.status_code}")
                break

            try:
                batch = res.json() or []
            except Exception as e:
                logger.error(f"Error parsing power activities response: {e}")
                break
            if not batch:
                break

            oldest_epoch = None
            new_ids = 0
            reached_window_start = False

            for a in batch:
                epoch = self._activity_start_epoch(a)
                if epoch is not None and (oldest_epoch is None or epoch < oldest_epoch):
                    oldest_epoch = epoch
                if epoch is not None and epoch <= after_timestamp:
                    reached_window_start = True
                    continue

                act_id = a.get('id')
                if act_id is None or act_id in seen_ids:
                    continue
                seen_ids.add(act_id)
                new_ids += 1
                if a.get('device_watts', False) and self._is_cycling_activity(a):
                    collected.append({
                        'id': act_id,
                        'name': a.get('name'),
                        'startDate': a.get('start_date'),
                    })

            if reached_window_start or len(batch) < per_page or new_ids == 0 or oldest_epoch is None:
                break
            cursor = oldest_epoch

        collected.sort(key=lambda a: a.get('startDate') or '', reverse=True)
        return collected[:max_activities]

    def get_segment_streams(self, segment_id: int):
        """Fetch distance and altitude streams for a public Strava segment."""
        access_token = self._get_service_token()
        if not access_token:
            return None

        try:
            url = (
                f"https://www.strava.com/api/v3/segments/{segment_id}/streams"
                f"?keys=distance,altitude&key_by_type=true"
            )
            res = requests.get(url, headers={'Authorization': f'Bearer {access_token}'})
            if res.status_code == 200:
                data = res.json()
                return {
                    'distance': data.get('distance', {}).get('data', []),
                    'altitude': data.get('altitude', {}).get('data', []),
                }
            else:
                logger.error(f"Segment stream fetch failed: {res.status_code} {res.text}")
                return None
        except Exception as e:
            logger.error(f"Error fetching segment streams: {e}")
            return None
