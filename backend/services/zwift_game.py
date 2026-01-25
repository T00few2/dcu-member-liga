import requests
import time
import os
import json
from collections import defaultdict

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

    def get_event_segments(self, route_id, laps=1):
        """
        Given a route ID and a number of laps, load the route manifest and segments,
        and return a list of segment dictionaries that the route travels through.
        """
        # Ensure we look in the backend folder relative to this file or CWD
        # Cloud Functions CWD is usually the root of the source
        base_dir = os.getcwd()
        
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

        # Determine the course/world ID.
        course_id = route.get("courseId") or route.get("worldId")
        if course_id is None:
            print("Unable to determine courseId from route data.")
            return []

        # Load the segments file for this course
        segments_file = os.path.join(base_dir, f"data/worlds/{course_id}/segments.json")
        try:
            with open(segments_file, "r", encoding="utf-8") as f:
                segments_data = json.load(f)
        except Exception as e:
            print(f"Error loading segments file for course {course_id}: {e}")
            return []

        # Partition the manifest into lead‑in and main entries.
        manifest = route.get("manifest", [])
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
            occurrences.append((entry, 1, order_counter))
            order_counter += 1
        for entry in main_entries:
            occurrences.append((entry, 1, order_counter))
            order_counter += 1
        for lap in range(2, int(laps) + 1):
            for entry in main_entries:
                occurrences.append((entry.copy(), lap, order_counter))
                order_counter += 1

        # Pre-index segments by roadId for faster lookup
        segments_by_road = defaultdict(list)
        for seg in segments_data:
            if seg.get("archId") is None:
                continue
            road_id = seg.get("roadId")
            if road_id is not None:
                segments_by_road[road_id].append(seg)

        all_found_segments = []
        
        # Track active segments: segment_id -> { "start_order": order, "lap": lap, ... }
        # Key is (segment_id, direction) just to be safe, though ID should be unique.
        active_segments = {} 

        def finish_segment(seg_id, direction, current_order, current_lap, seg_data):
            key = (seg_id, direction)
            if key in active_segments:
                start_info = active_segments.pop(key)
                
                # Construct the found segment object
                # Use the lap from when it started (or finished? usually finish lap matters for timing)
                # But here we want to list them in order.
                # Let's attribute to the lap where it finishes.
                
                seg_copy = seg_data.copy()
                seg_copy["lap"] = current_lap
                seg_copy["direction"] = direction
                seg_copy["id"] = seg_id
                # Use the order from the finish point so it sorts correctly in the timeline
                seg_copy["order"] = current_order 
                
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

                # Check if points are within the road interval we traversed
                # We use a small epsilon for float comparisons if needed, but simple <= is usually ok.
                # We relax strict inequality to handle boundary conditions.
                
                # Is Start point in this entry?
                has_start = (min_p <= s_start <= max_p)
                
                # Is Finish point in this entry?
                has_finish = (min_p <= s_finish <= max_p)
                
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
                    
                    # Check segment direction vs traversal direction
                    # Forward Entry (Low->High): Segment must be Low->High (Start < Finish)
                    # Reverse Entry (High->Low): Segment must be High->Low (Start > Finish)?
                    # Or does 'reverse' segment mean defined such that Start < Finish but we hit it?
                    # Usually:
                    # Forward Segment: Start=0.2, Finish=0.5. Traversed 0->1. OK.
                    # Reverse Segment: Start=0.8, Finish=0.5. Traversed 1->0. OK.
                    
                    if not is_reverse_entry:
                        # Moving Low -> High
                        if s_start < s_finish:
                            # Start then Finish -> Complete
                            # But wait, if we were already active (from previous lap?), we finish then start?
                            # No, if we are active, we are waiting for finish.
                            # If s_start < s_finish, we hit Start first.
                            # If we were active, it means we missed a finish somewhere? Or loop?
                            # Let's assume standard behavior:
                            # If Start < Finish: Start -> Finish.
                            start_segment(seg_id, direction, order, lap)
                            finish_segment(seg_id, direction, order, lap, seg)
                        else:
                            # Start > Finish (e.g. 0.6 -> 0.4).
                            # Moving Low -> High (0.3 -> 0.7).
                            # We hit Finish (0.4) then Start (0.6).
                            finish_segment(seg_id, direction, order, lap, seg)
                            start_segment(seg_id, direction, order, lap)
                    else:
                        # Moving High -> Low
                        if s_start > s_finish:
                            # Start (0.8) -> Finish (0.5).
                            # Moving 0.9 -> 0.4.
                            # We hit Start first.
                            start_segment(seg_id, direction, order, lap)
                            finish_segment(seg_id, direction, order, lap, seg)
                        else:
                            # Start (0.4) < Finish (0.6).
                            # Moving 0.9 -> 0.3.
                            # We hit Finish (0.6) then Start (0.4).
                            finish_segment(seg_id, direction, order, lap, seg)
                            start_segment(seg_id, direction, order, lap)
                            
                elif has_start:
                    # Only Start is in range.
                    start_segment(seg_id, direction, order, lap)
                    
                elif has_finish:
                    # Only Finish is in range.
                    finish_segment(seg_id, direction, order, lap, seg)

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
            
        # ----------------------------
        # Compute occurrence counts.
        segment_counts = {}
        for seg in all_found_segments:
            seg_id = seg.get("id")
            if seg_id is None:
                continue
            segment_counts.setdefault(seg_id, 0)
            segment_counts[seg_id] += 1
            seg["count"] = segment_counts[seg_id]

        # We used to deduplicate here, but if a segment appears multiple times in a lap (e.g. figure 8)
        # we want to be able to select each occurrence individually.
        # The 'count' field makes them unique occurrences.
        
        # Sort by appearance order
        all_found_segments.sort(key=lambda s: s.get("order", 0))

        result = []
        for seg in all_found_segments:
            result.append({
                "name": seg.get("nameForward"),
                "direction": seg.get("direction"),
                "count": seg.get("count"), # Occurrence number (1st time, 2nd time...)
                "id": seg.get("id"),
                "lap": seg.get("lap")
            })

        return result
