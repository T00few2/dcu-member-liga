import requests
import time
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

    def get_activity_streams(self, rider_id, activity_id):
        access_token = self._get_valid_token(rider_id)
        if not access_token:
            return None

        try:
            url = f"https://www.strava.com/api/v3/activities/{activity_id}/streams?keys=time,watts,cadence,heartrate,altitude"
            res = requests.get(url, headers={'Authorization': f"Bearer {access_token}"})

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
