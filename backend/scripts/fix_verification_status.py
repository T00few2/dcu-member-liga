
import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys

# Setup Firebase
if not firebase_admin._apps:
    cred_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if not cred_path:
        cred_path = 'backend/serviceAccountKey.json'
    
    if os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    else:
        print(f"Error: Credentials not found at {cred_path}")
        sys.exit(1)

db = firestore.client()

def fix_status(zwift_id):
    print(f"--- Fixing Status for: {zwift_id} ---")
    user_ref = db.collection('users').document(str(zwift_id))
    user_doc = user_ref.get()
    
    if not user_doc.exists:
        print("User not found.")
        return

    data = user_doc.to_dict()
    ver = data.get('verification', {})
    
    if not ver.get('status'):
        current_req = ver.get('currentRequest', {})
        if current_req.get('status') == 'approved':
            print("  status is missing, but currentRequest is approved. Fixing status -> approved")
            user_ref.update({'verification.status': 'approved'})
        elif current_req.get('status') == 'rejected':
             print("  status is missing, but currentRequest is rejected. Fixing status -> rejected")
             user_ref.update({'verification.status': 'rejected'})
        else:
            print(f"  status is missing, currentRequest status: {current_req.get('status')}")
    else:
        print(f"  status is present: {ver.get('status')}")

if __name__ == "__main__":
    fix_status('15690')
