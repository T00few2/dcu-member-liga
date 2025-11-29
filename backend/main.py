import functions_framework
from flask import jsonify, redirect, request
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
from firebase_admin import auth
import os
from services.strava import StravaService
from services.zwiftpower import ZwiftPowerService
from services.zwiftracing import ZwiftRacingService
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from services.results_processor import ResultsProcessor
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

# Global cache for Zwift Game service
_zwift_game_service = ZwiftGameService()

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

# Helper to fetch and update rider stats
def update_rider_stats(e_license, zwift_id):
    if not db or not e_license or not zwift_id:
        return None
    
    print(f"Fetching stats for {e_license} (ZwiftID: {zwift_id})")
    
    updates = {}
    
    # 1. ZwiftPower
    try:
        zp = get_zp_service()
        zp_json = zp.get_rider_data_json(int(zwift_id))
        if zp_json and 'data' in zp_json and len(zp_json['data']) > 0:
            rider_info = zp_json['data'][0]
            updates['zwiftPower'] = {
                'category': rider_info.get('category', 'N/A'),
                'ftp': rider_info.get('ftp', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
        print(f"ZP Fetch Error: {e}")

    # 2. ZwiftRacing
    try:
        zr_json = zr_service.get_rider_data(str(zwift_id))
        if zr_json:
            # Handle direct object response vs 'data' wrapper
            data = zr_json if 'race' in zr_json else zr_json.get('data', {})
            race = data.get('race', {})
            updates['zwiftRacing'] = {
                'currentRating': race.get('current', {}).get('rating', 'N/A'),
                'max30Rating': race.get('max30', {}).get('rating', 'N/A'),
                'max90Rating': race.get('max90', {}).get('rating', 'N/A'),
                'phenotype': data.get('phenotype', {}).get('value', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
         print(f"ZR Fetch Error: {e}")

    # 3. Zwift Profile
    try:
        zwift_service = get_zwift_service()
        profile = zwift_service.get_profile(int(zwift_id))
        if profile:
             updates['zwiftProfile'] = {
                'ftp': profile.get('ftp'),
                'weight': profile.get('weight'),
                'height': profile.get('height'),
                'racingScore': profile.get('competitionMetrics', {}).get('racingScore'),
                'updatedAt': firestore.SERVER_TIMESTAMP
             }
    except Exception as e:
         print(f"Zwift Fetch Error: {e}")
         
    # 4. Strava (Summary only)
    try:
        strava_data = strava_service.get_activities(e_license)
        if strava_data and 'kms' in strava_data:
            updates['stravaSummary'] = {
                'kms': strava_data.get('kms', 'N/A'),
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
    except Exception as e:
        print(f"Strava Fetch Error: {e}")
         
    if updates:
        db.collection('users').document(str(e_license)).set(updates, merge=True)
        return updates
    return None

@functions_framework.http
def dcu_api(request):
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '3600'
    }

    if request.method == 'OPTIONS':
        return ('', 204, headers)

    path = request.path

    # --- ADMIN: ZWIFT ROUTES & SEGMENTS ---
    if path == '/routes' and request.method == 'GET':
        routes = _zwift_game_service.get_routes()
        return (jsonify({'routes': routes}), 200, headers)

    if path == '/segments' and request.method == 'GET':
        route_id = request.args.get('routeId')
        laps = request.args.get('laps', 1)
        if not route_id:
            return (jsonify({'message': 'Missing routeId'}), 400, headers)
        
        segments = _zwift_game_service.get_event_segments(route_id, laps=int(laps))
        return (jsonify({'segments': segments}), 200, headers)

    # --- ADMIN: LEAGUE SETTINGS (Points Schemes) ---
    if path == '/league/settings' and request.method == 'GET':
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        try:
            doc = db.collection('league').document('settings').get()
            settings = doc.to_dict() if doc.exists else {}
            return (jsonify({'settings': settings}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/league/settings' and request.method == 'POST':
        # Verify Admin
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
        except:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            data = request.get_json()
            # Validate schemes are lists of numbers
            finish_points = data.get('finishPoints', [])
            sprint_points = data.get('sprintPoints', [])
            
            db.collection('league').document('settings').set({
                'finishPoints': finish_points,
                'sprintPoints': sprint_points,
                'updatedAt': firestore.SERVER_TIMESTAMP
            }, merge=True)
            
            return (jsonify({'message': 'Settings saved'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # --- LEAGUE STANDINGS ---
    if path == '/league/standings' and request.method == 'GET':
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        try:
            # Reuse ResultsProcessor logic for aggregation
            processor = ResultsProcessor(db, None, None) # Services not needed for aggregation
            standings = processor.calculate_league_standings()
            return (jsonify({'standings': standings}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # --- ADMIN: RACES CRUD ---
    if path == '/races' and request.method == 'GET':
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        try:
            # Fetch races ordered by date
            races_ref = db.collection('races').order_by('date')
            docs = races_ref.stream()
            races = []
            for doc in docs:
                r = doc.to_dict()
                r['id'] = doc.id
                races.append(r)
            return (jsonify({'races': races}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/races' and request.method == 'POST':
        # Verify Admin Auth (Basic check: Must be logged in. Should be stricter in prod)
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        
        try:
             # Verify token valid
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
             # TODO: Check if user is admin
        except Exception as e:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
             
        try:
            data = request.get_json()
            # Basic validation
            if not data.get('name') or not data.get('date'):
                 return (jsonify({'message': 'Missing required fields'}), 400, headers)
                 
            # Create race
            _, doc_ref = db.collection('races').add(data)
            return (jsonify({'message': 'Race created', 'id': doc_ref.id}), 201, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # Handle DELETE /races/<id>
    if path.startswith('/races/') and request.method == 'DELETE':
         # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
        except:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        race_id = path.split('/')[-1]
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            db.collection('races').document(race_id).delete()
            return (jsonify({'message': 'Race deleted'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # Handle PUT /races/<id> (Update)
    if path.startswith('/races/') and request.method == 'PUT':
         # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
        except:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        race_id = path.split('/')[-1]
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            data = request.get_json()
            if not data.get('name') or not data.get('date'):
                 return (jsonify({'message': 'Missing required fields'}), 400, headers)

            db.collection('races').document(race_id).update(data)
            return (jsonify({'message': 'Race updated'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # Handle POST /races/<id>/results/refresh (Trigger Calculation)
    if path.startswith('/races/') and path.endswith('/results/refresh') and request.method == 'POST':
         # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
        except:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        parts = path.split('/')
        # /races/<id>/results/refresh -> id is index 2
        race_id = parts[2]
        
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            # Initialize Processor with fresh Zwift Service
            zwift_service = get_zwift_service()
            processor = ResultsProcessor(db, zwift_service, _zwift_game_service)
            
            # Parse fetch mode from request body
            req_data = request.get_json(silent=True) or {}
            fetch_mode = req_data.get('source', 'finishers')
            filter_registered = req_data.get('filterRegistered', True)
            category_filter = req_data.get('categoryFilter', 'All')
            
            results = processor.process_race_results(
                race_id, 
                fetch_mode=fetch_mode, 
                filter_registered=filter_registered,
                category_filter=category_filter
            )
            
            return (jsonify({'message': f'Results calculated (Mode: {fetch_mode}, Cat: {category_filter})', 'results': results}), 200, headers)
        except Exception as e:
            print(f"Results Processing Error: {e}")
            return (jsonify({'message': str(e)}), 500, headers)

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

    # --- PROFILE ROUTE ---
    if path == '/profile' and request.method == 'GET':
        try:
            # Verify ID Token
            auth_header = request.headers.get('Authorization')
            if not auth_header or not auth_header.startswith('Bearer '):
                return (jsonify({'message': 'Missing or invalid Authorization header'}), 401, headers)
            
            id_token = auth_header.split('Bearer ')[1]
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']

            if not db:
                 return (jsonify({'message': 'Database not available'}), 500, headers)

            # 1. Look up E-License from Auth Mapping
            mapping_doc = db.collection('auth_mappings').document(uid).get()
            if not mapping_doc.exists:
                return (jsonify({'registered': False}), 200, headers)
            
            e_license = mapping_doc.to_dict().get('eLicense')
            
            # 2. Fetch User Details
            user_doc = db.collection('users').document(str(e_license)).get()
            if not user_doc.exists:
                return (jsonify({'registered': False}), 200, headers)
            
            user_data = user_doc.to_dict()
            
            return (jsonify({
                'registered': True,
                'eLicense': user_data.get('eLicense'),
                'name': user_data.get('name'),
                'zwiftId': user_data.get('zwiftId'),
                'stravaConnected': bool(user_data.get('strava_access_token')) or bool(user_data.get('strava')) 
            }), 200, headers)

        except Exception as e:
            print(f"Profile Error: {e}")
            return (jsonify({'message': str(e)}), 500, headers)

    # --- VERIFICATION ROUTES ---
    
    if path.startswith('/verify/zwift/') and request.method == 'GET':
        zwift_id = path.split('/')[-1]
        try:
            zwift_service = get_zwift_service()
            profile = zwift_service.get_profile(int(zwift_id))
            
            if not profile:
                return (jsonify({'message': 'Rider not found'}), 404, headers)
            
            return (jsonify({
                'firstName': profile.get('firstName'),
                'lastName': profile.get('lastName'),
                'id': profile.get('id')
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path.startswith('/verify/elicense/') and request.method == 'GET':
        e_license = path.split('/')[-1]
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            # Check if document exists
            doc = db.collection('users').document(str(e_license)).get()
            return (jsonify({'available': not doc.exists}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # --- CORE ROUTES ---

    if path == '/signup' and request.method == 'POST':
        try:
            # Verify ID Token
            auth_header = request.headers.get('Authorization')
            if not auth_header or not auth_header.startswith('Bearer '):
                return (jsonify({'message': 'Missing or invalid Authorization header'}), 401, headers)
            
            id_token = auth_header.split('Bearer ')[1]
            try:
                decoded_token = auth.verify_id_token(id_token)
                uid = decoded_token['uid']
            except Exception as auth_error:
                print(f"Auth Error: {auth_error}")
                return (jsonify({'message': f'Invalid session token: {str(auth_error)}'}), 401, headers)

            request_json = request.get_json(silent=True)
            if not request_json:
                 return (jsonify({'message': 'Invalid JSON'}), 400, headers)
            
            e_license = request_json.get('eLicense')
            name = request_json.get('name')
            zwift_id = request_json.get('zwiftId')
            
            if not e_license or not name:
                return (jsonify({'message': 'Missing eLicense or name'}), 400, headers)

            if db:
                # 1. Save User Profile (by E-License)
                doc_ref = db.collection('users').document(str(e_license))
                doc_ref.set({
                    'name': name,
                    'eLicense': e_license,
                    'zwiftId': zwift_id, 
                    'verified': True,
                    'authUid': uid, 
                    'updatedAt': firestore.SERVER_TIMESTAMP
                }, merge=True)

                # 2. Create/Update a mapping
                auth_map_ref = db.collection('auth_mappings').document(uid)
                auth_map_ref.set({
                    'eLicense': e_license,
                    'lastLogin': firestore.SERVER_TIMESTAMP
                }, merge=True)
                
                # 3. TRIGGER STATS FETCH ON SIGNUP
                if zwift_id:
                    update_rider_stats(e_license, zwift_id)
            
            return (jsonify({
                'message': 'Signup successful',
                'verified': True,
                'user': {'name': name, 'eLicense': e_license, 'zwiftId': zwift_id}
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # --- PARTICIPANTS LIST ---
    if path == '/participants' and request.method == 'GET':
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            # Fetch all users
            users_ref = db.collection('users')
            # Limit to 100 for now to be safe
            docs = users_ref.limit(100).stream()
            
            participants = []
            for doc in docs:
                data = doc.to_dict()
                
                # Extract summary stats from stored data
                zp = data.get('zwiftPower', {})
                zr = data.get('zwiftRacing', {})
                zpro = data.get('zwiftProfile', {})
                strava = data.get('stravaSummary', {})
                
                participants.append({
                    'name': data.get('name'),
                    'eLicense': data.get('eLicense'),
                    'zwiftId': data.get('zwiftId'),
                    'category': zp.get('category', 'N/A'),
                    'ftp': zp.get('ftp', 'N/A'),
                    'rating': zr.get('currentRating', 'N/A'),
                    'max30Rating': zr.get('max30Rating', 'N/A'),
                    'max90Rating': zr.get('max90Rating', 'N/A'),
                    'phenotype': zr.get('phenotype', 'N/A'),
                    'racingScore': zpro.get('racingScore', 'N/A'),
                    'stravaKms': strava.get('kms', '-')
                })
            
            return (jsonify({'participants': participants}), 200, headers)
        except Exception as e:
            print(f"Participants List Error: {e}")
            return (jsonify({'message': str(e)}), 500, headers)


    # --- STATS (Detailed) ---
    if path == '/stats' and request.method == 'GET':
        e_license = request.args.get('eLicense')
        
        # If no eLicense provided, check for Auth Token
        if not e_license:
            auth_header = request.headers.get('Authorization')
            if auth_header and auth_header.startswith('Bearer '):
                try:
                    id_token = auth_header.split('Bearer ')[1]
                    decoded_token = auth.verify_id_token(id_token)
                    uid = decoded_token['uid']
                    
                    if db:
                        mapping_doc = db.collection('auth_mappings').document(uid).get()
                        if mapping_doc.exists:
                            e_license = mapping_doc.to_dict().get('eLicense')
                except Exception as e:
                    print(f"Token verification failed in stats: {e}")
        
        strava_data = {'kms': 'Not Connected', 'activities': []}
        zp_data = {'category': 'N/A', 'ftp': 'N/A'}
        zr_data = {}
        zwift_data = {}
        
        if e_license and db:
            try:
                user_doc = db.collection('users').document(str(e_license)).get()
                if user_doc.exists:
                    user_data = user_doc.to_dict()
                    
                    # 1. Fetch Strava Stats
                    if user_data.get('strava'):
                        strava_data = strava_service.get_activities(e_license)
                    
                    zwift_id = user_data.get('zwiftId')
                    if zwift_id:
                        # --- ORIGINAL LIVE FETCH LOGIC (Preserved for detailed fields) ---
                        try:
                            zp = get_zp_service()
                            zp_json = zp.get_rider_data_json(int(zwift_id))
                            if zp_json and 'data' in zp_json and len(zp_json['data']) > 0:
                                rider_info = zp_json['data'][0]
                                zp_data = {
                                    'category': rider_info.get('category', 'N/A'),
                                    'ftp': rider_info.get('ftp', 'N/A'),
                                }
                        except Exception as zp_e:
                                print(f"ZwiftPower fetch error: {zp_e}")

                        try:
                            zr_json = zr_service.get_rider_data(str(zwift_id))
                            if zr_json:
                                data = zr_json if 'race' in zr_json else zr_json.get('data', {})
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
                                    'level': int(profile.get('level', 0)),
                                    'racingScore': profile.get('competitionMetrics', {}).get('racingScore', 'N/A')
                                }
                        except Exception as z_e:
                                print(f"Zwift API fetch error: {z_e}")

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
