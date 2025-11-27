import functions_framework
from flask import jsonify, redirect, request
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import os
from services.strava import StravaService
from services.zwiftpower import ZwiftPowerService
from services.zwiftracing import ZwiftRacingService
from services.zwift import ZwiftService
from config import ZWIFT_USERNAME, ZWIFT_PASSWORD

# Initialize Firebase Admin
try:
    if not firebase_admin._apps:
        cred_path = 'serviceAccountKey.json'
        if os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
            
    db = firestore.client()
except Exception as e:
    print(f"Warning: Firebase could not be initialized. Database operations will fail. Error: {e}")
    db = None

import time

# Initialize Services
strava_service = StravaService(db)

# Global cache for ZwiftPower service
_zp_service_instance = None
_zp_service_timestamp = 0
SESSION_VALIDITY = 3000 # 50 minutes (less than typical 1h expiry)

# Global cache for Zwift service
_zwift_service_instance = None
_zwift_service_timestamp = 0

def get_zp_service():
    global _zp_service_instance, _zp_service_timestamp
    now = time.time()
    
    if _zp_service_instance and (now - _zp_service_timestamp < SESSION_VALIDITY):
        print("Using cached ZwiftPower session.")
        return _zp_service_instance

    print("Creating new ZwiftPower session.")
    service = ZwiftPowerService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
    # Attempt login immediately to prime the session
    try:
        service.login()
        _zp_service_instance = service
        _zp_service_timestamp = now
        return service
    except Exception as e:
        print(f"Failed to initialize ZwiftPower session: {e}")
        # Return a fresh instance anyway so the caller can try/fail gracefully per request
        return service

def get_zwift_service():
    global _zwift_service_instance, _zwift_service_timestamp
    now = time.time()
    
    if _zwift_service_instance and (now - _zwift_service_timestamp < SESSION_VALIDITY):
        # Check token valid internally
        try:
            _zwift_service_instance.ensure_valid_token()
            return _zwift_service_instance
        except:
            pass # Re-create if token refresh fails

    print("Creating new Zwift service session.")
    service = ZwiftService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
    try:
        service.authenticate()
        _zwift_service_instance = service
        _zwift_service_timestamp = now
        return service
    except Exception as e:
        print(f"Failed to initialize Zwift session: {e}")
        return service

zr_service = ZwiftRacingService()

