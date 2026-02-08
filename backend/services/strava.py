import requests
import time
from config import STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, BACKEND_URL
from firebase_admin import firestore

class StravaService:
    def __init__(self, db):
        self.db = db

    def _get_user_ref(self, rider_id):
        # Helper to find user doc by ID (ZwiftID) or eLicense
        doc = self.db.collection('users').document(str(rider_id)).get()
        if doc.exists:
            return self.db.collection('users').document(str(rider_id)), doc.to_dict()
        
        # Fallback to eLicense lookup
        docs = self.db.collection('users').where('eLicense', '==', str(rider_id)).limit(1).stream()
        for d in docs:
            return self.db.collection('users').document(d.id), d.to_dict()
            
        return None, None

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
                print(f"Failed to refresh token: HTTP {res.status_code}")
                return None
            
            if self.db:
                user_ref, user_data = self._get_user_ref(rider_id)
                if user_ref:
                    # Check if using new 'connections' group or legacy root
                    if 'connections' in user_data or 'registration' in user_data:
                         user_ref.set({
                            'connections': {
                                'strava': {
                                    'access_token': data['access_token'],
                                    'refresh_token': data['refresh_token'],
                                    'expires_at': data['expires_at']
                                }
                            }
                        }, merge=True)
                    else:
                        # Legacy fallback
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

    def _get_valid_token(self, rider_id):
        if not rider_id or not self.db:
            return None
            
        try:
            _, user_data = self._get_user_ref(rider_id)
            if not user_data:
                return None
                
            # Support both new 'connections.strava' and legacy root 'strava'
            strava_auth = user_data.get('connections', {}).get('strava') or user_data.get('strava')
            
            if not strava_auth:
                return None
                
            access_token = strava_auth.get('access_token')
            refresh_token = strava_auth.get('refresh_token')
            expires_at = strava_auth.get('expires_at')
            
            # Check expiry (add buffer of 5 minutes)
            if expires_at and time.time() > (expires_at - 300):
                print(f"Token expired for {rider_id}, refreshing...")
                new_token = self._refresh_token(rider_id, refresh_token)
                if new_token:
                    return new_token
                return None
            
            return access_token
        except Exception as e:
            print(f"Error getting valid token: {e}")
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
                print(f"Error fetching strava stats: {e}")
                
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
                print(f"Error fetching streams: {res.status_code} {res.text}")
                return None
        except Exception as e:
            print(f"Error fetching streams: {e}")
            return None
