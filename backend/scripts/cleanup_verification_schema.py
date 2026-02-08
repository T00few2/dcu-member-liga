
import sys
import os
import types

# 1. Setup path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
os.chdir(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

# 2. Initialize Firestore
import firebase_admin
from firebase_admin import credentials, firestore

if not firebase_admin._apps:
    try:
        cred = credentials.Certificate('serviceAccountKey.json')
        firebase_admin.initialize_app(cred)
    except Exception as e:
        print(f"Failed to load serviceAccountKey: {e}")
        firebase_admin.initialize_app()
        
db = firestore.client()

def cleanup_verification_schema():
    print("Starting schema cleanup...")
    users_ref = db.collection('users')
    docs = users_ref.stream()
    
    count = 0
    updated = 0
    
    for doc in docs:
        count += 1
        data = doc.to_dict()
        updates = {}
        
        # Check for root-level 'verification.status' key (which is a dotted key in the dict)
        # Note: In Python dict from Firestore, keys with dots are just keys.
        # But we must be careful: firestore.DELETE_FIELD requires specific handling.
        
        # Firestore SDK might return 'verification.status' as a key if it was created with set(merge=True) using a dotted key.
        # Let's inspect keys.
        keys_to_delete = []
        for k in data.keys():
            if k == 'verification.status' or k == 'verification.history' or k == 'verification.currentRequest':
                keys_to_delete.append(k)
                
        if keys_to_delete:
            print(f"Found bad keys in user {doc.id}: {keys_to_delete}")
            for k in keys_to_delete:
                updates[k] = firestore.DELETE_FIELD
            
            # Apply updates
            users_ref.document(doc.id).update(updates)
            updated += 1
            
    print(f"Scanned {count} users. Cleaned up {updated} users.")

if __name__ == "__main__":
    cleanup_verification_schema()
