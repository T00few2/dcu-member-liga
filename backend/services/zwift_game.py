import requests
import time
import os
import json
from collections import defaultdict

from services.pen_exit_routing import synthesize_leadin_entries

_JERSEY_CDN_TEMPLATES = (
    "https://cdn.zwift.com/static/zc/JERSEYS/{name}.png",
    "https://cdn.zwift.com/static/zc/game/Jerseys/{name}.png",
    "https://cdn.zwift.com/static/web/images/clothing/Jerseys/{name}.png",
    "https://static-cdn.zwift.com/gameassets/{name}.png",
    "https://cdn-l-static.zwift.com/images/clothing/Jerseys/{name}.png",
)
_JERSEY_IMAGE_TEMPLATE: str | None | bool = False
_SEGMENT_SNAPSHOT = os.path.join(
    os.path.dirname(__file__), "..", "data", "game_dictionary_segments.json"
)


def on_route_ids(raw) -> set[str]:
    """Route ids from a dictionary ``onRoutes`` value.

    The field is one comma-separated string. Iterating it yields characters.
    """
    return {part.strip() for part in str(raw or "").split(",") if part.strip()}


def dictionary_segment_name(row: dict) -> str:
    """Zwift arch name for one dictionary segment row."""
    direction = str(row.get("direction") or "")
    if direction == "reverse":
        name = row.get("archFriendlyNameR") or row.get("archFriendlyName")
    else:
        name = row.get("archFriendlyName") or row.get("archFriendlyNameR")
    if not name:
        name = str(row.get("name") or "").replace("_", " ")
    return str(name).strip()


def snapshot_segment_rows() -> list:
    """Last fetched dictionary segments, used when Zwift cannot be reached."""
    try:
        with open(_SEGMENT_SNAPSHOT, encoding="utf-8") as handle:
            rows = json.load(handle)
    except (OSError, json.JSONDecodeError):
        return []
    return rows if isinstance(rows, list) else []


def jersey_marker(icon_path: str | None) -> str:
    """Sprint, climb, or segment from the dictionary jersey file name.

    The folder is WhiteOrangeTheme for every icon. Green and the Fuego Flats
    desert jersey are sprints. Polka art, including the Titans Grove jersey, is
    a KOM. Orange, badges, purple intervals, and a missing icon are segments.
    """
    file_name = (icon_path or "").rsplit("/", 1)[-1]
    if file_name.startswith("Green") or file_name.startswith("Desert"):
        return "sprint"
    if "Polka" in file_name or file_name.startswith("NationalForest"):
        return "climb"
    return "segment"


def jersey_image_url(image_name: str | None) -> str | None:
    """First CDN template that returned an image, applied to imageName."""
    name = (image_name or "").strip()
    if not name:
        return None
    template = _resolved_jersey_image_template(name)
    if not template:
        return None
    return template.format(name=name)


def _looks_like_image(status: int, content_type: str | None, url: str) -> bool:
    if status != 200:
        return False
    ct = (content_type or "").lower()
    if "html" in ct:
        return False
    if "image" in ct or "octet-stream" in ct:
        return True
    return url.lower().split("?", 1)[0].endswith((".png", ".jpg", ".jpeg", ".webp"))


