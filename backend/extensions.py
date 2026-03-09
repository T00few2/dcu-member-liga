import os
import time
import queue
import threading
import firebase_admin
from firebase_admin import credentials, firestore
from services.strava import StravaService
from services.zwiftpower import ZwiftPowerService
from services.zwiftracing import ZwiftRacingService, RateLimitError
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from config import ZWIFT_USERNAME, ZWIFT_PASSWORD

# --- Database Initialization ---
import logging

logger = logging.getLogger(__name__)

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
    logger.error(f"Firebase could not be initialized. Database operations will fail. Error: {e}")

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
_zp_lock = threading.Lock()
SESSION_VALIDITY = 3000  # 50 minutes


def get_zp_service():
    global _zp_service_instance, _zp_service_timestamp
    now = time.time()
    with _zp_lock:
        if _zp_service_instance and (now - _zp_service_timestamp < SESSION_VALIDITY):
            return _zp_service_instance

        logger.info("Creating new ZwiftPower session.")
        service = ZwiftPowerService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
        try:
            service.login()
            _zp_service_instance = service
            _zp_service_timestamp = now
        except Exception as e:
            logger.error(f"Failed to initialize ZwiftPower session: {e}")
        return service

# Zwift API Cache
_zwift_service_instance = None
_zwift_service_timestamp = 0
_zwift_lock = threading.Lock()


def get_zwift_service():
    global _zwift_service_instance, _zwift_service_timestamp
    now = time.time()
    with _zwift_lock:
        if _zwift_service_instance and (now - _zwift_service_timestamp < SESSION_VALIDITY):
            try:
                _zwift_service_instance.ensure_valid_token()
                return _zwift_service_instance
            except Exception:
                pass  # Token invalid — fall through to re-authenticate

        logger.info("Creating new Zwift service session.")
        service = ZwiftService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
        try:
            service.authenticate()
            _zwift_service_instance = service
            _zwift_service_timestamp = now
        except Exception as e:
            logger.error(f"Failed to initialize Zwift session: {e}")
        return service


def get_zwift_game_service():
    return _zwift_game_service


# --- Stats Fetch Queue ---
# Fetches ZwiftRacing (and could be extended to ZP/Zwift) stats in the background
# after signup, so the registration response is never blocked by external API calls.

_STATS_CALL_INTERVAL = 13.0   # seconds between ZR calls (~4.6/min, safely under 5/min limit)
_STATS_RATE_LIMIT_PAUSE = 65  # seconds to pause the worker after a 429
_STATS_MAX_RETRIES = 4


class StatsQueue:
    """
    Background worker that fetches and stores ZwiftRacing stats for newly
    registered riders without blocking the signup HTTP response.

    Enqueue a rider with enqueue(e_license, zwift_id). The worker drains the
    queue at a rate that respects the ZR API limit (5 calls/min). On a 429
    it pauses, then re-enqueues the rider for another attempt (up to
    _STATS_MAX_RETRIES total). On other transient failures it also re-enqueues.
    """

    def __init__(self):
        self._q = queue.Queue()
        self._thread = threading.Thread(target=self._worker, daemon=True, name="stats-queue-worker")
        self._thread.start()

    def enqueue(self, e_license: str, zwift_id: str, attempt: int = 1):
        self._q.put((e_license, zwift_id, attempt))
        logger.info(f"StatsQueue: enqueued {e_license} (attempt {attempt})")

    def _worker(self):
        while True:
            e_license, zwift_id, attempt = self._q.get()
            try:
                self._fetch_and_store(e_license, zwift_id, attempt)
            except Exception as e:
                logger.error(f"StatsQueue: unexpected error for {e_license}: {e}")
            finally:
                self._q.task_done()
            # Pace calls regardless of outcome to stay within the rate limit.
            time.sleep(_STATS_CALL_INTERVAL)

    def _fetch_and_store(self, e_license: str, zwift_id: str, attempt: int):
        if attempt > _STATS_MAX_RETRIES:
            logger.error(f"StatsQueue: giving up on ZR stats for {e_license} after {_STATS_MAX_RETRIES} attempts")
            return

        logger.info(f"StatsQueue: fetching ZR stats for {e_license} (attempt {attempt})")
        try:
            zr_json = zr_service.get_rider_data(str(zwift_id))
        except RateLimitError:
            logger.warning(
                f"StatsQueue: rate limited for {e_license} — pausing {_STATS_RATE_LIMIT_PAUSE}s then re-enqueuing"
            )
            time.sleep(_STATS_RATE_LIMIT_PAUSE)
            self.enqueue(e_license, zwift_id, attempt + 1)
            return

        if not zr_json:
            logger.warning(f"StatsQueue: no ZR data for {e_license} on attempt {attempt} — re-enqueuing")
            self.enqueue(e_license, zwift_id, attempt + 1)
            return

        data = zr_json if 'race' in zr_json else zr_json.get('data', {})
        race = data.get('race', {})
        db.collection('users').document(str(e_license)).set({
            'zwiftRacing': {
                'currentRating': race.get('current', {}).get('rating', 'N/A'),
                'max30Rating':   race.get('max30', {}).get('rating', 'N/A'),
                'max90Rating':   race.get('max90', {}).get('rating', 'N/A'),
                'phenotype':     data.get('phenotype', {}).get('value', 'N/A'),
                'updatedAt':     firestore.SERVER_TIMESTAMP,
            }
        }, merge=True)
        logger.info(f"StatsQueue: ZR stats stored for {e_license}")


stats_queue = StatsQueue()
