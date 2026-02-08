import firebase_admin
from firebase_admin import credentials, firestore
import argparse
import sys

def _init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate('backend/serviceAccountKey.json')
        firebase_admin.initialize_app(cred)

def test_lookup(db, target_input):
    print(f"--- Simulation: Resolving Profile for '{target_input}' ---")
    
    # 1. Find the User Doc first (Cheating, to get the Expected UID)
    user_doc_ref = None
    if target_input.isdigit():
        user_doc_ref = db.collection('users').document(target_input)
    else:
        # Search by name
        docs = list(db.collection('users').where('name', '==', target_input).stream())
        if docs:
            user_doc_ref = docs[0].reference
            
    if not user_doc_ref or not user_doc_ref.get().exists:
        print(f"[ERROR] Could not find any user doc matching '{target_input}' to start the test.")
        return

    user_doc = user_doc_ref.get()
    user_data = user_doc.to_dict()
    doc_id = user_doc.id
    expected_uid = user_data.get('authUid') or user_data.get('uid')
    
    print(f"Target User Found: {user_data.get('name')}")
    print(f"  - Doc ID: {doc_id}")
    print(f"  - Stored UID: {expected_uid}")
    
    if not expected_uid:
        print("[FATAL] User doc has no authUid! Lookup will definitely fail.")
        return

    # 2. Simulate get_profile(uid)
    print(f"\n--- Simulating get_profile(uid='{expected_uid}') ---")
    
    # Logic from users.py
    mapping_doc = db.collection('auth_mappings').document(expected_uid).get()
    resolved_doc = None
    
    if mapping_doc.exists:
        m_data = mapping_doc.to_dict()
        print(f"  [STEP] Mapping Found: {m_data}")
        
        zwift_id = m_data.get('zwiftId')
        
        if not zwift_id:
             old_elicense = m_data.get('eLicense')
             if old_elicense:
                 print(f"  [STEP] Using old eLicense key: {old_elicense}")
                 resolved_doc = db.collection('users').document(str(old_elicense)).get()
             else:
                 print(f"  [STEP] Mapping exists but no keys. detailed fallback to UID.")
                 resolved_doc = db.collection('users').document(expected_uid).get()
        else:
             print(f"  [STEP] Using ZwiftID key: {zwift_id}")
             resolved_doc = db.collection('users').document(str(zwift_id)).get()
    else:
        print(f"  [STEP] No mapping found.")
        resolved_doc = db.collection('users').document(expected_uid).get()

    if resolved_doc and resolved_doc.exists:
        print(f"\n[SUCCESS] Resolved to User Document: {resolved_doc.id}")
        if resolved_doc.id == doc_id:
            print("  -> MATCHES expected document.")
        else:
            print(f"  -> MISMATCH! Expected {doc_id}, got {resolved_doc.id}")
    else:
        print("\n[FAILURE] Could not resolve user document.")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument('target', help='ZwiftID or Name of the user to test')
    args = parser.parse_args()
    
    _init_firebase()
    db = firestore.client()
    test_lookup(db, args.target)
