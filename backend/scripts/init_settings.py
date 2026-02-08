
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

def init_settings():
    print("--- Initializing League Settings ---")
    
    settings_ref = db.collection('league').document('settings')
    settings_doc = settings_ref.get()
    
    updates = {
        'dataPolicyVersion': '2026-02-04',
        'publicResultsConsentVersion': '2026-02-03'
    }
    
    if settings_doc.exists:
        print(f"Updating existing settings: {updates}")
        settings_ref.set(updates, merge=True)
    else:
        print(f"Creating new settings: {updates}")
        settings_ref.set(updates)
        
    print("Settings updated successfully.")

if __name__ == "__main__":
    init_settings()
