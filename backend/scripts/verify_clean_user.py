
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

def verify_user(zwift_id):
    print(f"--- Checking User Schema for: {zwift_id} ---")
    user_doc = db.collection('users').document(str(zwift_id)).get()
    
    if not user_doc.exists:
        print("User not found.")
        return

    data = user_doc.to_dict()
    
    # Check for Root Verification Fields (Should be None)
    print(f"Root.weightVerificationStatus: {data.get('weightVerificationStatus')}")
    print(f"Root.verificationRequests: {data.get('verificationRequests')}")
    print(f"Root.weightVerificationVideoLink: {data.get('weightVerificationVideoLink')}")
    
    # Check Verification Group
    ver = data.get('verification', {})
    print(f"Verification.status: {ver.get('status')}")
    print(f"Verification.history count: {len(ver.get('history', []))}")
    print(f"Verification.currentRequest: {ver.get('currentRequest')}")

if __name__ == "__main__":
    verify_user('15690')
