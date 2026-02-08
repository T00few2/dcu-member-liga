import firebase_admin
from firebase_admin import credentials, firestore
import argparse
import sys

def _init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate('backend/serviceAccountKey.json')
        firebase_admin.initialize_app(cred)

def diagnose(db):
    print("--- User Diagnosis ---")
    users = db.collection('users').stream()
    
    issues_found = 0
    
    for user_doc in users:
        uid = user_doc.to_dict().get('authUid') or user_doc.to_dict().get('uid')
        doc_id = user_doc.id
        
        # Heuristic: Is doc_id a UID? (28 chars)
        is_uid_key = len(doc_id) == 28
        
        # Get Mapping
        mapping = None
        if uid:
            m_doc = db.collection('auth_mappings').document(uid).get()
            if m_doc.exists:
                mapping = m_doc.to_dict()
                
        # Scenarios
        # 1. Mapped to ZwiftID, but Doc is UID
        if mapping and mapping.get('zwiftId'):
            mapped_target = str(mapping.get('zwiftId'))
            if mapped_target != doc_id:
                # Mapping points elsewhere. Does that target exist?
                target_doc = db.collection('users').document(mapped_target).get()
                if not target_doc.exists:
                    print(f"[BROKEN] User {user_doc.to_dict().get('name')} (UID: {uid})")
                    print(f"  - Document is at: {doc_id}")
                    print(f"  - Mapping points to: {mapped_target} (ZwiftID)")
                    print(f"  - Target doc {mapped_target} DOES NOT EXIST.")
                    print(f"  -> RECOMMENDED FIX: Run 'migrate_users.py' to move data from {doc_id} to {mapped_target}.")
                    issues_found += 1
                else:
                    print(f"[DUPLICATE?] User {user_doc.to_dict().get('name')} (UID: {uid})")
                    print(f"  - Document is at: {doc_id}")
                    print(f"  - Mapping points to: {mapped_target} (ZwiftID)")
                    print(f"  - Target doc {mapped_target} EXISTS.")
                    print(f"  -> WARNING: You have two records for this user!")
                    issues_found += 1
        
        # 2. No Mapping or No ZwiftID in Mapping, but Doc is ZwiftID (Actually this is fine usually, but let's check)
        
    if issues_found == 0:
        print("No obvious broken links found in 'users' scan.")
        
    print("\n--- Mapping Scan ---")
    # Reverse check: Iterate mappings
    mappings = db.collection('auth_mappings').stream()
    for m in mappings:
        uid = m.id
        data = m.to_dict()
        zwift_id = data.get('zwiftId')
        
        if zwift_id:
             u_doc = db.collection('users').document(str(zwift_id)).get()
             if not u_doc.exists:
                 # Check if they exist under UID
                 uid_doc = db.collection('users').document(uid).get()
                 if uid_doc.exists:
                     print(f"[MISMATCH] Mapping {uid} -> {zwift_id}, but Doc is at {uid}")
                     print(f"  -> RECOMMENDED FIX: Run 'migrate_users.py' to re-key user.")
                 else:
                     print(f"[GHOST] Mapping {uid} -> {zwift_id}, but no user doc found anywhere.")

if __name__ == "__main__":
    _init_firebase()
    db = firestore.client()
    diagnose(db)
