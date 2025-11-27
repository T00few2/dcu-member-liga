import functions_framework
from flask import jsonify, redirect, request
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import os
import requests
from dotenv import load_dotenv

# Load environment variables from .env (for local dev)
load_dotenv()

# Configuration
STRAVA_CLIENT_ID = os.getenv('STRAVA_CLIENT_ID')
STRAVA_CLIENT_SECRET = os.getenv('STRAVA_CLIENT_SECRET')
# Dynamically set redirect URI based on environment
# In production, this should be your Cloud Function URL.
# Locally, it might be http://localhost:8080/strava/callback
BACKEND_URL = os.getenv('BACKEND_URL', 'https://us-central1-dcu-member-liga-479507.cloudfunctions.net/dcu_api') 

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

@functions_framework.http
def dcu_api(request):
    # CORS Headers
    headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Max-Age': '3600'
    }

    if request.method == 'OPTIONS':
        return ('', 204, headers)

    path = request.path

    # --- STRAVA AUTH ROUTES ---

    if path == '/strava/login' and request.method == 'GET':
        # Redirect user to Strava Authorization Page
        # We need to pass a 'state' parameter (e.g., user's eLicense) to link the account later
        e_license = request.args.get('eLicense')
        if not e_license:
             return (jsonify({'message': 'Missing eLicense param'}), 400, headers)

        redirect_uri = f"{BACKEND_URL}/strava/callback"
        scope = "read,activity:read_all" # Request permissions
        
        strava_url = (
            f"https://www.strava.com/oauth/authorize"
            f"?client_id={STRAVA_CLIENT_ID}"
            f"&response_type=code"
            f"&redirect_uri={redirect_uri}"
            f"&approval_prompt=force"
            f"&scope={scope}"
            f"&state={e_license}" 
        )
        return redirect(strava_url)

    if path == '/strava/callback' and request.method == 'GET':
        # Handle callback from Strava
        code = request.args.get('code')
        e_license = request.args.get('state') # We get back the eLicense we sent
        error = request.args.get('error')

        if error:
            return (jsonify({'message': f'Strava Error: {error}'}), 400, headers)
        
        if not code or not e_license:
             return (jsonify({'message': 'Missing code or state'}), 400, headers)

        # Exchange code for tokens
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
                 return (jsonify({'message': 'Failed to get tokens', 'details': data}), 500, headers)
            
            # Save tokens to Firestore user document
            if db:
                user_ref = db.collection('users').document(str(e_license))
                user_ref.update({
                    'strava': {
                        'athlete_id': data['athlete']['id'],
                        'access_token': data['access_token'],
                        'refresh_token': data['refresh_token'],
                        'expires_at': data['expires_at']
                    }
                })
            
            # Redirect back to frontend success page
            # Hardcoded for POC, should be env var
            return redirect(f"https://dcu-member-liga.vercel.app/signup?strava=connected")

        except Exception as e:
             return (jsonify({'message': str(e)}), 500, headers)

    # --- EXISTING ROUTES ---

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
                }, merge=True) # Use merge to not overwrite existing data
            
            return (jsonify({
                'message': 'Signup successful',
                'verified': True,
                'user': {'name': name, 'eLicense': e_license}
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/stats' and request.method == 'GET':
        stats_data = {
            'stats': [
                {'platform': 'Zwift (Backend)', 'ftp': 300, 'level': 50},
                {'platform': 'ZwiftPower', 'category': 'A+'},
                {'platform': 'Strava', 'kmsThisYear': 9999}
            ]
        }
        return (jsonify(stats_data), 200, headers)

    return ('Not Found', 404, headers)
