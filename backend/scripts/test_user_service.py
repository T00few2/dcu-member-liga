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

# 3. Mock extensions module
mock_extensions = types.ModuleType('extensions')
mock_extensions.db = db
sys.modules['extensions'] = mock_extensions

# 4. Import UserService (it will use the mock extensions)
from services.user_service import UserService

def test_user_service():
    print("Fetching user 15690...")
    user = UserService.get_user_by_id('15690')
    
    if user:
        print(f"User Found: {user.name}")
        print(f"Zwift ID: {user.zwift_id}")
        print(f"eLicense: {user.e_license}")
        print(f"Verification Status (nested): {user.verification_status}")
        print(f"Is Verified: {user.is_verified}")
        print(f"Requests history count: {len(user.verification_history)}")
        print(f"Strava Auth: {user.strava_auth}")

        # Simulate get_profile JSON
        print("\n--- Simulated Profile JSON ---")
        profile_json = {
            'name': user.name,
            'verification': user.verification,
            'verification_status': user.verification_status,
            'is_verified': user.is_verified,
            'history': user.verification_history,
            'currentRequest': user.current_verification_request,
            'strava': user.strava_auth
        }
        import json
        print(json.dumps(profile_json, default=str, indent=2))
        
        # Test eLicense lookup
        if user.e_license:
            print(f"\nTesting eLicense lookup for {user.e_license}...")
            user_by_license = UserService.get_user_by_elicense(user.e_license)
            if user_by_license and user_by_license.id == user.id:
                 print("eLicense lookup SUCCESS")
            else:
                 print("eLicense lookup FAILED")
    else:
        print("User 15690 not found.")

if __name__ == "__main__":
    test_user_service()
