
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

def fix_verification_data(zwift_id):
    print(f"--- Consolidating Verification Data for ZwiftID: {zwift_id} ---")
    
    user_ref = db.collection('users').document(str(zwift_id))
    user_doc = user_ref.get()
    
    if not user_doc.exists:
        print("User not found.")
        return

    data = user_doc.to_dict()
    
    # Check for root fields to migrate
    root_status = data.get('weightVerificationStatus')
    root_requests = data.get('verificationRequests')
    root_video = data.get('weightVerificationVideoLink')
    root_deadline = data.get('weightVerificationDeadline')
    
    verification = data.get('verification', {})
    
    updates = {}
    needs_update = False
    
    # 1. Migrate Status
    if root_status and not verification.get('status'):
        print(f"  Migrating status '{root_status}' to verification.status")
        updates['verification.status'] = root_status
        needs_update = True
        
    # 2. Migrate Requests (History)
    if root_requests and not verification.get('history'):
        print(f"  Migrating {len(root_requests)} requests to verification.history")
        updates['verification.history'] = root_requests
        needs_update = True
        
    # 3. Derive Current Request
    if not verification.get('currentRequest') and root_requests:
         # Find the most relevant request
         # If status is pending/submitted, find intended ones
         # If approved/rejected, find the one that matches
         
         target_status = root_status or 'none'
         candidates = [r for r in root_requests if r.get('status') == target_status]
         
         current_req = None
         if candidates:
             # Take the latest one based on requestedAt or reviewedAt?
             # Sort by requestedAt strings should work descending
             candidates.sort(key=lambda x: x.get('requestedAt', ''), reverse=True)
             current_req = candidates[0]
         elif root_requests:
             # Just take the latest one anyway
             root_requests.sort(key=lambda x: x.get('requestedAt', ''), reverse=True)
             current_req = root_requests[0]
             
         if current_req:
             print(f"  Setting verification.currentRequest based on history (ID: {current_req.get('requestId')})")
             updates['verification.currentRequest'] = current_req
             needs_update = True

    # 4. Cleanup Root Fields
    if 'weightVerificationStatus' in data:
        print("  Marking root 'weightVerificationStatus' for deletion.")
        updates['weightVerificationStatus'] = firestore.DELETE_FIELD
        needs_update = True
        
    if 'verificationRequests' in data:
        print("  Marking root 'verificationRequests' for deletion.")
        updates['verificationRequests'] = firestore.DELETE_FIELD
        needs_update = True
        
    if 'weightVerificationVideoLink' in data:
         print("  Marking root 'weightVerificationVideoLink' for deletion.")
         updates['weightVerificationVideoLink'] = firestore.DELETE_FIELD
         needs_update = True
         
    if 'weightVerificationDeadline' in data:
         print("  Marking root 'weightVerificationDeadline' for deletion.")
         updates['weightVerificationDeadline'] = firestore.DELETE_FIELD
         needs_update = True
         
    if 'weightVerificationDate' in data:
         print("  Marking root 'weightVerificationDate' for deletion.")
         updates['weightVerificationDate'] = firestore.DELETE_FIELD
         needs_update = True

    if needs_update:
        print("Applying updates...")
        user_ref.update(updates)
        print("Done.")
    else:
        print("No updates needed.")

if __name__ == "__main__":
    fix_verification_data('15690')
