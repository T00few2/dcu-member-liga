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
import secrets

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

    # --- ADMIN: VERIFICATION ENDPOINT ---
    if path.startswith('/admin/verification/rider/') and request.method == 'GET':
        # Check Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
        except:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        e_license = path.split('/')[-1]
        if not db:
             return (jsonify({'error': 'DB not available'}), 500, headers)

        try:
            # 1. Get Rider Meta
            user_doc = db.collection('users').document(str(e_license)).get()
            if not user_doc.exists:
                return (jsonify({'message': 'User not found'}), 404, headers)
            
            user_data = user_doc.to_dict()
            zwift_id = user_data.get('zwiftId')
            
            response_data = {'profile': {}, 'stravaActivities': [], 'zwiftPowerHistory': []}

            # 2. Fetch Profile (Live from Zwift)
            if zwift_id:
                try:
                    zwift_service = get_zwift_service()
                    profile = zwift_service.get_profile(int(zwift_id))
                    if profile:
                        response_data['profile'] = {
                            'weight': round(profile.get('weight', 0) / 1000, 1) if profile.get('weight') else None,
                            'height': round(profile.get('height', 0) / 10, 0) if profile.get('height') else None,
                            'maxHr': profile.get('heartRateMax', 0)
                        }
                except Exception as e:
                    print(f"Zwift Profile Fetch Error: {e}")

            # 3. Fetch Strava Activities
            try:
                strava_raw = strava_service.get_activities(e_license)
                if strava_raw and 'activities' in strava_raw:
                    # Map simple format for verification UI
                    response_data['stravaActivities'] = strava_raw['activities'] 
            except Exception as e:
                print(f"Strava Verification Fetch Error: {e}")

            # 4. Fetch ZwiftPower History
            if zwift_id:
                try:
                    zp = get_zp_service()
                    zp_json = zp.get_rider_data_json(int(zwift_id))
                    
                    if zp_json and 'data' in zp_json:
                        history = []
                        # Parse ALL historical data for graphs
                        for entry in zp_json['data']:
                            # Parse weight: can be ["75.0", 1] or "75.0"
                            weight_val = entry.get('weight')
                            if isinstance(weight_val, list) and len(weight_val) > 0:
                                weight_val = float(weight_val[0])
                            else:
                                weight_val = float(weight_val) if weight_val else 0

                            # Parse height: can be [182, 1] or 182
                            height_val = entry.get('height')
                            if isinstance(height_val, list) and len(height_val) > 0:
                                height_val = float(height_val[0])
                            else:
                                height_val = float(height_val) if height_val else 0
                            
                            # Parse Avg Power: can be [250, 0] or 250
                            avg_pwr = entry.get('avg_power')
                            if isinstance(avg_pwr, list) and len(avg_pwr) > 0:
                                avg_pwr = float(avg_pwr[0])
                            else:
                                avg_pwr = float(avg_pwr) if avg_pwr else 0
                            
                            # Parse Avg HR
                            avg_hr = entry.get('avg_hr')
                            if isinstance(avg_hr, list) and len(avg_hr) > 0:
                                avg_hr = float(avg_hr[0])
                            else:
                                avg_hr = float(avg_hr) if avg_hr else 0
                            
                            # Parse WKG
                            wkg = entry.get('avg_wkg')
                            if isinstance(wkg, list) and len(wkg) > 0:
                                wkg_val = float(wkg[0]) if wkg[0] else 0
                            else:
                                wkg_val = float(wkg) if wkg else 0

                            # --- CP CURVE PARSING ---
                            # Fields: w5, w15, w30, w60, w120, w300, w1200
                            # These are often stored as [val, 0] or val
                            
                            cp_curve = {}
                            for duration in ['w5', 'w15', 'w30', 'w60', 'w120', 'w300', 'w1200']:
                                val = entry.get(duration)
                                if isinstance(val, list) and len(val) > 0:
                                    # Sometimes values are strings inside lists
                                    try:
                                        cp_curve[duration] = int(float(val[0])) if val[0] else 0
                                    except:
                                        cp_curve[duration] = 0
                                else:
                                    try:
                                        cp_curve[duration] = int(float(val)) if val else 0
                                    except:
                                        cp_curve[duration] = 0

                            history.append({
                                'date': entry.get('event_date', 0), # Unix Timestamp
                                'event_title': entry.get('event_title', 'Unknown Event'),
                                'avg_watts': avg_pwr,
                                'avg_hr': avg_hr,
                                'wkg': wkg_val,
                                'category': entry.get('category', ''),
                                'weight': weight_val,
                                'height': height_val,
                                'cp_curve': cp_curve
                            })
                        
                        # Sort by date descending
                        history.sort(key=lambda x: x['date'], reverse=True)
                        response_data['zwiftPowerHistory'] = history
                        
                except Exception as e:
                    print(f"ZP Verification Fetch Error: {e}")

            return (jsonify(response_data), 200, headers)
        except Exception as e:
             return (jsonify({'message': str(e)}), 500, headers)

    # --- ADMIN: STRAVA STREAMS ENDPOINT ---
    if path.startswith('/admin/verification/strava/streams/') and request.method == 'GET':
         # Check Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
             return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
             id_token = auth_header.split('Bearer ')[1]
             auth.verify_id_token(id_token)
        except:
             return (jsonify({'message': 'Unauthorized'}), 401, headers)

        activity_id = path.split('/')[-1]
        e_license = request.args.get('eLicense')
        
        if not e_license:
             return (jsonify({'message': 'Missing eLicense'}), 400, headers)

        try:
            streams = strava_service.get_activity_streams(e_license, activity_id)
            if streams:
                return (jsonify({'streams': streams}), 200, headers)
            else:
                return (jsonify({'message': 'Failed to fetch streams'}), 404, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)


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
            best_races_count = data.get('bestRacesCount', 5)
            
            db.collection('league').document('settings').set({
                'finishPoints': finish_points,
                'sprintPoints': sprint_points,
                'bestRacesCount': best_races_count,
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
            # 1. Try to get cached standings first
            doc = db.collection('league').document('standings').get()
            if doc.exists:
                data = doc.to_dict()
                # Check for freshness if needed, but for now we trust the event-driven update
                standings = data.get('standings')
                if standings:
                    return (jsonify({'standings': standings}), 200, headers)

            # 2. Fallback: Calculate if not present
            processor = ResultsProcessor(db, None, None) 
            standings = processor.calculate_league_standings()
            
            # Save it for next time
            db.collection('league').document('standings').set({
                'standings': standings,
                'updatedAt': firestore.SERVER_TIMESTAMP
            })
            
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
        return (jsonify({'message': 'Use POST /strava/login with Authorization header'}), 405, headers)

    if path == '/strava/login' and request.method == 'POST':
        # Authenticated initiation of Strava OAuth.
        # We do NOT accept eLicense as an unauthenticated state value.
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            decoded = auth.verify_id_token(id_token)
            uid = decoded['uid']
        except Exception:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)

        body = request.get_json(silent=True) or {}
        e_license = body.get('eLicense')  # optional (useful during registration)

        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)

        # Create short-lived OAuth state to prevent CSRF/account-linking issues.
        state = secrets.token_urlsafe(32)
        db.collection('strava_oauth_states').document(state).set({
            'uid': uid,
            'eLicense': e_license,
            'createdAt': firestore.SERVER_TIMESTAMP
        })

        url = strava_service.build_authorize_url(state)
        return (jsonify({'url': url}), 200, headers)

    if path == '/strava/callback' and request.method == 'GET':
        code = request.args.get('code')
        state = request.args.get('state')
        error = request.args.get('error')
        
        if error:
            return (jsonify({'message': f'Strava Error: {error}'}), 400, headers)

        if not code or not state:
            return (jsonify({'message': 'Missing code or state'}), 400, headers)

        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)

        # Resolve state -> uid/eLicense (short-lived)
        state_ref = db.collection('strava_oauth_states').document(state)
        state_doc = state_ref.get()
        if not state_doc.exists:
            return (jsonify({'message': 'Invalid or expired state'}), 400, headers)
        state_data = state_doc.to_dict() or {}
        uid = state_data.get('uid')
        e_license = state_data.get('eLicense')

        try:
            status_code, token_data = strava_service.exchange_code_for_tokens(code)
            if status_code != 200:
                # Do not echo token payloads; just provide a generic error.
                return (jsonify({'message': 'Failed to get Strava tokens'}), 500, headers)

            # Always store tokens on the authenticated user's draft doc (uid).
            # Later, during /signup completion, we migrate to the final eLicense doc.
            user_ref = db.collection('users').document(str(uid))
            user_ref.set({
                'strava': {
                    'athlete_id': token_data.get('athlete', {}).get('id'),
                    'access_token': token_data.get('access_token'),
                    'refresh_token': token_data.get('refresh_token'),
                    'expires_at': token_data.get('expires_at')
                },
                'updatedAt': firestore.SERVER_TIMESTAMP
            }, merge=True)

            # If the user is already registered/mapped to an eLicense, also store there.
            if e_license:
                mapping_doc = db.collection('auth_mappings').document(uid).get()
                mapped_elicense = mapping_doc.to_dict().get('eLicense') if mapping_doc.exists else None
                if mapped_elicense and str(mapped_elicense) == str(e_license):
                    db.collection('users').document(str(e_license)).set({
                        'strava': {
                            'athlete_id': token_data.get('athlete', {}).get('id'),
                            'access_token': token_data.get('access_token'),
                            'refresh_token': token_data.get('refresh_token'),
                            'expires_at': token_data.get('expires_at')
                        },
                        'updatedAt': firestore.SERVER_TIMESTAMP
                    }, merge=True)

        finally:
            # One-time use
            try:
                state_ref.delete()
            except Exception:
                pass

        return redirect("https://dcu-member-liga.vercel.app/register?strava=connected")

    if path == '/strava/deauthorize' and request.method == 'POST':
        # Authenticated disconnect/unlink flow
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            decoded = auth.verify_id_token(id_token)
            uid = decoded['uid']
        except Exception:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)

        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)

        # Try to locate Strava tokens on either the uid draft doc or the mapped eLicense doc.
        access_token = None
        user_doc = db.collection('users').document(str(uid)).get()
        if user_doc.exists:
            user_data = user_doc.to_dict() or {}
            access_token = (user_data.get('strava') or {}).get('access_token')

        mapped_elicense = None
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        if mapping_doc.exists:
            mapped_elicense = (mapping_doc.to_dict() or {}).get('eLicense')
            if not access_token and mapped_elicense:
                el_doc = db.collection('users').document(str(mapped_elicense)).get()
                if el_doc.exists:
                    el_data = el_doc.to_dict() or {}
                    access_token = (el_data.get('strava') or {}).get('access_token')

        # Revoke at Strava (best-effort)
        revoked = strava_service.deauthorize(access_token) if access_token else False

        # Remove tokens from Firestore (always)
        try:
            db.collection('users').document(str(uid)).set({'strava': firestore.DELETE_FIELD}, merge=True)
        except Exception:
            pass
        if mapped_elicense:
            try:
                db.collection('users').document(str(mapped_elicense)).set({'strava': firestore.DELETE_FIELD}, merge=True)
            except Exception:
                pass

        return (jsonify({'message': 'Strava disconnected', 'revoked': revoked}), 200, headers)

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
            
            # Check if user has a mapping
            if mapping_doc.exists:
                e_license = mapping_doc.to_dict().get('eLicense')
                user_doc = db.collection('users').document(str(e_license)).get()
            else:
                # Check if there's a draft saved under uid
                user_doc = db.collection('users').document(uid).get()
                e_license = None
            
            # 2. Fetch User Details
            if not user_doc.exists:
                return (jsonify({'registered': False}), 200, headers)
            
            user_data = user_doc.to_dict()
            
            # Check if registration is complete
            registration_complete = user_data.get('registrationComplete', user_data.get('verified', False))
            
            return (jsonify({
                'registered': registration_complete,
                'hasDraft': not registration_complete and user_data.get('name'),  # Has partial data
                'eLicense': user_data.get('eLicense', ''),
                'name': user_data.get('name', ''),
                'zwiftId': user_data.get('zwiftId', ''),
                'club': user_data.get('club', ''),
                'trainer': user_data.get('trainer', ''),
                'stravaConnected': bool(user_data.get('strava_access_token')) or bool(user_data.get('strava')),
                'acceptedCoC': user_data.get('acceptedCoC', False)
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
            club = request_json.get('club', '')
            trainer = request_json.get('trainer', '')
            is_draft = request_json.get('draft', False)
            
            # For draft saves, only require basic info
            if is_draft:
                # Draft save - minimal requirements
                if not name:
                    return (jsonify({'message': 'At least a name is required to save progress'}), 400, headers)
            else:
                # Full registration - require all fields
                if not e_license or not name:
                    return (jsonify({'message': 'Missing eLicense or name'}), 400, headers)

            if db:
                # Prepare data to save
                user_data = {
                    'authUid': uid,
                    'updatedAt': firestore.SERVER_TIMESTAMP
                }
                
                # Add fields that are provided
                if name:
                    user_data['name'] = name
                if e_license:
                    user_data['eLicense'] = e_license
                if zwift_id:
                    user_data['zwiftId'] = zwift_id
                if club:
                    user_data['club'] = club
                if trainer:
                    user_data['trainer'] = trainer
                
                user_data['acceptedCoC'] = request_json.get('acceptedCoC', False)
                
                # Set registration status
                if is_draft:
                    user_data['registrationComplete'] = False
                else:
                    user_data['verified'] = True
                    user_data['registrationComplete'] = True
                
                # 1. Save User Profile
                # Use e_license as document ID if available, otherwise use uid temporarily
                doc_id = str(e_license) if e_license else uid
                doc_ref = db.collection('users').document(doc_id)
                # Capture previous state to distinguish "first registration" from "profile update"
                prev_data = {}
                try:
                    prev_doc = doc_ref.get()
                    if prev_doc.exists:
                        prev_data = prev_doc.to_dict() or {}
                except Exception:
                    prev_data = {}

                prev_registered = bool(prev_data.get('registrationComplete', prev_data.get('verified', False)))
                prev_zwift_id = prev_data.get('zwiftId')
                doc_ref.set(user_data, merge=True)

                # If we previously connected Strava while in draft mode (stored on uid doc),
                # migrate Strava auth to the final eLicense doc when completing signup.
                if not is_draft and e_license and str(doc_id) == str(e_license) and uid:
                    draft_doc = db.collection('users').document(uid).get()
                    if draft_doc.exists:
                        draft_data = draft_doc.to_dict() or {}
                        if draft_data.get('strava'):
                            doc_ref.set({'strava': draft_data.get('strava')}, merge=True)
                            # Clean up the draft doc to avoid keeping duplicate token copies.
                            try:
                                db.collection('users').document(uid).delete()
                            except Exception:
                                pass

                # 2. Create/Update auth mapping (only if e_license is provided)
                if e_license:
                    auth_map_ref = db.collection('auth_mappings').document(uid)
                    auth_map_ref.set({
                        'eLicense': e_license,
                        'lastLogin': firestore.SERVER_TIMESTAMP
                    }, merge=True)
                
                # 3. TRIGGER STATS FETCH
                # Avoid expensive external calls on every "Update Profile".
                # Only do it on first completed registration, or if Zwift ID changed.
                if not is_draft and zwift_id and e_license and (not prev_registered or str(prev_zwift_id) != str(zwift_id)):
                    update_rider_stats(e_license, zwift_id)
            
            return (jsonify({
                'message': 'Progress saved' if is_draft else ('Profile updated' if prev_registered else 'Signup successful'),
                'verified': not is_draft,
                'draft': is_draft,
                'user': {'name': name, 'eLicense': e_license, 'zwiftId': zwift_id}
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # --- TRAINERS/POWERMETERS MANAGEMENT ---
    
    # GET /trainers - Get all trainers (approved + not approved)
    if path == '/trainers' and request.method == 'GET':
        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            trainers_ref = db.collection('trainers').order_by('name')
            docs = trainers_ref.stream()
            
            trainers = []
            for doc in docs:
                trainer_data = doc.to_dict()
                trainer_data['id'] = doc.id
                trainers.append(trainer_data)
            
            return (jsonify({'trainers': trainers}), 200, headers)
        except Exception as e:
            print(f"Error fetching trainers: {e}")
            return (jsonify({'message': str(e)}), 500, headers)
    
    # POST /trainers - Create new trainer (Admin only)
    if path == '/trainers' and request.method == 'POST':
        # Verify Admin Auth
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
            name = data.get('name')
            status = data.get('status', 'approved')  # approved, not_approved, pending
            dual_recording_required = data.get('dualRecordingRequired', False)
            
            if not name:
                return (jsonify({'message': 'Trainer name is required'}), 400, headers)
            
            trainer_data = {
                'name': name,
                'status': status,
                'dualRecordingRequired': dual_recording_required,
                'createdAt': firestore.SERVER_TIMESTAMP,
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            
            _, doc_ref = db.collection('trainers').add(trainer_data)
            return (jsonify({'message': 'Trainer created', 'id': doc_ref.id}), 201, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)
    
    # PUT /trainers/<id> - Update trainer (Admin only)
    if path.startswith('/trainers/') and request.method == 'PUT':
        # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            auth.verify_id_token(id_token)
        except:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        
        trainer_id = path.split('/')[-1]
        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            data = request.get_json()
            update_data = {
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            
            if 'name' in data:
                update_data['name'] = data['name']
            if 'status' in data:
                update_data['status'] = data['status']
            if 'dualRecordingRequired' in data:
                update_data['dualRecordingRequired'] = data['dualRecordingRequired']
            
            db.collection('trainers').document(trainer_id).update(update_data)
            return (jsonify({'message': 'Trainer updated'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)
    
    # DELETE /trainers/<id> - Delete trainer (Admin only)
    if path.startswith('/trainers/') and request.method == 'DELETE':
        # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            auth.verify_id_token(id_token)
        except:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        
        trainer_id = path.split('/')[-1]
        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            db.collection('trainers').document(trainer_id).delete()
            return (jsonify({'message': 'Trainer deleted'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)
    
    # POST /trainers/request - Request trainer approval (User)
    if path == '/trainers/request' and request.method == 'POST':
        # Verify Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            decoded_token = auth.verify_id_token(id_token)
            uid = decoded_token['uid']
        except:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        
        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            data = request.get_json()
            trainer_name = data.get('trainerName')
            requester_name = data.get('requesterName', '')
            
            if not trainer_name:
                return (jsonify({'message': 'Trainer name is required'}), 400, headers)
            
            request_data = {
                'trainerName': trainer_name,
                'requesterName': requester_name,
                'requesterUid': uid,
                'status': 'pending',
                'createdAt': firestore.SERVER_TIMESTAMP
            }
            
            _, doc_ref = db.collection('trainer_requests').add(request_data)
            return (jsonify({'message': 'Trainer approval request submitted', 'id': doc_ref.id}), 201, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)
    
    # GET /trainers/requests - Get all trainer requests (Admin only)
    if path == '/trainers/requests' and request.method == 'GET':
        # Verify Admin Auth
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
            requests_ref = db.collection('trainer_requests').order_by('createdAt', direction=firestore.Query.DESCENDING)
            docs = requests_ref.stream()
            
            requests = []
            for doc in docs:
                request_data = doc.to_dict()
                request_data['id'] = doc.id
                # Convert timestamp to milliseconds
                if 'createdAt' in request_data and request_data['createdAt']:
                    request_data['createdAt'] = int(request_data['createdAt'].timestamp() * 1000)
                requests.append(request_data)
            
            return (jsonify({'requests': requests}), 200, headers)
        except Exception as e:
            print(f"Error fetching trainer requests: {e}")
            return (jsonify({'message': str(e)}), 500, headers)
    
    # POST /trainers/requests/<id>/approve - Approve trainer request (Admin only)
    if path.startswith('/trainers/requests/') and path.endswith('/approve') and request.method == 'POST':
        # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            auth.verify_id_token(id_token)
        except:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        
        request_id = path.split('/')[-2]
        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            data = request.get_json()
            dual_recording_required = data.get('dualRecordingRequired', False)
            
            # Get the request
            request_doc = db.collection('trainer_requests').document(request_id).get()
            if not request_doc.exists:
                return (jsonify({'message': 'Request not found'}), 404, headers)
            
            request_data = request_doc.to_dict()
            trainer_name = request_data.get('trainerName')
            
            # Create the trainer as approved
            trainer_data = {
                'name': trainer_name,
                'status': 'approved',
                'dualRecordingRequired': dual_recording_required,
                'createdAt': firestore.SERVER_TIMESTAMP,
                'updatedAt': firestore.SERVER_TIMESTAMP
            }
            db.collection('trainers').add(trainer_data)
            
            # Update request status
            db.collection('trainer_requests').document(request_id).update({
                'status': 'approved',
                'approvedAt': firestore.SERVER_TIMESTAMP
            })
            
            return (jsonify({'message': 'Trainer approved and added'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)
    
    # POST /trainers/requests/<id>/reject - Reject trainer request (Admin only)
    if path.startswith('/trainers/requests/') and path.endswith('/reject') and request.method == 'POST':
        # Verify Admin Auth
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        try:
            id_token = auth_header.split('Bearer ')[1]
            auth.verify_id_token(id_token)
        except:
            return (jsonify({'message': 'Unauthorized'}), 401, headers)
        
        request_id = path.split('/')[-2]
        if not db:
            return (jsonify({'error': 'DB not available'}), 500, headers)
        
        try:
            # Update request status
            db.collection('trainer_requests').document(request_id).update({
                'status': 'rejected',
                'rejectedAt': firestore.SERVER_TIMESTAMP
            })
            
            return (jsonify({'message': 'Trainer request rejected'}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # --- CLUBS LIST ---
    if path == '/clubs' and request.method == 'GET':
        try:
            import requests
            from bs4 import BeautifulSoup
            
            # Fetch the DCU clubs page
            response = requests.get('https://dcumedlem.sportstiming.dk/clubs', timeout=10)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find the table with clubs
            table = soup.find('table')
            if not table:
                return (jsonify({'message': 'Could not find clubs table'}), 500, headers)
            
            clubs = []
            # Parse table rows (skip header)
            rows = table.find_all('tr')[1:]  # Skip header row
            
            for row in rows:
                cols = row.find_all('td')
                if len(cols) >= 3:
                    club_name = cols[0].get_text(strip=True)
                    district = cols[1].get_text(strip=True)
                    club_type = cols[2].get_text(strip=True)
                    
                    clubs.append({
                        'name': club_name,
                        'district': district,
                        'type': club_type
                    })
            
            return (jsonify({'clubs': clubs}), 200, headers)
        except Exception as e:
            print(f"Error fetching clubs: {e}")
            return (jsonify({'message': f'Failed to fetch clubs: {str(e)}'}), 500, headers)

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
                    'club': data.get('club', ''),
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

    # --- ADMIN: TEST DATA SEED ENDPOINTS ---
    
    # GET /admin/seed/stats - Get count of test participants
    if path == '/admin/seed/stats' and request.method == 'GET':
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
            # Count test participants
            users_ref = db.collection('users').where('isTestData', '==', True)
            docs = list(users_ref.stream())
            count = len(docs)
            return (jsonify({'testParticipantCount': count}), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # POST /admin/seed/participants - Create test participants
    if path == '/admin/seed/participants' and request.method == 'POST':
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
            import random
            
            req_data = request.get_json(silent=True) or {}
            count = req_data.get('count', 20)
            
            # Danish-style first and last names for realistic test data
            first_names = [
                'Magnus', 'Oliver', 'William', 'Noah', 'Lucas', 'Oscar', 'Carl', 'Victor',
                'Malthe', 'Alfred', 'Emil', 'Aksel', 'Valdemar', 'August', 'Frederik',
                'Emma', 'Ida', 'Clara', 'Freja', 'Alma', 'Ella', 'Sofia', 'Anna',
                'Laura', 'Karla', 'Mathilde', 'Agnes', 'Lily', 'Josefine', 'Alberte'
            ]
            last_names = [
                'Nielsen', 'Jensen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen',
                'Larsen', 'Sørensen', 'Rasmussen', 'Petersen', 'Madsen', 'Kristensen',
                'Olsen', 'Thomsen', 'Christiansen', 'Poulsen', 'Johansen', 'Knudsen',
                'Mortensen', 'Møller'
            ]
            clubs = [
                'Aarhus Cykle Ring', 'Team Biciklet', 'Odense Cykel Club', 
                'Copenhagen Cycling', 'Roskilde CK', 'Aalborg CK', 'Test Club'
            ]
            
            # Find highest existing test ID to avoid collisions
            existing_test = db.collection('users').where('isTestData', '==', True).stream()
            max_id = 0
            for doc in existing_test:
                data = doc.to_dict()
                e_lic = data.get('eLicense', '')
                if e_lic.startswith('TEST-'):
                    try:
                        num = int(e_lic.split('-')[1])
                        if num > max_id:
                            max_id = num
                    except:
                        pass
            
            created = []
            for i in range(count):
                idx = max_id + i + 1
                e_license = f"TEST-{idx:04d}"
                zwift_id = f"999{idx:04d}"
                name = f"{random.choice(first_names)} {random.choice(last_names)}"
                club = random.choice(clubs)
                
                user_data = {
                    'eLicense': e_license,
                    'zwiftId': zwift_id,
                    'name': name,
                    'club': club,
                    'isTestData': True,
                    'registrationComplete': True,
                    'verified': True,
                    'createdAt': firestore.SERVER_TIMESTAMP
                }
                
                db.collection('users').document(e_license).set(user_data)
                created.append({'eLicense': e_license, 'name': name, 'zwiftId': zwift_id})
            
            return (jsonify({
                'message': f'Created {len(created)} test participants',
                'participants': created
            }), 201, headers)
        except Exception as e:
            print(f"Seed participants error: {e}")
            return (jsonify({'message': str(e)}), 500, headers)

    # DELETE /admin/seed/participants - Clear test participants
    if path == '/admin/seed/participants' and request.method == 'DELETE':
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
            # Find and delete all test participants
            users_ref = db.collection('users').where('isTestData', '==', True)
            docs = list(users_ref.stream())
            
            deleted_count = 0
            for doc in docs:
                doc.reference.delete()
                deleted_count += 1
            
            return (jsonify({
                'message': f'Deleted {deleted_count} test participants'
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    # POST /admin/seed/results - Generate test results for races
    if path == '/admin/seed/results' and request.method == 'POST':
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
            import random
            
            req_data = request.get_json(silent=True) or {}
            race_ids = req_data.get('raceIds', [])
            progress = req_data.get('progress', 100)  # 0-100
            category_riders = req_data.get('categoryRiders', {})  # {"A": 5, "B": 8, ...}
            
            if not race_ids:
                return (jsonify({'message': 'No race IDs provided'}), 400, headers)
            
            # Fetch test participants from database
            test_users_ref = db.collection('users').where('isTestData', '==', True)
            test_users_docs = list(test_users_ref.stream())
            test_participants = []
            for doc in test_users_docs:
                data = doc.to_dict()
                test_participants.append({
                    'zwiftId': data.get('zwiftId'),
                    'name': data.get('name'),
                    'eLicense': data.get('eLicense')
                })
            
            # If no test participants exist, create temporary ones
            if len(test_participants) == 0:
                print("No test participants found, generating temporary names")
                first_names = ['Magnus', 'Oliver', 'William', 'Noah', 'Lucas', 'Oscar', 'Carl', 'Victor',
                              'Emma', 'Ida', 'Clara', 'Freja', 'Alma', 'Ella', 'Sofia', 'Anna']
                last_names = ['Nielsen', 'Jensen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen',
                             'Larsen', 'Sørensen', 'Rasmussen', 'Petersen', 'Madsen', 'Kristensen']
                for i in range(100):
                    test_participants.append({
                        'zwiftId': f"999{i:04d}",
                        'name': f"{random.choice(first_names)} {random.choice(last_names)}",
                        'eLicense': f"TEMP-{i:04d}"
                    })
            
            results_generated = {}
            processor = ResultsProcessor(db, None, None)
            
            for race_id in race_ids:
                race_doc = db.collection('races').document(race_id).get()
                if not race_doc.exists:
                    continue
                
                race_data = race_doc.to_dict()
                
                # Determine categories for this race
                categories = []
                category_configs = {}  # Store sprint config per category
                
                if race_data.get('eventMode') == 'multi' and race_data.get('eventConfiguration'):
                    # Multi-mode: use custom categories
                    for cfg in race_data['eventConfiguration']:
                        cat = cfg.get('customCategory')
                        if cat:
                            categories.append(cat)
                            category_configs[cat] = {
                                'sprints': cfg.get('sprints', []),
                                'segmentType': cfg.get('segmentType') or race_data.get('segmentType', 'sprint'),
                                'laps': cfg.get('laps') or race_data.get('laps', 1)
                            }
                elif race_data.get('singleModeCategories') and len(race_data['singleModeCategories']) > 0:
                    # Single mode with custom categories
                    for cfg in race_data['singleModeCategories']:
                        cat = cfg.get('category')
                        if cat:
                            categories.append(cat)
                            category_configs[cat] = {
                                'sprints': cfg.get('sprints', []),
                                'segmentType': cfg.get('segmentType') or race_data.get('segmentType', 'sprint'),
                                'laps': cfg.get('laps') or race_data.get('laps', 1)
                            }
                else:
                    # Standard mode: A, B, C, D, E
                    categories = ['A', 'B', 'C', 'D', 'E']
                    global_sprints = race_data.get('sprints', [])
                    for cat in categories:
                        category_configs[cat] = {
                            'sprints': global_sprints,
                            'segmentType': race_data.get('segmentType', 'sprint'),
                            'laps': race_data.get('laps', 1)
                        }
                
                race_results = {}
                
                # RANDOMIZE: Shuffle participants differently for each race
                shuffled_participants = test_participants.copy()
                random.shuffle(shuffled_participants)
                participant_index = 0
                
                for category in categories:
                    rider_count = category_riders.get(category, 5)  # Default 5 per category
                    if rider_count <= 0:
                        continue
                    
                    cat_config = category_configs.get(category, {})
                    sprints = cat_config.get('sprints', [])
                    
                    # Get riders for this category from shuffled pool
                    category_riders_list = []
                    for _ in range(rider_count):
                        if participant_index < len(shuffled_participants):
                            category_riders_list.append(shuffled_participants[participant_index])
                            participant_index += 1
                        else:
                            # Wrap around if we run out
                            participant_index = 0
                            category_riders_list.append(shuffled_participants[participant_index])
                            participant_index += 1
                    
                    # RANDOMIZE: Shuffle the order within category for finish positions
                    random.shuffle(category_riders_list)
                    
                    category_results = []
                    
                    # Pre-compute sprint orderings for each sprint (unique positions per sprint)
                    # We use worldTime to determine sprint order (lower = earlier = better)
                    sprint_orderings = {}  # sprint_key -> {zwiftId: order_index}
                    if sprints and len(sprints) > 0:
                        sprints_complete = max(1, int((progress / 100) * len(sprints))) if progress > 0 else 0
                        
                        for s_idx, sprint in enumerate(sprints[:sprints_complete]):
                            sprint_key = sprint.get('key') or f"{sprint.get('id')}_{sprint.get('count', 1)}"
                            # Create a random ordering for this sprint (different from finish order)
                            sprint_order = category_riders_list.copy()
                            random.shuffle(sprint_order)
                            sprint_orderings[sprint_key] = {
                                rider['zwiftId']: order_idx 
                                for order_idx, rider in enumerate(sprint_order)
                            }
                    
                    # Base finish time (randomized per category)
                    base_time_ms = random.randint(1800000, 3600000)  # 30-60 minutes
                    # Base world time for sprints (timestamp in ms)
                    base_world_time = 1700000000000
                    
                    for rank, rider in enumerate(category_riders_list, 1):
                        rider_name = rider['name']
                        zwift_id = rider['zwiftId']
                        
                        # Calculate finish time with some variance
                        time_variance = random.randint(5000, 30000) * rank  # Random gap between positions
                        finish_time = base_time_ms + time_variance
                        
                        # Determine if this rider has finished based on progress
                        finisher_threshold = (progress / 100) * rider_count
                        has_finished = rank <= finisher_threshold
                        
                        # For incomplete races, mark unfinished riders with 0 time
                        if not has_finished:
                            finish_time = 0
                        
                        # Generate RAW sprint data (times only, no points)
                        # Points will be calculated by ResultsProcessor
                        sprint_data = {}
                        
                        if sprints and len(sprints) > 0:
                            sprints_complete = max(1, int((progress / 100) * len(sprints))) if progress > 0 else 0
                            
                            for s_idx, sprint in enumerate(sprints[:sprints_complete]):
                                sprint_key = sprint.get('key') or f"{sprint.get('id')}_{sprint.get('count', 1)}"
                                
                                # Get this rider's order for this sprint (0 = first/fastest)
                                sprint_order = sprint_orderings.get(sprint_key, {}).get(zwift_id, rank - 1)
                                
                                # WorldTime determines ranking (lower = faster through segment)
                                # Add sprint index offset so later sprints have later times
                                sprint_world_time = base_world_time + (s_idx * 600000) + (sprint_order * random.randint(2000, 8000))
                                sprint_elapsed = random.randint(30000, 120000)  # 30-120s random segment time
                                
                                sprint_data[sprint_key] = {
                                    'worldTime': sprint_world_time,
                                    'time': sprint_elapsed,
                                    'avgPower': random.randint(200, 400)
                                    # Note: No 'rank' or points here - processor will calculate them
                                }
                        
                        # Create RAW rider result (no points calculated)
                        # Points will be calculated by recalculate_race_points()
                        rider_result = {
                            'zwiftId': zwift_id,
                            'name': rider_name,
                            'finishTime': finish_time,
                            'finishRank': 0,  # Will be calculated by processor
                            'finishPoints': 0,  # Will be calculated by processor
                            'sprintPoints': 0,  # Will be calculated by processor
                            'totalPoints': 0,  # Will be calculated by processor
                            'sprintDetails': {},  # Will be populated by processor
                            'sprintData': sprint_data,  # Raw timing data for processor
                            'flaggedCheating': False,
                            'flaggedSandbagging': False,
                            'disqualified': False,
                            'declassified': False,
                            'isTestData': True
                        }
                        
                        category_results.append(rider_result)
                    
                    # Sort by finish time for initial order (non-finishers at end)
                    category_results.sort(key=lambda x: x['finishTime'] if x['finishTime'] > 0 else 999999999999)
                    race_results[category] = category_results
                
                # Save RAW results to race document
                db.collection('races').document(race_id).update({
                    'results': race_results,
                    'resultsUpdatedAt': firestore.SERVER_TIMESTAMP
                })
                
                # Use the REAL points calculator to calculate all points
                # This validates that the scoring logic works correctly
                try:
                    calculated_results = processor.recalculate_race_points(race_id)
                    results_generated[race_id] = {
                        'categories': list(calculated_results.keys()),
                        'totalRiders': sum(len(r) for r in calculated_results.values())
                    }
                except Exception as e:
                    print(f"Error calculating points for race {race_id}: {e}")
                    results_generated[race_id] = {
                        'categories': list(race_results.keys()),
                        'totalRiders': sum(len(r) for r in race_results.values()),
                        'error': str(e)
                    }
            
            return (jsonify({
                'message': f'Generated test results for {len(results_generated)} races',
                'results': results_generated
            }), 200, headers)
        except Exception as e:
            print(f"Seed results error: {e}")
            return (jsonify({'message': str(e)}), 500, headers)

    # DELETE /admin/seed/results - Clear test results
    if path == '/admin/seed/results' and request.method == 'DELETE':
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
            req_data = request.get_json(silent=True) or {}
            race_ids = req_data.get('raceIds', [])  # Empty = clear all
            
            cleared_count = 0
            
            if race_ids:
                # Clear specific races
                for race_id in race_ids:
                    db.collection('races').document(race_id).update({
                        'results': firestore.DELETE_FIELD
                    })
                    cleared_count += 1
            else:
                # Clear all races
                races_ref = db.collection('races')
                docs = races_ref.stream()
                for doc in docs:
                    doc.reference.update({
                        'results': firestore.DELETE_FIELD
                    })
                    cleared_count += 1
            
            # Recalculate standings (will be empty/updated)
            try:
                processor = ResultsProcessor(db, None, None)
                processor.save_league_standings()
            except Exception as e:
                print(f"Error updating standings after clear: {e}")
            
            return (jsonify({
                'message': f'Cleared results from {cleared_count} races'
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    return ('Not Found', 404, headers)
