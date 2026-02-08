import firebase_admin
from firebase_admin import credentials, firestore, auth
import argparse
import sys
from datetime import datetime
import json

def _init_firebase():
    if not firebase_admin._apps:
        cred = credentials.Certificate('backend/serviceAccountKey.json')
        firebase_admin.initialize_app(cred)

def migrate_user(doc, db, dry_run=True):
    user_data = doc.to_dict()
    doc_id = doc.id
    name = user_data.get('name', 'Unknown')
    
    # 1. Identify Target Key (Zwift ID)
    zwift_id = user_data.get('zwiftId')
    
    # Needs migration if:
    # A) Key is NOT Zwift ID (e.g. key is eLicense or UID)
    # B) Schema is OLD (missing 'registration' group)
    
    is_zwift_key = str(doc_id) == str(zwift_id)
    has_new_schema = 'registration' in user_data and 'status' in user_data['registration']
    
    if is_zwift_key and has_new_schema:
        print(f"[SKIP] {name} ({doc_id}) already migrated.")
        return False

    print(f"[MIGRATE] Processing {name} (Current Key: {doc_id}) -> ZwiftID: {zwift_id}")
    
    if not zwift_id:
        print(f"  [WARN] No Zwift ID found for {doc_id}. Skipping re-keying (might update schema in-place if possible).")
        # If no Zwift ID, we can't re-key securely. Maybe just update schema in place?
        # But if it's a draft, it might be fine.
        target_key = doc_id
    else:
        target_key = str(zwift_id)

    # 2. Build New Data Structure
    new_data = user_data.copy()
    
    # Equipment
    trainer = new_data.pop('trainer', None)
    if trainer:
        new_data['equipment'] = {'trainer': trainer}
    elif 'equipment' not in new_data:
        new_data['equipment'] = {}

    # Registration
    if 'registration' not in new_data:
        reg_status = 'none'
        if user_data.get('verified') or user_data.get('registrationComplete'):
            reg_status = 'complete'
        elif user_data.get('name'):
            reg_status = 'draft'
            
        new_data['registration'] = {
            'status': reg_status,
            'cocAccepted': user_data.get('acceptedCoC', False),
            'publicResultsConsent': {
                 'version': user_data.get('publicResultsConsentVersion'),
                 # No timestamp available usually, unless we use updated_at
                 'acceptedAt': user_data.get('updatedAt') 
            } if user_data.get('acceptedPublicResults') else None,
            'dataPolicy': {
                 'version': user_data.get('dataPolicyVersion'),
                 'acceptedAt': user_data.get('updatedAt')
            } if user_data.get('acceptedDataPolicy') else None
        }
        
    # Connections (Strava)
    strava = new_data.pop('strava', None)
    if strava:
        if 'connections' not in new_data: new_data['connections'] = {}
        new_data['connections']['strava'] = strava
        
    # Cleanup old fields
    keys_to_remove = ['verified', 'registrationComplete', 'acceptedCoC', 'acceptedDataPolicy', 
                      'acceptedPublicResults', 'dataPolicyVersion', 'publicResultsConsentVersion']
    for k in keys_to_remove:
        new_data.pop(k, None)

    # 3. Execute
    if dry_run:
        print(f"  [DRY RUN] Would create/update doc {target_key} with new structure.")
        if target_key != doc_id:
            print(f"  [DRY RUN] Would delete old doc {doc_id}.")
            print(f"  [DRY RUN] Would update auth_mapping for uid {user_data.get('authUid')} to point to {target_key}")
    else:
        # Create/Update New Doc
        target_ref = db.collection('users').document(target_key)
        target_ref.set(new_data, merge=True)
        print(f"  [SUCCESS] Written to {target_key}")
        
        # Update Auth Mapping
        uid = user_data.get('authUid') or user_data.get('uid') # Legacy field might vary
        if uid:
            db.collection('auth_mappings').document(uid).set({'zwiftId': str(zwift_id)}, merge=True)
            print(f"  [SUCCESS] Updated auth_mapping for {uid}")
            
        # Delete Old Doc (Only if we re-keyed)
        if target_key != doc_id:
            db.collection('users').document(doc_id).delete()
            print(f"  [SUCCESS] Deleted old doc {doc_id}")
            
    return True

def main():
    parser = argparse.ArgumentParser(description='Migrate users to new schema')
    parser.add_argument('--execute', action='store_true', help='Actually execute changes (default is dry-run)')
    parser.add_argument('--target', type=str, help='Specific user ID to migrate (optional)')
    args = parser.parse_args()
    
    _init_firebase()
    db = firestore.client()
    
    print(f"Starting migration... Mode: {'EXECUTE' if args.execute else 'DRY RUN'}")
    
    if args.target:
        doc = db.collection('users').document(args.target).get()
        if doc.exists:
             migrate_user(doc, db, not args.execute)
        else:
             print(f"User {args.target} not found")
    else:
        users = db.collection('users').stream()
        count = 0
        migrated = 0
        for doc in users:
            count += 1
            if migrate_user(doc, db, not args.execute):
                migrated += 1
        
        print(f"\nScanned {count} users. Migrated {migrated}.")

if __name__ == "__main__":
    main()
