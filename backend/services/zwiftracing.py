import requests
import time
from typing import Optional, Dict, Any
from config import ZR_AUTH_KEY, ZR_BASE_URL

class ZwiftRacingService:
    def __init__(self):
        self.headers = {"Authorization": ZR_AUTH_KEY} if ZR_AUTH_KEY else {}
        self.base_url = ZR_BASE_URL

    def fetch_json(self, url: str, retries: int = 3, backoff: float = 1.0) -> Optional[Dict[str, Any]]:
        for attempt in range(1, retries + 1):
            try:
                resp = requests.get(url, headers=self.headers)
                if resp.ok:
                    return resp.json()
                else:
                    print(f"HTTP {resp.status_code} when GET {url}")
            except Exception as e:
                print(f"Attempt {attempt} failed: {e}")
            time.sleep(backoff * attempt)
        return None

    def get_rider_data(self, rider_id: str) -> Optional[Dict[str, Any]]:
        if not rider_id:
            return None
            
        # Ensure no double slashes if base_url ends with /
        base = self.base_url.rstrip('/')
        url = f"{base}/public/riders/{rider_id}"
        print(f"Fetching ZwiftRacing URL: {url}") # Debug
        return self.fetch_json(url)