def _resolved_jersey_image_template(sample_name: str) -> str | None:
    global _JERSEY_IMAGE_TEMPLATE
    if _JERSEY_IMAGE_TEMPLATE is not False:
        return _JERSEY_IMAGE_TEMPLATE or None
    for template in _JERSEY_CDN_TEMPLATES:
        url = template.format(name=sample_name)
        try:
            resp = requests.head(url, timeout=4, allow_redirects=True)
            if _looks_like_image(resp.status_code, resp.headers.get("Content-Type"), url):
                _JERSEY_IMAGE_TEMPLATE = template
                return template
            get_resp = requests.get(url, timeout=4, stream=True)
            get_type = get_resp.headers.get("Content-Type")
            get_resp.close()
            if _looks_like_image(get_resp.status_code, get_type, url):
                _JERSEY_IMAGE_TEMPLATE = template
                return template
        except Exception:
            continue
    _JERSEY_IMAGE_TEMPLATE = None
    return None

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

    def find_route_id(self, world: str | None, name: str | None) -> str | None:
        """Dictionary route id for a map and route name."""
        world_key = (world or "").strip().casefold()
        name_key = (name or "").strip().casefold()
        if not world_key or not name_key:
            return None
        for route in self.get_routes():
            if (
                str(route.get("map") or "").casefold() == world_key
                and str(route.get("name") or "").casefold() == name_key
            ):
                return str(route.get("id"))
        return None

    def route_record(self, route_id) -> dict | None:
        wanted = str(route_id)
        for route in self.get_routes():
            if str(route.get("id")) == wanted:
                return route
        return None

    def _live_segment_rows(self) -> list:
        game_dict = self.get_game_dictionary()
        if not game_dict:
            return []
        raw = game_dict.get("SEGMENTS") or {}
        rows = raw.get("SEGMENT") if isinstance(raw, dict) else raw
        if isinstance(rows, dict):
            rows = [rows]
        return rows if isinstance(rows, list) else []

    def segments_on_route(self, route_id) -> dict[str, dict]:
        """Dictionary segments whose ``onRoutes`` contains this route id.

        The key is ``signature``. The live dictionary wins. The saved snapshot
        is used when that fetch fails, so CI and a Zwift outage still have a list.
        """
        rows = self._live_segment_rows() or snapshot_segment_rows()
        wanted = str(route_id)
        found: dict[str, dict] = {}
        for row in rows:
            if not isinstance(row, dict):
                continue
            if wanted not in on_route_ids(row.get("onRoutes")):
                continue
            signature = row.get("signature")
            if signature is None:
                continue
            found[str(signature)] = row
        return found

    def get_jerseys(self, query: str | None = None, limit: int | None = 50):
        """Public JERSEYS catalog: signature, name, imageName, imageUrl."""
        game_dict = self.get_game_dictionary()
        if not game_dict:
            return []

        raw = game_dict.get("JERSEYS") or {}
        entries = raw.get("JERSEY") if isinstance(raw, dict) else raw
        if isinstance(entries, dict):
            entries = [entries]
        if not isinstance(entries, list):
            return []

        needle = (query or "").strip().lower()
        jerseys = []
        for item in entries:
            if not isinstance(item, dict):
                continue
            signature = item.get("signature")
            try:
                signature_int = int(signature)
            except (TypeError, ValueError):
                continue
            name = item.get("name") or ""
            image_name = item.get("imageName") or ""
            haystack = f"{signature_int} {name} {image_name}".lower()
            if needle and needle not in haystack:
                continue
            jerseys.append({
                "signature": signature_int,
                "name": name,
                "imageName": image_name,
                "imageUrl": jersey_image_url(image_name),
            })

        jerseys.sort(key=lambda row: ((row.get("name") or "").lower(), row["signature"]))
        if limit is not None:
            return jerseys[: max(0, int(limit))]
        return jerseys

    def jersey_by_signature(self, signature: int) -> dict | None:
        for row in self.get_jerseys(query=str(signature), limit=None):
            if row.get("signature") == int(signature):
                return row
        return None

    def get_event_segments(self, route_id, laps=1, include_lap_banners=False):
        """
        Given a route ID and a number of laps, load the route manifest and segments,
        and return a list of segment dictionaries that the route travels through.

        The list is the game-dictionary segments whose onRoutes contains this
        route. Sauce places them. Orange jerseys and lap badges stay when the
        dictionary lists them. include_lap_banners is accepted and ignored:
        a banner Zwift did not assign to this route is not added.

        isFinish is set when the arch that ends the lap is one of those
        dictionary segments. La Boucle ends at Champs-Élysées, which is not a
        La Boucle segment, so that checklist has no finish row.
        """
        # Membership is onRoutes. The flag used to add banners the dictionary
        # does not assign to this route.
        _ = include_lap_banners
        # Resolve data files relative to backend/services, regardless of process CWD.
        # This avoids intermittent "missing segments" when the app is started from
        # different working directories.
        base_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
        
        # Load routes
        routes_file = os.path.join(base_dir, "data/routes.json")
        try:
            with open(routes_file, "r", encoding="utf-8") as f:
                routes = json.load(f)
        except Exception as e:
            print(f"Error loading routes file from {routes_file}: {e}")
            return []

        # Find the route with the matching route_id.
        route = next((r for r in routes if str(r.get("id")) == str(route_id)), None)
        if route is None:
            print(f"Route with id {route_id} not found.")
            return []

        # Prefer worldId for filesystem paths (Sauce courseId differs, e.g. Watopia 1 vs 6).
        world_id = route.get("worldId") or route.get("courseId")
        if world_id is None:
            print("Unable to determine worldId from route data.")
            return []

        # Load the segments file for this world
        segments_file = os.path.join(base_dir, f"data/worlds/{world_id}/segments.json")
        try:
            with open(segments_file, "r", encoding="utf-8") as f:
                segments_data = json.load(f)
        except Exception as e:
            print(f"Error loading segments file for world {world_id}: {e}")
            return []

        # Mirror Sauce behavior: a small set of segment IDs should only be matched
        # when both start and finish are inside the current road section.
        strict_ids_file = os.path.join(base_dir, "data/segRequireStartEnd.json")
        strict_start_end_ids = set()
        try:
            with open(strict_ids_file, "r", encoding="utf-8") as f:
                strict_start_end_ids = {str(v) for v in json.load(f) or []}
        except Exception:
            # Optional file: keep behavior if the list is missing/unreadable.
            strict_start_end_ids = set()

        # Partition the manifest into lead‑in and main entries.
        manifest = list(route.get("manifest", []))
        if not any(entry.get("leadin") for entry in manifest):
            synthesized_leadin = synthesize_leadin_entries(route, base_dir)
            if synthesized_leadin:
                manifest = synthesized_leadin + manifest

        leadin_entries = [entry for entry in manifest if entry.get("leadin")]
        main_entries   = [entry for entry in manifest if not entry.get("leadin")]

        if not main_entries:
            print("No main lap manifest entries found.")
            return []

        # Build a list of manifest occurrences.
        # Each occurrence is a tuple: (entry, lap, order)
        occurrences = []
        order_counter = 0
        for entry in leadin_entries:
            # Keep lead-in separate from race laps.
            occurrences.append((entry, 0, order_counter))
            order_counter += 1
        for entry in main_entries:
            occurrences.append((entry, 1, order_counter))
            order_counter += 1
        for lap in range(2, int(laps) + 1):
            for entry in main_entries:
                occurrences.append((entry.copy(), lap, order_counter))
                order_counter += 1

        # Pre-index segments by roadId for faster lookup.
        # Always place lap/loop banners so the real finish can be identified.
        # The picker drops them again below; finish detection keeps them.
        segments_by_road = defaultdict(list)
        for seg in segments_data:
            road_id = seg.get("roadId")
            if road_id is not None:
                segments_by_road[road_id].append(seg)

        all_found_segments = []
        
        # Track active segments: segment_id -> { "start_order": order, "lap": lap, ... }
        # Key is (segment_id, direction) just to be safe, though ID should be unique.
        active_segments = {} 

        def finish_segment(seg_id, direction, current_order, current_lap, seg_data, finish_ratio=0.5):
            key = (seg_id, direction)
            if key in active_segments:
                start_info = active_segments.pop(key)
                
                # Label by finish lap: a banner crossed at the end of lap N belongs
                # to lap N even if its start was armed during lead-in / lap N-1.
                # (Using start lap hid the last race lap on many loop routes.)
                seg_copy = seg_data.copy()
                seg_copy["lap"] = current_lap
                seg_copy["direction"] = direction
                seg_copy["id"] = seg_id
                seg_copy["lapBanner"] = (
                    seg_data.get("archId") is None or bool(seg_data.get("requiresAllCheckpoints"))
                )
                # Use finish order with a within-entry ratio to keep chronological ordering
                # when multiple segments finish in the same route entry.
                seg_copy["order"] = current_order + max(0.0, min(1.0, float(finish_ratio)))
                
                all_found_segments.append(seg_copy)

        def start_segment(seg_id, direction, current_order, current_lap):
            key = (seg_id, direction)
            if key not in active_segments:
                active_segments[key] = {
                    "start_order": current_order,
                    "lap": current_lap
                }

        # Iterate through the route chronologically
        for entry, lap, order in occurrences:
            road_id = entry.get("roadId")
            if road_id is None:
                continue
            
            is_reverse_entry = bool(entry.get("reverse", False))
            entry_start = entry.get("start", 0)
            entry_end = entry.get("end", 0)
            
            # Define the interval on the road covered by this entry
            # We treat everything as [min, max] range checks, but order matters for Start/Finish logic.
            min_p = min(entry_start, entry_end)
            max_p = max(entry_start, entry_end)
            
            # Get segments on this road
            road_segments = segments_by_road.get(road_id, [])
            
            for seg in road_segments:
                # Determine segment parameters based on our direction of travel
                # If we are traversing the road in Reverse, we look for Reverse segments?
                # Or do we look for Forward segments that we traverse backwards?
                # Usually Zwift segments are directional. You only trigger them if you go the right way.
                # So if entry is Reverse, we look for Reverse segments.
                
                if is_reverse_entry:
                    seg_id = seg.get("idReverse")
                    s_start = seg.get("roadStartReverse")
                    s_finish = seg.get("roadFinish") # Assuming roadFinish is shared or same coordinate?
                    # Note: Some data might have roadFinishReverse? Usually not.
                    # If roadStartReverse > roadFinish, it implies decreasing metric traversal.
                    direction = "reverse"
                else:
                    seg_id = seg.get("idForward")
                    s_start = seg.get("roadStartForward")
                    s_finish = seg.get("roadFinish")
                    direction = "forward"
                
                if not seg_id or s_start is None or s_finish is None:
                    continue

                # Road fractions in the manifest and the segment file do not always
                # meet exactly. Richmond's finish banner sits a few millionths past
                # the last manifest endpoint.
                road_epsilon = 1e-5
                has_start = (min_p - road_epsilon) <= s_start <= (max_p + road_epsilon)
                has_finish = (min_p - road_epsilon) <= s_finish <= (max_p + road_epsilon)
                
                finish_ratio = 0.5
                if has_finish:
                    # Manifest bounds are not always ordered by travel direction.
                    # For reverse entries, treat traversal as high -> low across the
                    # covered interval so within-entry ordering matches in-game order.
                    if is_reverse_entry:
                        travel_start = max(entry_start, entry_end)
                        travel_end = min(entry_start, entry_end)
                    else:
                        travel_start = min(entry_start, entry_end)
                        travel_end = max(entry_start, entry_end)

                    span = travel_end - travel_start
                    if span != 0:
                        finish_ratio = (s_finish - travel_start) / span

                if str(seg_id) in strict_start_end_ids and not (has_start and has_finish):
                    continue

                if not has_start and not has_finish:
                    continue
                
                # Determine traversal order
                # If is_reverse_entry is True, we move from High metric to Low metric?
                # (Assuming reverse means against the road coordinate system)
                # If is_reverse_entry is False, we move from Low to High.
                
                # Logic:
                # 1. Did we cross Start?
                # 2. Did we cross Finish?
                # 3. In what order?
                
                # We can simplify:
                # If we have both, check their relative positions vs traversal direction.
                
                if has_start and has_finish:
                    # Both points in this single entry.
                    #
                    # Point/lap banners (start == finish), e.g. Champs-Élysées:
                    # count only when the route arrives at the banner (end of travel
                    # through this entry), not when it departs from it.
                    if s_start == s_finish:
                        if is_reverse_entry:
                            travel_start = max(entry_start, entry_end)
                            travel_end = min(entry_start, entry_end)
                        else:
                            travel_start = min(entry_start, entry_end)
                            travel_end = max(entry_start, entry_end)
                        if abs(s_finish - travel_end) <= abs(s_finish - travel_start):
                            start_segment(seg_id, direction, order, lap)
                            finish_segment(seg_id, direction, order, lap, seg, finish_ratio)
                    elif not is_reverse_entry:
                        # Moving Low -> High
                        if s_start < s_finish:
                            start_segment(seg_id, direction, order, lap)
                            finish_segment(seg_id, direction, order, lap, seg, finish_ratio)
                        else:
                            # Start > Finish: hit Finish then Start while riding forward.
                            finish_segment(seg_id, direction, order, lap, seg, finish_ratio)
                            start_segment(seg_id, direction, order, lap)
                    else:
                        # Moving High -> Low
                        if s_start > s_finish:
                            start_segment(seg_id, direction, order, lap)
                            finish_segment(seg_id, direction, order, lap, seg, finish_ratio)
                        else:
                            finish_segment(seg_id, direction, order, lap, seg, finish_ratio)
                            start_segment(seg_id, direction, order, lap)

                elif has_start:
                    # Only Start is in range.
                    start_segment(seg_id, direction, order, lap)

                elif has_finish:
                    # Only Finish is in range. Routes sometimes join a road slightly
                    # after the official start (e.g. La Boucle / Montmartre KOM). Still
                    # count the segment when travel direction matches the banner.
                    key = (seg_id, direction)
                    if key not in active_segments:
                        compatible = (
                            (not is_reverse_entry and s_start <= s_finish)
                            or (is_reverse_entry and s_start >= s_finish)
                        )
                        if compatible:
                            start_segment(seg_id, direction, order, lap)
                    finish_segment(seg_id, direction, order, lap, seg, finish_ratio)

            # Add segmentIds to the entry for debugging/frontend use
            # This is a bit tricky now as segments might span entries.
            # We can list segments that *started* or *finished* or are *active* in this entry.
            # The original code listed segments fully contained or merged.
            # Let's list segments that finish in this entry, or are fully contained.
            # For now, we can skip populating entry["segmentIds"] or populate it with what we found.
            # The frontend might rely on it.
            # Let's populate it with segments that FINISHED here.
            # (We can't easily modify the 'entry' in 'occurrences' to include started-but-not-finished without more state).
            # But the return value 'result' is what matters most.
            
        # Sort by appearance order
        all_found_segments.sort(key=lambda s: s.get("order", 0))

        dictionary = self.segments_on_route(route_id)
        if not dictionary:
            return []

        # The arch that ends the lap may be a banner the dictionary does not
        # assign to this route. Only a dictionary segment can be the finish row.
        finish_id = None
        for seg in all_found_segments:
            if int(seg.get("lap") or 0) >= 1:
                finish_id = str(seg.get("id"))

        kept = [
            seg for seg in all_found_segments
            if str(seg.get("id")) in dictionary
        ]
        found_ids = {str(seg.get("id")) for seg in kept}
        lap_count = max(1, int(laps))
        for entry in route.get("segments") or []:
            if not isinstance(entry, dict) or entry.get("id") is None:
                continue
            seg_id = str(entry.get("id"))
            if seg_id not in dictionary or seg_id in found_ids:
                continue
            try:
                offset = float(entry.get("offset"))
            except (TypeError, ValueError):
                offset = 0.0
            leadin = bool(entry.get("leadinOnly")) or offset < 0
            row = dictionary[seg_id]
            direction = row.get("direction") or "forward"
            laps_for_entry = [0] if leadin else list(range(1, lap_count + 1))
            for lap in laps_for_entry:
                kept.append({
                    "id": seg_id,
                    "direction": direction,
                    "lap": lap,
                    "order": (lap * 1_000_000) + offset,
                })
            found_ids.add(seg_id)

        kept.sort(key=lambda s: (int(s.get("lap") or 0), float(s.get("order") or 0)))

        segment_counts = {}
        for seg in kept:
            seg_id = str(seg.get("id"))
            segment_counts.setdefault(seg_id, 0)
            segment_counts[seg_id] += 1
            seg["count"] = segment_counts[seg_id]

        finish_seg = None
        if finish_id in dictionary:
            for seg in kept:
                if str(seg.get("id")) == finish_id and int(seg.get("lap") or 0) >= 1:
                    finish_seg = seg
        if finish_seg is not None:
            finish_seg["isFinish"] = True

        result = []
        for seg in kept:
            row = dictionary.get(str(seg.get("id"))) or {}
            item = {
                "name": dictionary_segment_name(row) or seg.get("nameForward"),
                "direction": seg.get("direction") or row.get("direction"),
                "count": seg.get("count"),
                "id": seg.get("id"),
                "lap": seg.get("lap"),
                "marker": jersey_marker(row.get("jerseyIconPath")),
            }
            if seg.get("isFinish"):
                item["isFinish"] = True
            result.append(item)

        return result
