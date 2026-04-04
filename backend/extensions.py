import os
import queue
import threading
import firebase_admin
from firebase_admin import credentials, firestore
from services.strava import StravaService
from services.zwiftracing import ZwiftRacingService, RateLimitError
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from services.cached_service import CachedService
from services.schema_validation import with_schema_version

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


# --- Zwift API (token-based, auto-refreshes but we re-authenticate on TTL) ---

def _make_zwift_service() -> ZwiftService:
    service = ZwiftService()
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

    Enqueue a rider with enqueue(user_doc_id, zwift_id). The worker drains the
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

    def enqueue(self, user_doc_id: str, zwift_id: str, attempt: int = 1, rider_label: str | None = None) -> None:
        self._q.put((user_doc_id, zwift_id, attempt, rider_label))
        label = rider_label or user_doc_id
        logger.info(f"StatsQueue: enqueued {label} (attempt {attempt})")

    def _worker(self) -> None:
        import time
        while True:
            user_doc_id, zwift_id, attempt, rider_label = self._q.get()
            try:
                self._fetch_and_store(user_doc_id, zwift_id, attempt, rider_label)
            except Exception as e:
                logger.error(f"StatsQueue: unexpected error for {rider_label or user_doc_id}: {e}")
            finally:
                self._q.task_done()
            # Pace calls to stay within the ZR rate limit.
            time.sleep(STATS_CALL_INTERVAL_SECONDS)

    def _fetch_and_store(self, user_doc_id: str, zwift_id: str, attempt: int, rider_label: str | None = None) -> None:
        import time
        label = rider_label or user_doc_id
        if attempt > STATS_MAX_RETRIES:
            logger.error(
                f"StatsQueue: giving up on ZR stats for {label} "
                f"after {STATS_MAX_RETRIES} attempts"
            )
            return

        logger.info(f"StatsQueue: fetching ZR stats for {label} (attempt {attempt})")
        try:
            zr_json = zr_service.get_rider_data(str(zwift_id))
        except RateLimitError:
            logger.warning(
                f"StatsQueue: rate limited for {label} — "
                f"pausing {STATS_RATE_LIMIT_PAUSE_SECONDS}s then re-enqueuing"
            )
            time.sleep(STATS_RATE_LIMIT_PAUSE_SECONDS)
            self.enqueue(user_doc_id, zwift_id, attempt + 1, rider_label=label)
            return

        if not zr_json:
            logger.warning(
                f"StatsQueue: no ZR data for {label} on attempt {attempt} — re-enqueuing"
            )
            self.enqueue(user_doc_id, zwift_id, attempt + 1, rider_label=label)
            return

        data = zr_json if 'race' in zr_json else zr_json.get('data', {})
        race = data.get('race', {})
        payload = with_schema_version({
            'zwiftRacing': {
                'currentRating': (race.get('current') or {}).get('rating', 'N/A'),
                'max30Rating':   (race.get('max30') or {}).get('rating', 'N/A'),
                'max90Rating':   (race.get('max90') or {}).get('rating', 'N/A'),
                'phenotype':     (data.get('phenotype') or {}).get('value', 'N/A'),
                'updatedAt':     firestore.SERVER_TIMESTAMP,
            }
        })
        db.collection('users').document(str(user_doc_id)).set(payload, merge=True)
        logger.info(f"StatsQueue: ZR stats stored for {label}")


stats_queue = StatsQueue()
