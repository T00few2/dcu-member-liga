import os
import queue
import threading
import firebase_admin
from firebase_admin import credentials, firestore
from services.strava import StravaService
from services.zwiftpower import ZwiftPowerService
from services.zwiftracing import ZwiftRacingService, RateLimitError
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from services.cached_service import CachedService
from config import ZWIFT_USERNAME, ZWIFT_PASSWORD

import logging

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Named constants
# ---------------------------------------------------------------------------

# How long an authenticated session (Zwift / ZwiftPower) remains valid.
# Zwift access tokens expire after ~55 minutes; use 50 min as a safe TTL.
SESSION_TTL_SECONDS: int = 3000  # 50 minutes

# Background stats-queue: target rate ≈ 4.6 calls/min (ZR limit is 5/min).
STATS_CALL_INTERVAL_SECONDS: float = 13.0
# Seconds to pause the worker after a 429 response from ZwiftRacing.
STATS_RATE_LIMIT_PAUSE_SECONDS: int = 65
# Maximum fetch attempts per rider before giving up.
STATS_MAX_RETRIES: int = 4

# ---------------------------------------------------------------------------
# Database Initialization
# ---------------------------------------------------------------------------

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
    logger.error(
        f"Firebase could not be initialized. Database operations will fail. Error: {e}"
    )

# ---------------------------------------------------------------------------
# Service Singletons
# ---------------------------------------------------------------------------

# Strava (no session TTL — uses per-user OAuth tokens stored in Firestore)
strava_service = StravaService(db)

# ZwiftRacing (stateless API client with API-key auth)
zr_service = ZwiftRacingService()

# Zwift Game (stateless)
_zwift_game_service = ZwiftGameService()


# --- ZwiftPower (session-based, requires re-login after TTL) ---

def _make_zp_service() -> ZwiftPowerService:
    service = ZwiftPowerService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
    try:
        service.login()
    except Exception as e:
        logger.error(f"Failed to initialize ZwiftPower session: {e}")
    return service  # Return even on failure; callers handle downstream errors.


_zp_cache = CachedService(
    factory=_make_zp_service,
    name='ZwiftPower',
    ttl=SESSION_TTL_SECONDS,
)


def get_zp_service() -> ZwiftPowerService:
    return _zp_cache.get()


# --- Zwift API (token-based, auto-refreshes but we re-authenticate on TTL) ---

def _make_zwift_service() -> ZwiftService:
    service = ZwiftService(ZWIFT_USERNAME, ZWIFT_PASSWORD)
    try:
        service.authenticate()
    except Exception as e:
        logger.error(f"Failed to initialize Zwift session: {e}")
    return service  # Return even on failure; callers handle downstream errors.


def _validate_zwift_service(svc: ZwiftService) -> bool:
    """Returns True if the token is still valid; raises or returns False to trigger refresh."""
    svc.ensure_valid_token()
    return True


_zwift_cache = CachedService(
    factory=_make_zwift_service,
    name='Zwift',
    ttl=SESSION_TTL_SECONDS,
    validator=_validate_zwift_service,
)


def get_zwift_service() -> ZwiftService:
    return _zwift_cache.get()


def get_zwift_game_service() -> ZwiftGameService:
    return _zwift_game_service


# ---------------------------------------------------------------------------
# Background Stats Fetch Queue
# ---------------------------------------------------------------------------

class StatsQueue:
    """
    Background worker that fetches and stores ZwiftRacing stats for newly
    registered riders without blocking the signup HTTP response.

    Enqueue a rider with enqueue(e_license, zwift_id). The worker drains the
    queue at a rate that respects the ZR API limit (5 calls/min). On a 429
    it pauses, then re-enqueues the rider for another attempt (up to
    STATS_MAX_RETRIES total). On other transient failures it also re-enqueues.
    """

    def __init__(self) -> None:
        self._q: queue.Queue = queue.Queue()
        self._thread = threading.Thread(
            target=self._worker, daemon=True, name='stats-queue-worker'
        )
        self._thread.start()

    def enqueue(self, e_license: str, zwift_id: str, attempt: int = 1) -> None:
        self._q.put((e_license, zwift_id, attempt))
        logger.info(f"StatsQueue: enqueued {e_license} (attempt {attempt})")

    def _worker(self) -> None:
        import time
        while True:
            e_license, zwift_id, attempt = self._q.get()
            try:
                self._fetch_and_store(e_license, zwift_id, attempt)
            except Exception as e:
                logger.error(f"StatsQueue: unexpected error for {e_license}: {e}")
            finally:
                self._q.task_done()
            # Pace calls to stay within the ZR rate limit.
            time.sleep(STATS_CALL_INTERVAL_SECONDS)

    def _fetch_and_store(self, e_license: str, zwift_id: str, attempt: int) -> None:
        import time
        if attempt > STATS_MAX_RETRIES:
            logger.error(
                f"StatsQueue: giving up on ZR stats for {e_license} "
                f"after {STATS_MAX_RETRIES} attempts"
            )
            return

        logger.info(f"StatsQueue: fetching ZR stats for {e_license} (attempt {attempt})")
        try:
            zr_json = zr_service.get_rider_data(str(zwift_id))
        except RateLimitError:
            logger.warning(
                f"StatsQueue: rate limited for {e_license} — "
                f"pausing {STATS_RATE_LIMIT_PAUSE_SECONDS}s then re-enqueuing"
            )
            time.sleep(STATS_RATE_LIMIT_PAUSE_SECONDS)
            self.enqueue(e_license, zwift_id, attempt + 1)
            return

        if not zr_json:
            logger.warning(
                f"StatsQueue: no ZR data for {e_license} on attempt {attempt} — re-enqueuing"
            )
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