@functions_framework.http
def dcu_api(request):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '3600'
    }

    if request.method == 'OPTIONS':
        return ('', 204, headers)

    path = request.path

    # --- STRAVA ROUTES ---

    if path == '/strava/login' and request.method == 'GET':
        e_license = request.args.get('eLicense')
        url, error, status = strava_service.login(e_license)
        if error:
            return (jsonify({'message': error}), status, headers)
        return redirect(url)

    if path == '/strava/callback' and request.method == 'GET':
        code = request.args.get('code')
        e_license = request.args.get('state')
        error = request.args.get('error')
        
        url, error_msg, status = strava_service.callback(code, e_license, error)
        if error_msg:
             return (jsonify({'message': error_msg}), status, headers)
        return redirect(url)

    # --- CORE ROUTES ---

    if path == '/signup' and request.method == 'POST':
        try:
            request_json = request.get_json(silent=True)
            if not request_json:
                 return (jsonify({'message': 'Invalid JSON'}), 400, headers)
            
            e_license = request_json.get('eLicense')
            name = request_json.get('name')
            zwift_id = request_json.get('zwiftId')
            
            if not e_license or not name:
                return (jsonify({'message': 'Missing eLicense or name'}), 400, headers)

            if db:
                doc_ref = db.collection('users').document(str(e_license))
                doc_ref.set({
                    'name': name,
                    'eLicense': e_license,
                    'zwiftId': zwift_id, # Save optional Zwift ID
                    'verified': True,
                    'createdAt': firestore.SERVER_TIMESTAMP
                }, merge=True)
            
            return (jsonify({
                'message': 'Signup successful',
                'verified': True,
                'user': {'name': name, 'eLicense': e_license, 'zwiftId': zwift_id}
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/stats' and request.method == 'GET':
        e_license = request.args.get('eLicense')
        
        # Default values
        strava_data = {'kms': 'Not Connected', 'activities': []}
        zp_data = {'category': 'N/A', 'ftp': 'N/A'}
        zr_data = {}
        zwift_data = {}
        
        if e_license and db:
            try:
                user_doc = db.collection('users').document(str(e_license)).get()
                if user_doc.exists:
                    user_data = user_doc.to_dict()
                    
                    # 1. Fetch Strava Stats (if connected)
                    if user_data.get('strava'):
                        strava_data = strava_service.get_activities(e_license)
                    
                    # 2. Fetch ZwiftPower Stats (if ID exists)
                    zwift_id = user_data.get('zwiftId')
                    if zwift_id:
                        try:
                            zp = get_zp_service()
                            # Note: login() is called inside get_zp_service() for new sessions,
                            # or skipped if cached. We can call it again here if we want to be sure,
                            # but let's trust the cache logic first.
                            
                            zp_json = zp.get_rider_data_json(int(zwift_id))
                            if zp_json and 'data' in zp_json and len(zp_json['data']) > 0:
                                rider_info = zp_json['data'][0] # Assuming first element has summary
                                zp_data = {
                                    'category': rider_info.get('category', 'N/A'),
                                    'ftp': rider_info.get('ftp', 'N/A'),
                                    # Add other relevant fields from rider_info here
                                }
                        except Exception as zp_e:
                            print(f"ZwiftPower fetch error: {zp_e}")
                            zp_data['error'] = "Fetch Failed"

                        # 3. Fetch ZwiftRacing Stats
                        try:
                            zr_json = zr_service.get_rider_data(str(zwift_id))
                            if zr_json and zr_json.get('success') and 'data' in zr_json:
                                data = zr_json['data']
                                race = data.get('race', {})
                                zr_data = {
                                    'currentRating': race.get('current', {}).get('rating', 'N/A'),
                                    'max30Rating': race.get('max30', {}).get('rating', 'N/A'),
                                    'max90Rating': race.get('max90', {}).get('rating', 'N/A'),
                                    'phenotype': data.get('phenotype', {}).get('value', 'N/A'),
                                    'finishes': race.get('finishes', 0),
                                    'wins': race.get('wins', 0),
                                    'podiums': race.get('podiums', 0),
                                    'dnfs': race.get('dnfs', 0)
                                }
                        except Exception as zr_e:
                            print(f"ZwiftRacing fetch error: {zr_e}")
                            zr_data['error'] = "Fetch Failed"

                        # 4. Fetch Zwift API Stats
                        try:
                            zwift_service = get_zwift_service()
                            profile = zwift_service.get_profile(int(zwift_id))
                            if profile:
                                zwift_data = {
                                    'ftp': profile.get('ftp', 'N/A'),
                                    'weight': f"{round(profile.get('weight', 0) / 1000, 1)} kg" if profile.get('weight') else 'N/A',
                                    'height': f"{round(profile.get('height', 0) / 10, 0)} cm" if profile.get('height') else 'N/A',
                                    'totalDistance': f"{int(profile.get('totalDistance', 0) / 1000)} km" if profile.get('totalDistance') else 'N/A',
                                    'totalTime': f"{int(profile.get('totalTimeInMinutes', 0) / 60)} hrs" if profile.get('totalTimeInMinutes') else 'N/A',
                                    'level': int(profile.get('level', 0))
                                }
                        except Exception as z_e:
                            print(f"Zwift API fetch error: {z_e}")
                            zwift_data['error'] = "Fetch Failed"

            except Exception as e:
                print(f"Error fetching stats: {e}")
        
        stats_data = {
            'stats': [
                {
                    'platform': 'Zwift',
                    **zwift_data
                },
                {
                    'platform': 'ZwiftPower', 
                    'category': zp_data.get('category', 'N/A'),
                    'ftp': zp_data.get('ftp', 'N/A')
                },
                {
                    'platform': 'ZwiftRacing',
                    **zr_data
                },
                {
                    'platform': 'Strava', 
                    'kms': strava_data.get('kms', 'N/A'),
                    'activities': strava_data.get('activities', [])
                }
            ]
        }
        return (jsonify(stats_data), 200, headers)

    return ('Not Found', 404, headers)
