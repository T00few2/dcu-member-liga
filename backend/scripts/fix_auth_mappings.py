import firebase_admin
from firebase_admin import credentials, firestore
import argparse

def _init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate('backend/serviceAccountKey.json')
        firebase_admin.initialize_app(cred)

def validate_mappings(db, dry_run=True):
    print(f"--- Phase 1: Mapping -> User Link Validation (Dry Run: {dry_run}) ---")
    fixed_in_validation = 0
    
    for mapping_doc in db.collection('auth_mappings').stream():
        uid = mapping_doc.id
        data = mapping_doc.to_dict()
        
        zwift_id = data.get('zwiftId')
        e_license = data.get('eLicense')
        
        target_key = str(zwift_id) if zwift_id else (str(e_license) if e_license else None)
        
        if target_key:
            user_doc = db.collection('users').document(target_key).get()
            if not user_doc.exists:
                print(f"[ERROR] Broken Link for UID {uid}: Points to {target_key} but doc not found.")
                # Attempt to find user by authUid query
                print(f"    Searching for user with authUid={uid}...")
                found_docs = list(db.collection('users').where('authUid', '==', uid).stream())
                if found_docs:
                    actual_doc = found_docs[0]
                    print(f"    FOUND user doc at {actual_doc.id}. Updating mapping...")
                    if not dry_run:
                        # Determine correct key type
                        new_zwift_id = actual_doc.to_dict().get('zwiftId')
                        if new_zwift_id:
                            db.collection('auth_mappings').document(uid).set({'zwiftId': str(new_zwift_id)}, merge=True)
                            print(f"    [FIXED] Remapped {uid} -> ZwiftID {new_zwift_id}")
                            fixed_in_validation += 1
                        else:
                            # Fallback to doc_id if it's the key
                            db.collection('auth_mappings').document(uid).set({'eLicense': actual_doc.id}, merge=True) # assuming it's elicense-like
                            print(f"    [FIXED] Remapped {uid} -> DocID {actual_doc.id}")
                            fixed_in_validation += 1
                else:
                     print(f"    [CRITICAL] User document completely lost for UID {uid}!")
            else:
                # Link is valid
                pass
        else:
            print(f"[WARN] UID {uid} has mapping doc but no keys.")
            
    print(f"\nLink Validation Complete. Fixed: {fixed_in_validation}")
    return fixed_in_validation

def fix_auth_mappings(db, dry_run=True):
    # First, validate existing mappings and fix broken links
    total_fixed = validate_mappings(db, dry_run)
    
    print("\n--- Phase 2: User -> Mapping Check (Dry Run: {dry_run}) ---")
    print(f"Scanning users for missing auth mappings...")
    users = db.collection('users').stream()
    
    count = 0
    fixed = 0
    skipped = 0
    
    for user_doc in users:
        count += 1
        user_data = user_doc.to_dict()
        doc_id = user_doc.id
        
        # Try to find UID
        uid = user_data.get('authUid') or user_data.get('uid')
        
        if not uid:
            # If document ID looks like a UID (len 28 is common for Firebase Auth UIDs)
            if len(doc_id) == 28:
                uid = doc_id
        
        if not uid:
            print(f"[SKIP] User {doc_id} ({user_data.get('name', 'Unknown')}) - No UID found.")
            skipped += 1
            continue
            
        # Check if mapping exists
        mapping_ref = db.collection('auth_mappings').document(uid)
        mapping_doc = mapping_ref.get()
        
        needs_update = False
        update_data = {}
        
        if not mapping_doc.exists:
            needs_update = True
        else:
            current_map = mapping_doc.to_dict()
            # If doc_id looks like a ZwiftID (digits, <10 chars), verify mapping has it
            if doc_id.isdigit() and len(doc_id) < 10:
                if str(current_map.get('zwiftId')) != doc_id:
                     needs_update = True
            # Otherwise just check if entirely missing
            elif not current_map.get('zwiftId') and not current_map.get('eLicense'):
                needs_update = True
        
        if needs_update:
            # Determine what to map to
            # If doc_id is Zwift ID (digits), map to it
            if doc_id.isdigit() and len(doc_id) < 10:
                update_data['zwiftId'] = doc_id
            # If doc_id is eLicense or UID, map eLicense if present
            elif user_data.get('eLicense'):
                update_data['eLicense'] = user_data.get('eLicense')
            
            # If still nothing, and doc key is UID, we don't strictly need a mapping 
            # (get_profile falls back to uid lookup *if* configured, but new logic desires mapping)
            # BUT: if the user doc IS the UID, then mapping isn't 100% implicitly needed if code falls back?
            # actually, current get_profile logic:
            # 1. Check mapping.
            # 2. Else: Check Users/UID.
            # So if doc_id == UID, it works without mapping.
            # The issue is likely users keyed by eLicense (e.g. 'DK12345') but without mapping.
            
            if doc_id != uid and not update_data:
                # Key is something else (eLicense?) and we found no eLicense field?
                # or Key is eLicense and we want to map it
                 update_data['eLicense'] = doc_id
            
            if update_data:
                update_data['lastLogin'] = firestore.SERVER_TIMESTAMP
                
                print(f"[FIX] Mapping {uid} -> {update_data}")
                if not dry_run:
                    mapping_ref.set(update_data, merge=True)
                fixed += 1
            else:
                # If doc_id == uid, we don't strictly need a mapping for get_profile to work (it falls back to uid)
                # print(f"[OK] User {doc_id} is keyed by UID and no better key found.")
                pass
        else:
             # print(f"[OK] User {doc_id} already mapped.")
             pass

    print(f"\nScanned {count} users.")
    print(f"Fixed/Would Fix (Phase 2): {fixed}")
    print(f"Skipped: {skipped}")
    print(f"Total Fixed/Would Fix (All Phases): {total_fixed + fixed}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description='Fix missing auth mappings')
    parser.add_argument('--execute', action='store_true', help='Execute changes')
    args = parser.parse_args()
    
    _init_firebase()
    db = firestore.client()
    fix_auth_mappings(db, not args.execute)
