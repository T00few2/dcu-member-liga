import requests
import time
from flask import jsonify, redirect
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
                print(f"Failed to refresh token: {data}")
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

    def login(self, e_license):
        if not e_license:
             return None, 'Missing eLicense param', 400

        redirect_uri = f"{BACKEND_URL}/strava/callback"
        scope = "read,activity:read_all" 
        
        strava_url = (
            f"https://www.strava.com/oauth/authorize"
            f"?client_id={STRAVA_CLIENT_ID}"
            f"&response_type=code"
            f"&redirect_uri={redirect_uri}"
            f"&approval_prompt=force"
            f"&scope={scope}"
            f"&state={e_license}" 
        )
        return strava_url, None, 302

    def callback(self, code, e_license, error):
        if error:
            return None, f'Strava Error: {error}', 400
        
        if not code or not e_license:
             return None, 'Missing code or state', 400

        token_url = "https://www.strava.com/oauth/token"
        payload = {
            'client_id': STRAVA_CLIENT_ID,
            'client_secret': STRAVA_CLIENT_SECRET,
            'code': code,
            'grant_type': 'authorization_code'
        }
        
        try:
            res = requests.post(token_url, data=payload)
            data = res.json()
            
            if res.status_code != 200:
                 return None, {'message': 'Failed to get tokens', 'details': data}, 500
            
            if self.db:
                user_ref = self.db.collection('users').document(str(e_license))
                user_ref.update({
                    'strava': {
                        'athlete_id': data['athlete']['id'],
                        'access_token': data['access_token'],
                        'refresh_token': data['refresh_token'],
                        'expires_at': data['expires_at']
                    }
                })
            
            return f"https://dcu-member-liga.vercel.app/signup?strava=connected", None, 302

        except Exception as e:
             return None, str(e), 500

    def get_activities(self, e_license):
        strava_kms = "Not Connected"
        recent_activities = []
        
        if e_license and self.db:
            try:
                user_doc = self.db.collection('users').document(str(e_license)).get()
                if user_doc.exists:
                    user_data = user_doc.to_dict()
                    strava_auth = user_data.get('strava')
                    
                    if strava_auth:
                        access_token = strava_auth.get('access_token')
                        refresh_token = strava_auth.get('refresh_token')
                        expires_at = strava_auth.get('expires_at')
                        
                        # Check expiry (add buffer of 5 minutes)
                        if expires_at and time.time() > (expires_at - 300):
                            print(f"Token expired for {e_license}, refreshing...")
                            new_token = self._refresh_token(e_license, refresh_token)
                            if new_token:
                                access_token = new_token
                            else:
                                return {'kms': 'Token Expired (Re-login)', 'activities': []}
                        
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
                                    'name': a['name'],
                                    'distance': f"{round(a['distance'] / 1000, 2)} km",
                                    'date': a['start_date_local'][:10], 
                                    'moving_time': f"{round(a['moving_time'] / 60)} min"
                                })
                        else:
                            strava_kms = "Error fetching"
            except Exception as e:
                print(f"Error fetching strava stats: {e}")
                
        return {
            'kms': strava_kms,
            'activities': recent_activities
        }

