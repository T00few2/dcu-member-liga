
import firebase_admin
from firebase_admin import credentials, firestore
import os
import sys
from datetime import datetime

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

def clean_user_consents(zwift_id):
    print(f"--- Cleaning consents for ZwiftID: {zwift_id} ---")
    
    user_ref = db.collection('users').document(str(zwift_id))
    user_doc = user_ref.get()
    
    if not user_doc.exists:
        print("User not found.")
        return

    data = user_doc.to_dict()
    registration = data.get('registration', {})
    
    # Check if we have root level data to migrate
    root_policy = data.get('dataPolicy', {})
    root_public = data.get('publicResultsConsent', {})
    
    root_policy_ver = root_policy.get('version')
    root_public_ver = root_public.get('version')
    
    reg_policy_ver = registration.get('dataPolicy', {}).get('version')
    
    updates = {}
    needs_update = False
    
    # 1. Consolidate to Registration Group
    # Prefer root version if registration is null (which is the case for this user)
    new_data_policy = registration.get('dataPolicy', {})
    if not reg_policy_ver and root_policy_ver:
        print(f"  Migrating Data Policy v{root_policy_ver} from root to registration.")
        new_data_policy['version'] = root_policy_ver
        new_data_policy['acceptedAt'] = root_policy.get('acceptedAt')
        updates['registration.dataPolicy'] = new_data_policy
        needs_update = True
        
    new_public_consent = registration.get('publicResultsConsent', {})
    reg_public_ver = new_public_consent.get('version')
    if not reg_public_ver and root_public_ver:
        print(f"  Migrating Public Consent v{root_public_ver} from root to registration.")
        new_public_consent['version'] = root_public_ver
        new_public_consent['acceptedAt'] = root_public.get('acceptedAt')
        updates['registration.publicResultsConsent'] = new_public_consent
        needs_update = True

    # 2. Cleanup Root Fields (Delete them)
    # We use firestore.DELETE_FIELD
    if 'dataPolicy' in data:
        print("  Marking root 'dataPolicy' for deletion.")
        updates['dataPolicy'] = firestore.DELETE_FIELD
        needs_update = True
        
    if 'publicResultsConsent' in data:
        print("  Marking root 'publicResultsConsent' for deletion.")
        updates['publicResultsConsent'] = firestore.DELETE_FIELD
        needs_update = True
        
    if 'acceptedDataPolicy' in data:
        print("  Marking root 'acceptedDataPolicy' for deletion.")
        updates['acceptedDataPolicy'] = firestore.DELETE_FIELD
        needs_update = True
        
    if 'acceptedPublicResults' in data:
        print("  Marking root 'acceptedPublicResults' for deletion.")
        updates['acceptedPublicResults'] = firestore.DELETE_FIELD
        needs_update = True

    if needs_update:
        print("Applying updates...")
        user_ref.update(updates)
        print("Done.")
    else:
        print("No updates needed.")

if __name__ == "__main__":
    # Target the specific user first
    clean_user_consents('15690')
