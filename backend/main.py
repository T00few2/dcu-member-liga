import functions_framework
from flask import jsonify
import firebase_admin
from firebase_admin import credentials
from firebase_admin import firestore
import os

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

    # Handle preflight requests
    if request.method == 'OPTIONS':
        return ('', 204, headers)

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

            # Save to Firestore
            if db:
                doc_ref = db.collection('users').document(str(e_license))
                doc_ref.set({
                    'name': name,
                    'eLicense': e_license,
                    'verified': True,
                    'createdAt': firestore.SERVER_TIMESTAMP
                })
            
            return (jsonify({
                'message': 'Signup successful',
                'verified': True,
                'user': {'name': name, 'eLicense': e_license}
            }), 200, headers)
        except Exception as e:
            return (jsonify({'message': str(e)}), 500, headers)

    if path == '/stats' and request.method == 'GET':
        # Live backend data (distinct from frontend mock)
        stats_data = {
            'stats': [
                {'platform': 'Zwift (Backend)', 'ftp': 300, 'level': 50},
                {'platform': 'ZwiftPower', 'category': 'A+'},
                {'platform': 'Strava', 'kmsThisYear': 9999}
            ]
        }
        return (jsonify(stats_data), 200, headers)

    return ('Not Found', 404, headers)
