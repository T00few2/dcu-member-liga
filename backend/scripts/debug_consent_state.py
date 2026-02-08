
import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys

# Setup Firebase
if not firebase_admin._apps:
    cred_path = os.getenv('GOOGLE_APPLICATION_CREDENTIALS')
    if not cred_path:
        # Fallback to local key if not in env
        cred_path = 'backend/serviceAccountKey.json'
    
    if os.path.exists(cred_path):
        cred = credentials.Certificate(cred_path)
        firebase_admin.initialize_app(cred)
    else:
        print(f"Error: Credentials not found at {cred_path}")
        sys.exit(1)

db = firestore.client()

UID = 'yuiRDPWFQMNf3LU8s5B5l1PZkNS2'
ZWIFT_ID = '190507'

def debug_state():
    print(f"--- Debugging Consent State for UID: {UID}, ZwiftID: {ZWIFT_ID} ---")
    
    # 1. League Settings (Source of Truth)
    print("\n[1] League Settings (league/settings):")
    settings_doc = db.collection('league').document('settings').get()
    if settings_doc.exists:
        s_data = settings_doc.to_dict()
        print(f"  - dataPolicyVersion: {s_data.get('dataPolicyVersion')}")
        print(f"  - publicResultsConsentVersion: {s_data.get('publicResultsConsentVersion')}")
    else:
        print("  - Document NOT FOUND!")

    # 2. Auth Mapping
    print(f"\n[2] Auth Mapping (auth_mappings/{UID}):")
    mapping_doc = db.collection('auth_mappings').document(UID).get()
    if mapping_doc.exists:
        m_data = mapping_doc.to_dict()
        print(f"  - zwiftId: {m_data.get('zwiftId')}")
        print(f"  - eLicense: {m_data.get('eLicense')}")
        
        target_id = m_data.get('zwiftId') or m_data.get('eLicense') or UID
        print(f"  -> Maps directly to: {target_id}")
    else:
        print("  - Document NOT FOUND!")

    # 3. User Document (190507)
    print(f"\n[3] User Document (users/{ZWIFT_ID}):")
    user_doc = db.collection('users').document(ZWIFT_ID).get()
    if user_doc.exists:
        u_data = user_doc.to_dict()
        print(f"  - acceptedDataPolicy: {u_data.get('acceptedDataPolicy')}")
        print(f"  - dataPolicyVersion (User Has): {u_data.get('dataPolicyVersion')}")
        print(f"  - acceptedPublicResults: {u_data.get('acceptedPublicResults')}")
        print(f"  - publicResultsConsentVersion (User Has): {u_data.get('publicResultsConsentVersion')}")
    else:
        print("  - Document NOT FOUND!")

    # 4. User Document (UID - if split brain?)
    if UID != ZWIFT_ID:
        print(f"\n[4] User Document (users/{UID}) [Looking for Split Brain]:")
        uid_doc = db.collection('users').document(UID).get()
        if uid_doc.exists:
            uid_data = uid_doc.to_dict()
            print(f"  - acceptedDataPolicy: {uid_data.get('acceptedDataPolicy')}")
            print(f"  - dataPolicyVersion (User Has): {uid_data.get('dataPolicyVersion')}")
        else:
            print("  - Document NOT FOUND (Which is good!)")

if __name__ == "__main__":
    debug_state()
