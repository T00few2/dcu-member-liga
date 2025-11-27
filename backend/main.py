import functions_framework
from flask import jsonify
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import os

# Initialize Firebase Admin
# For production (Google Cloud Functions), it uses Application Default Credentials automatically.
# For local development, we check for a service account key file.
try:
    if not firebase_admin._apps:
        cred_path = 'serviceAccountKey.json'
        if os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        else:
            # Fallback to default credentials (works in GCP environment)
            firebase_admin.initialize_app()
            
    db = firestore.client()
except Exception as e:
    print(f"Warning: Firebase could not be initialized. Database operations will fail. Error: {e}")
    db = None

@functions_framework.http
def dcu_api(request):
    # Set CORS headers for the preflight request
    if request.method == 'OPTIONS':
        headers = {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Access-Control-Max-Age': '3600'
        }
        return ('', 204, headers)

    # Set CORS headers for the main request
    headers = {
        'Access-Control-Allow-Origin': '*'
    }

    path = request.path

    if path == '/signup' and request.method == 'POST':
        try:
            request_json = request.get_json(silent=True)
            if not request_json:
                 return (jsonify({'message': 'Invalid JSON'}), 400, headers)
            
            e_license = request_json.get('eLicense')
            name = request_json.get('name')
            
            if not e_license or not name:
                return (jsonify({'message': 'Missing eLicense or name'}), 400, headers)

            # TODO: Verify e-license with DCU API (mock for now)
            
            # Save user to Firestore
            if db:
                doc_ref = db.collection('users').document(str(e_license))
                doc_ref.set({
                    'name': name,
                    'eLicense': e_license,
                    'verified': True, # Assume verified for now
                    'createdAt': firestore.SERVER_TIMESTAMP
                })
                print(f"Saved user {name} ({e_license}) to Firestore.")
            else:
                print("Database not connected. Skipping save.")
            
            return (jsonify({
                'message': 'Signup successful',
                'verified': True,
                'user': {'name': name, 'eLicense': e_license}
            }), 200, headers)
        except Exception as e:
            print(f"Error in signup: {e}")
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/stats' and request.method == 'GET':
        # Example: Fetch stats from Firestore or return mock
        stats_data = {
            'stats': [
                {'platform': 'Zwift', 'ftp': 250, 'level': 35},
                {'platform': 'ZwiftPower', 'category': 'B'},
                {'platform': 'Strava', 'kmsThisYear': 5000}
            ]
        }
        return (jsonify(stats_data), 200, headers)

    return ('Not Found', 404, headers)
