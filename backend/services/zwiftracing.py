import requests
import time
import logging
from typing import Optional, Dict, Any, List
from config import ZR_AUTH_KEY, ZR_BASE_URL

logger = logging.getLogger(__name__)


class RateLimitError(Exception):
    """Raised when the ZR API returns HTTP 429 Too Many Requests."""
    pass


class ZwiftRacingService:
    def __init__(self):
        self.headers = {"Authorization": ZR_AUTH_KEY} if ZR_AUTH_KEY else {}
        self.base_url = ZR_BASE_URL.rstrip('/')

    def _get(self, path: str, retries: int = 3, backoff: float = 1.0) -> Optional[Any]:
        url = f"{self.base_url}{path}"
        for attempt in range(1, retries + 1):
            try:
                resp = requests.get(url, headers=self.headers)
                if resp.ok:
                    return resp.json()
                if resp.status_code == 429:
                    raise RateLimitError(f"Rate limited on GET {url}")
                logger.warning(f"HTTP {resp.status_code} on GET {url} (attempt {attempt})")
            except RateLimitError:
                raise
            except Exception as e:
                logger.warning(f"Attempt {attempt} failed: {e}")
            time.sleep(backoff * attempt)
        return None

    def _post(self, path: str, body: Any, retries: int = 3, backoff: float = 1.0) -> Optional[Any]:
        url = f"{self.base_url}{path}"
        for attempt in range(1, retries + 1):
            try:
                resp = requests.post(url, json=body, headers=self.headers)
                if resp.ok:
                    return resp.json()
                if resp.status_code == 429:
                    raise RateLimitError(f"Rate limited on POST {url}")
                logger.warning(f"HTTP {resp.status_code} on POST {url} (attempt {attempt})")
            except RateLimitError:
                raise
            except Exception as e:
                logger.warning(f"Attempt {attempt} failed: {e}")
            time.sleep(backoff * attempt)
        return None

    # --- Riders ---
    # Standard: 5 calls / minute (single), 1 call / 15 minutes (batch)

    def get_rider_data(self, rider_id: str, at_time: int = None) -> Optional[Dict[str, Any]]:
        """GET /public/riders/<riderId> or /public/riders/<riderId>/<time>"""
        if not rider_id:
            return None
        path = f"/public/riders/{rider_id}"
        if at_time:
            path += f"/{at_time}"
        return self._get(path)

    def get_riders_batch(self, rider_ids: List[int], at_time: int = None) -> Optional[Any]:
        """POST /public/riders or /public/riders/<time> — limit 1000 riders."""
        if not rider_ids:
            return None
        path = "/public/riders"
        if at_time:
            path += f"/{at_time}"
        return self._post(path, rider_ids)

    # --- Results ---
    # Standard: 1 call / minute

    def get_results(self, event_id: int) -> Optional[Any]:
        """GET /public/results/<eventId> — ZwiftRacing.app results."""
        return self._get(f"/public/results/{event_id}")

    def get_zp_results(self, event_id: int) -> Optional[Any]:
        """GET /public/zp/<eventId>/results — ZwiftPower results."""
        return self._get(f"/public/zp/{event_id}/results")

    # --- Clubs ---
    # Standard: 1 call / 60 minutes, limited to 1000 results

    def get_club_members(self, club_id: int, after_rider_id: int = None) -> Optional[Any]:
        """GET /public/clubs/<id> or /public/clubs/<id>/<riderId>"""
        path = f"/public/clubs/{club_id}"
        if after_rider_id:
            path += f"/{after_rider_id}"
        return self._get(path)
