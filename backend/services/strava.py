import requests
import time
from config import STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, BACKEND_URL
from firebase_admin import firestore

class StravaService:
    def __init__(self, db):
        self.db = db

    def _refresh_token(self, e_license, refresh_token):
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
                # Never log token payloads; Strava responses can include sensitive fields.
                print(f"Failed to refresh token: HTTP {res.status_code}")
                return None
            
            if self.db:
                user_ref = self.db.collection('users').document(str(e_license))
                user_ref.update({
                    'strava.access_token': data['access_token'],
                    'strava.refresh_token': data['refresh_token'],
                    'strava.expires_at': data['expires_at']
                })
                
            return data['access_token']
        except Exception as e:
            print(f"Error refreshing token: {e}")
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
        """
        Revoke an athlete's authorization for this app.
        Strava endpoint: POST https://www.strava.com/oauth/deauthorize
        """
        if not access_token:
            return False
        try:
            res = requests.post(
                "https://www.strava.com/oauth/deauthorize",
                data={'access_token': access_token}
            )
            return res.status_code == 200
        except Exception as e:
            print(f"Error deauthorizing Strava token: {e}")
            return False

    def _get_valid_token(self, e_license):
        if not e_license or not self.db:
            return None
            
        try:
            user_doc = self.db.collection('users').document(str(e_license)).get()
            if not user_doc.exists:
                return None
                
            user_data = user_doc.to_dict()
            strava_auth = user_data.get('strava')
            
            if not strava_auth:
                return None
                
            access_token = strava_auth.get('access_token')
            refresh_token = strava_auth.get('refresh_token')
            expires_at = strava_auth.get('expires_at')
            
            # Check expiry (add buffer of 5 minutes)
            if expires_at and time.time() > (expires_at - 300):
                print(f"Token expired for {e_license}, refreshing...")
                new_token = self._refresh_token(e_license, refresh_token)
                if new_token:
                    return new_token
                return None
            
            return access_token
        except Exception as e:
            print(f"Error getting valid token: {e}")
            return None

    def get_activities(self, e_license):
        strava_kms = "Not Connected"
        recent_activities = []
        
        access_token = self._get_valid_token(e_license)
        
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
                print(f"Error fetching strava stats: {e}")
                
        return {
            'kms': strava_kms,
            'activities': recent_activities
        }

    def get_activity_streams(self, e_license, activity_id):
        access_token = self._get_valid_token(e_license)
        if not access_token:
            return None
            
        try:
            # Fetch streams: time, watts, cadence, heartrate
            # We deliberately do NOT use key_by_type=true, so we get the standard array format
            # that the frontend expects: [{type: 'time', data: ...}, {type: 'watts', data: ...}]
            url = f"https://www.strava.com/api/v3/activities/{activity_id}/streams?keys=time,watts,cadence,heartrate,altitude"
            res = requests.get(url, headers={'Authorization': f"Bearer {access_token}"})
            
            if res.status_code == 200:
                return res.json()
            else:
                print(f"Error fetching streams: {res.status_code} {res.text}")
                return None
        except Exception as e:
            print(f"Error fetching streams: {e}")
            return None
