import os
import time
import firebase_admin
from firebase_admin import credentials, firestore
from services.strava import StravaService
from services.zwiftpower import ZwiftPowerService
from services.zwiftracing import ZwiftRacingService
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from config import ZWIFT_USERNAME, ZWIFT_PASSWORD

# --- Database Initialization ---
db = None
try:
    if not firebase_admin._apps:
        cred_path = 'serviceAccountKey.json'
        if os.path.exists(cred_path):
            cred = credentials.Certificate(cred_path)
            firebase_admin.initialize_app(cred)
        else:
            firebase_admin.initialize_app()
            
    db = firestore.client()
except Exception as e:
    print(f"Warning: Firebase could not be initialized. Database operations will fail. Error: {e}")

# --- Service Singletons & Factories ---

# Strava
strava_service = StravaService(db)

# Zwift Racing
zr_service = ZwiftRacingService()

# Zwift Game
_zwift_game_service = ZwiftGameService()

# ZwiftPower Cache
_zp_service_instance = None
_zp_service_timestamp = 0
SESSION_VALIDITY = 3000 # 50 minutes

def get_zp_service():
    global _zp_service_instance, _zp_service_timestamp
    now = time.time()
    
    if _zp_service_instance and (now - _zp_service_timestamp < SESSION_VALIDITY):
        return _zp_service_instance

    print("Creating new ZwiftPower session.")
    service = ZwiftPowerService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
    try:
        service.login()
        _zp_service_instance = service
        _zp_service_timestamp = now
        return service
    except Exception as e:
        print(f"Failed to initialize ZwiftPower session: {e}")
        return service

# Zwift API Cache
_zwift_service_instance = None
_zwift_service_timestamp = 0

def get_zwift_service():
    global _zwift_service_instance, _zwift_service_timestamp
    now = time.time()
    
    if _zwift_service_instance and (now - _zwift_service_timestamp < SESSION_VALIDITY):
        try:
            _zwift_service_instance.ensure_valid_token()
            return _zwift_service_instance
        except:
            pass 

    print("Creating new Zwift service session.")
    service = ZwiftService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
    try:
        service.authenticate()
        _zwift_service_instance = service
        _zwift_service_timestamp = now
        return service
    except Exception as e:
        print(f"Failed to initialize Zwift session: {e}")
        return service

def get_zwift_game_service():
    return _zwift_game_service
