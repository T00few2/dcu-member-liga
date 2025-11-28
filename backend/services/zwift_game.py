import requests
import time

class ZwiftGameService:
    def __init__(self):
        self._cache = None
        self._cache_time = 0
        self._cache_duration = 3600 * 24  # Cache for 24 hours

    def get_game_dictionary(self):
        # Return cached data if valid
        if self._cache and (time.time() - self._cache_time < self._cache_duration):
            return self._cache

        url = "https://www.zwift.com/zwift-web-pages/gamedictionaryextended"
        headers = {
            "Accept": "application/json",
            "Source": "zwift-web",
        }
        
        try:
            resp = requests.get(url, headers=headers, timeout=20)
            resp.raise_for_status()
            data = resp.json()
            
            self._cache = data
            self._cache_time = time.time()
            return data
        except Exception as e:
            print(f"Error fetching Zwift dictionary: {e}")
            return None

    def get_routes(self):
        game_dict = self.get_game_dictionary()
        if not game_dict:
            return []

        routes_raw = game_dict.get("ROUTES", {}).get("ROUTE", [])
        
        # Clean up and simplify the data for the frontend
        routes = []
        for r in routes_raw:
            # Skip if it's an event-only paddock or restricted strangely, 
            # though user might want event-only routes. Keeping broadly.
            
            routes.append({
                'id': r.get('signature'), # or routeSignature
                'name': r.get('name'),
                'map': r.get('map'), # e.g. RICHMOND, WATOPIA
                'distance': float(r.get('distanceInMeters', 0)) / 1000, # Convert to km
                'elevation': float(r.get('ascentInMeters', 0)),
                'leadinDistance': float(r.get('leadinDistanceInMeters', 0)) / 1000,
                'leadinElevation': float(r.get('leadinAscentInMeters', 0)),
                'sports': r.get('sports'), # 1=Running, 2=Cycling? usually mixed.
                'difficulty': r.get('difficulty')
            })
            
        # Sort by Map then Name
        return sorted(routes, key=lambda x: (x['map'], x['name']))

