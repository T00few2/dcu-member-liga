import re
import time
import unicodedata

import requests
from bs4 import BeautifulSoup

# Mirrors the frontend slug algorithm in frontend/lib/api.ts::getZwiftInsiderUrl,
# so both ends resolve the same route name to the same ZwiftInsider URL.
def slugify(route_name):
    slug = unicodedata.normalize('NFD', route_name or '')
    slug = ''.join(c for c in slug if not unicodedata.combining(c))
    slug = slug.lower()
    slug = re.sub(r'\s+', '-', slug)
    slug = re.sub(r'[^\w-]+', '', slug)
    slug = re.sub(r'-{2,}', '-', slug)
    slug = slug.strip('-')
    return slug


_WKG_MINUTES_RE = re.compile(r'(\d+(?:\.\d+)?)\s*W/kg\s*:\s*(\d+(?:\.\d+)?)\s*minutes?', re.IGNORECASE)
_RATING_RE = re.compile(r'Rating\s*:\s*(\d+(?:\.\d+)?)\s*/\s*100', re.IGNORECASE)


class ZwiftInsiderService:
    def __init__(self):
        self._cache = {}
        self._cache_duration = 3600 * 24  # 24 hours

    def get_time_estimates(self, route_name):
        slug = slugify(route_name)
        url = f"https://zwiftinsider.com/route/{slug}/"

        cached = self._cache.get(slug)
        if cached and (time.time() - cached['time'] < self._cache_duration):
            return cached['data']

        data = self._fetch(url, slug)
        self._cache[slug] = {'data': data, 'time': time.time()}
        return data

    def _fetch(self, url, slug):
        headers = {
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
            ),
            "Accept-Language": "en-US,en;q=0.9",
        }

        try:
            resp = requests.get(url, headers=headers, timeout=20)
            resp.raise_for_status()
            text = BeautifulSoup(resp.text, "html.parser").get_text(separator=' ')

            estimates = [
                {'wkg': float(wkg), 'minutes': float(minutes)}
                for wkg, minutes in _WKG_MINUTES_RE.findall(text)
            ]
            rating_match = _RATING_RE.search(text)
            rating = float(rating_match.group(1)) if rating_match else None

            if not estimates:
                return {'slug': slug, 'url': url, 'rating': rating, 'estimates': [], 'error': 'unavailable'}

            return {'slug': slug, 'url': url, 'rating': rating, 'estimates': estimates}
        except Exception as e:
            print(f"Error fetching ZwiftInsider time estimates for {url}: {e}")
            return {'slug': slug, 'url': url, 'rating': None, 'estimates': [], 'error': 'unavailable'}
