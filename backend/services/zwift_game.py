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

        all_found_segments = []
        # ----------------------------
        # First pass: Process each manifest occurrence individually for "normal" segments.
        # ----------------------------
        for entry, lap, order in occurrences:
            entry_road_id = entry.get("roadId")
            if entry_road_id is None:
                continue
            entry_reverse = bool(entry.get("reverse", False))
            entry_start = entry.get("start")
            entry_end   = entry.get("end")
            if entry_start is None or entry_end is None:
                continue

            matching_segments = []
            for seg in segments_data:
                if seg.get("roadId") != entry_road_id:
                    continue
                if seg.get("archId") is None:
                    continue

                if not entry_reverse:
                    seg_start = seg.get("roadStartForward")
                    seg_finish = seg.get("roadFinish")
                    if seg_start is None or seg_finish is None:
                        continue
                    # Skip full‑circuit segments here.
                    if seg_start == seg_finish:
                        continue
                    if entry_start <= seg_start and entry_end >= seg_finish:
                        seg_copy = seg.copy()
                        seg_copy["lap"] = lap
                        seg_copy["direction"] = "forward"
                        seg_copy["id"] = seg.get("idForward")
                        seg_copy["order"] = order
                        matching_segments.append(seg_copy)
                else:
                    seg_start = seg.get("roadStartReverse")
                    seg_finish = seg.get("roadFinish")
                    if seg_start is None or seg_finish is None:
                        continue
                    if seg_start == seg_finish:
                        continue
                    if entry_end >= seg_start and entry_start <= seg_finish:
                        seg_copy = seg.copy()
                        seg_copy["lap"] = lap
                        seg_copy["direction"] = "reverse"
                        seg_copy["id"] = seg.get("idReverse")
                        seg_copy["order"] = order
                        matching_segments.append(seg_copy)
            
            # sort segments along the road
            if not entry_reverse:
                matching_segments.sort(
                    key=lambda s: (
                        s.get("roadStartForward") is None,
                        s.get("roadStartForward", float("inf")),
                    )
                )
            else:
                matching_segments.sort(
                    key=lambda s: (
                        s.get("roadStartReverse") is None,
                        s.get("roadStartReverse", float("inf")),
                    ),
                    reverse=True,
                )

            entry["segmentIds"] = [s.get("id") for s in matching_segments]
            all_found_segments.extend(matching_segments)

        # ----------------------------
        # Second pass: Handle full‑circuit segments by merging manifest entries.
        # ----------------------------
        groups = defaultdict(list)
        for entry, lap, order in occurrences:
            road_id = entry.get("roadId")
            if road_id is None:
                continue
            direction = "reverse" if entry.get("reverse", False) else "forward"
            groups[(lap, road_id, direction)].append((entry, order))

        # -- Forward groups merging --
        for (lap, road_id, direction), group_list in groups.items():
            if direction != "forward":
                continue
            if len(group_list) < 2:
                continue
            group_list.sort(key=lambda tup: tup[1])
            group_entries = [entry for entry, _ in group_list]
            candidate_order = min(order for _, order in group_list)
            
            if not (any(entry.get("start") == 0 for entry in group_entries) and
                    any(entry.get("end") == 1 for entry in group_entries)):
                continue
            candidate_start = min(entry.get("start", 0) for entry in group_entries)
            candidate_end = max(entry.get("end", 0) for entry in group_entries) + 1

            for seg in segments_data:
                if seg.get("roadId") != road_id or seg.get("archId") is None:
                    continue
                seg_start = seg.get("roadStartForward")
                seg_finish = seg.get("roadFinish")
                if seg_start is None or seg_finish is None or seg_start != seg_finish:
                    continue  # Only full‑circuit segments.
                seg_point = seg_start
                if candidate_start < seg_point and candidate_end > (seg_point + 1):
                    seg_copy = seg.copy()
                    seg_copy["lap"] = lap
                    seg_copy["direction"] = "forward"
                    seg_copy["id"] = seg.get("idForward")
                    seg_copy["order"] = candidate_order
                    all_found_segments.append(seg_copy)
                    for entry in group_entries:
                        entry.setdefault("segmentIds", []).append(seg.get("idForward"))

        # -- Reverse groups merging --
        for (lap, road_id, direction), group_list in groups.items():
            if direction != "reverse":
                continue
            if len(group_list) < 2:
                continue
            group_list.sort(key=lambda tup: tup[1])
            group_entries = [entry for entry, _ in group_list]
            candidate_order = min(order for _, order in group_list)
            for i in range(len(group_entries) - 1):
                current = group_entries[i]
                nxt = group_entries[i+1]
                if (current.get("start") == 0 and current.get("end") == 1 and
                    nxt.get("end") == 1 and nxt.get("start") == 0):
                    flipped_current_start = 1 - current.get("end")
                    flipped_current_end = 1 - current.get("start")
                    flipped_next_start = 1 - nxt.get("end")
                    flipped_next_end = 1 - nxt.get("start")
                    candidate_flipped_start = min(flipped_current_start, flipped_next_start)
                    candidate_flipped_end = max(flipped_current_end, flipped_next_end) + 1
                    journey_length = candidate_flipped_end - candidate_flipped_start
                    if journey_length <= 1:
                        continue
                    for seg in segments_data:
                        if seg.get("roadId") != road_id or seg.get("archId") is None:
                            continue
                        seg_start = seg.get("roadStartReverse")
                        seg_finish = seg.get("roadFinish")
                        if seg_start is None or seg_finish is None or seg_start != seg_finish:
                            continue
                        flipped_seg_point = 1 - seg_start
                        if candidate_flipped_start < flipped_seg_point and candidate_flipped_end > (flipped_seg_point + 1):
                            seg_copy = seg.copy()
                            seg_copy["lap"] = lap
                            seg_copy["direction"] = "reverse"
                            seg_copy["id"] = seg.get("idReverse")
                            seg_copy["order"] = candidate_order
                            all_found_segments.append(seg_copy)
                            current.setdefault("segmentIds", []).append(seg.get("idReverse"))
                            nxt.setdefault("segmentIds", []).append(seg.get("idReverse"))

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

        # Deduplicate segments by (lap, id, direction) to avoid showing same segment twice if route wraps slightly
        unique_segments = {}
        for seg in all_found_segments:
            key = (seg.get("lap"), seg.get("id"), seg.get("direction"))
            if key not in unique_segments:
                unique_segments[key] = seg
            else:
                unique_segments[key]["count"] = max(unique_segments[key]["count"], seg["count"])
        
        all_found_segments = list(unique_segments.values())
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
