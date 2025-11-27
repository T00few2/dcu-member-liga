import functions_framework
from flask import jsonify, redirect, request
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import os
from services.strava import StravaService
from services.zwiftpower import ZwiftPowerService
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

# Initialize Services
strava_service = StravaService(db)
zp_service = ZwiftPowerService(ZWIFT_USERNAME, ZWIFT_PASSWORD)

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

    # --- ZWIFTPOWER ROUTES ---

    if path == '/zwiftpower/team_analysis' and request.method == 'GET':
        club_id = request.args.get('club_id')
        search = request.args.get('search', '') # Optional search filter
        
        if not club_id:
            return (jsonify({'message': 'Missing club_id'}), 400, headers)
            
        try:
            # Login on demand
            zp_service.login()
            
            if search:
                # Use the filter function if search term provided
                results = zp_service.filter_events_by_title(int(club_id), search)
                return (jsonify(results), 200, headers)
            else:
                # Just return raw team results if no search query
                # (Since analyze_team_results was removed)
                results = zp_service.get_team_results(int(club_id))
                return (jsonify(results), 200, headers)
                
        except Exception as e:
            return (jsonify({'message': f'ZwiftPower Error: {str(e)}'}), 500, headers)

    # --- CORE ROUTES ---

    if path == '/signup' and request.method == 'POST':
        try:
            request_json = request.get_json(silent=True)
            if not request_json:
                 return (jsonify({'message': 'Invalid JSON'}), 400, headers)
            
            e_license = request_json.get('eLicense')
            name = request_json.get('name')
            
            if not e_license or not name:
                return (jsonify({'message': 'Missing eLicense or name'}), 400, headers)

            if db:
                doc_ref = db.collection('users').document(str(e_license))
                doc_ref.set({
                    'name': name,
                    'eLicense': e_license,
                    'verified': True,
                    'createdAt': firestore.SERVER_TIMESTAMP
                }, merge=True)
            
            return (jsonify({
                'message': 'Signup successful',
                'verified': True,
                'user': {'name': name, 'eLicense': e_license}
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/stats' and request.method == 'GET':
        e_license = request.args.get('eLicense')
        
        # Fetch stats from services
        strava_data = strava_service.get_activities(e_license)
        
        stats_data = {
            'stats': [
                {'platform': 'Zwift (Backend)', 'ftp': 300, 'level': 50},
                {'platform': 'ZwiftPower', 'category': 'A+'},
                {
                    'platform': 'Strava', 
                    'kms': strava_data['kms'],
                    'activities': strava_data['activities']
                }
            ]
        }
        return (jsonify(stats_data), 200, headers)

    return ('Not Found', 404, headers)
