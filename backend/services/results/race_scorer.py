from collections import defaultdict

class RaceScorer:
    def __init__(self, finish_points_scheme, sprint_points_scheme):
        self.finish_points_scheme = finish_points_scheme or []
        self.sprint_points_scheme = sprint_points_scheme or []

    def calculate_results(self, riders, race_config, segment_efforts_map=None):
        """
        Unified method to calculate points for a list of riders.
        
        riders: List of rider dictionaries. Must contain 'zwiftId', 'finishTime', 'name'.
                May already contain 'sprintData' (recalc mode) or not.
        
        race_config: Dict containing:
            - manualDQs, manualDeclassifications, manualExclusions (sets/lists of strings)
            - sprints (list of sprint configs)
            - segmentType ('sprint' or 'split')
            
        segment_efforts_map: (Optional) Raw segment results from Zwift { sprint_id: [entries...] }.
                             If provided, will process and populate 'sprintData' on riders.
        """
        manual_dqs = set(str(x) for x in race_config.get('manualDQs', []))
        manual_declass = set(str(x) for x in race_config.get('manualDeclassifications', []))
        manual_exclusions = set(str(x) for x in race_config.get('manualExclusions', []))
        
        # 1. Filter Exclusions
        active_riders = [r for r in riders if str(r.get('zwiftId')) not in manual_exclusions]
        
        # 2. Metadata & Classification
        valid_riders = []
        declass_riders = []
        dq_riders = []
        
        # Map for quick lookup
        rider_map = {str(r['zwiftId']): r for r in active_riders}

        for rider in active_riders:
            zid = str(rider.get('zwiftId'))
            
            # Reset calculation fields
            rider['disqualified'] = False
            rider['declassified'] = False
            rider['finishRank'] = 0
            rider['finishPoints'] = 0
            rider['sprintPoints'] = 0
            # Ensure sprintDetails/Data exist
            if 'sprintDetails' not in rider: rider['sprintDetails'] = {}
            if 'sprintData' not in rider: rider['sprintData'] = {}

            if zid in manual_dqs:
                rider['disqualified'] = True
                rider['finishRank'] = 9999
                dq_riders.append(rider)
            elif zid in manual_declass:
                rider['declassified'] = True
                declass_riders.append(rider)
            else:
                valid_riders.append(rider)

        # 3. Calculate Finish Points
        # Sort valid by time (0 = DNF, put at end)
        valid_riders.sort(key=lambda x: x.get('finishTime', 0) if x.get('finishTime', 0) > 0 else 999999999999)
        
        # Valid Riders
        for rank, rider in enumerate(valid_riders):
            if rider.get('finishTime', 0) > 0:
                points = self.finish_points_scheme[rank] if rank < len(self.finish_points_scheme) else 0
                rider['finishRank'] = rank + 1
                rider['finishPoints'] = points
            else:
                rider['finishRank'] = 0 # DNF
                rider['finishPoints'] = 0

        # Declassified Riders (Last Place Points)
        last_valid_rank = len([r for r in valid_riders if r.get('finishTime', 0) > 0])
        last_place_points = self.finish_points_scheme[last_valid_rank] if last_valid_rank < len(self.finish_points_scheme) else 0
        
        for rider in declass_riders:
            rider['finishRank'] = last_valid_rank + 1
            rider['finishPoints'] = last_place_points

        # 4. Process Sprint Data (If fresh data provided)
        if segment_efforts_map:
            self._map_segment_efforts(active_riders, segment_efforts_map, race_config.get('sprints', []))

        # 5. Calculate Sprint Points (using data on rider objects)
        self._calculate_sprint_points(active_riders, race_config, manual_dqs, manual_declass)

        # 6. Sum Total & Final Sort
        for rider in active_riders:
            rider['totalPoints'] = rider.get('finishPoints', 0) + rider.get('sprintPoints', 0)

        def _sort_key(r):
            # Sort by Total Points (Desc), then Finish Time (Asc)
            ft = r.get('finishTime', 0)
            ft_key = ft if ft > 0 else 999999999999
            return (r.get('totalPoints', 0), -ft_key)

        active_riders.sort(key=_sort_key, reverse=True)
        return active_riders

    def _map_segment_efforts(self, riders, segment_efforts_map, sprints_config):
        """
        Maps raw Zwift segment results to rider['sprintData'].
        Does ranking by time but does NOT award points yet.
        """
        if not segment_efforts_map or not sprints_config:
            return

        riders_by_id = {int(r['zwiftId']): r for r in riders if r.get('zwiftId')}
        participant_ids = set(riders_by_id.keys())

        # Group sprints by Zwift Segment ID for processing
        sprints_by_segment_id = defaultdict(list)
        for s in sprints_config:
            sprints_by_segment_id[s['id']].append(s)

        for seg_id_str, raw_results in segment_efforts_map.items():
            seg_id = int(seg_id_str) if seg_id_str.isdigit() else seg_id_str
            sprints_for_seg = sprints_by_segment_id.get(str(seg_id)) or sprints_by_segment_id.get(int(seg_id))
            
            if not sprints_for_seg or not raw_results:
                continue

            # Filter results to only include our riders
            results_list = raw_results.get('results', []) if isinstance(raw_results, dict) else raw_results
            valid_entries = [e for e in results_list if e.get('athleteId') in participant_ids]
            
            # Group entries by athlete to handle multiple laps
            # Sort by worldTime (earliest first) to determine lap count
            entries_by_athlete = defaultdict(list)
            for entry in valid_entries:
                entries_by_athlete[entry['athleteId']].append(entry)
            
            for athlete_id, entries in entries_by_athlete.items():
                entries.sort(key=lambda x: int(x.get('worldTime', 0)))
                
                # Assign to configured sprints
                for i, entry in enumerate(entries):
                    count = i + 1 # 1-based lap count
                    
                    # Find matching sprint config for this count
                    matching_sprint = next((s for s in sprints_for_seg if s['count'] == count), None)
                    if matching_sprint:
                        sprint_key = matching_sprint.get('key') or f"{matching_sprint['id']}_{matching_sprint['count']}"
                        
                        rider = riders_by_id.get(athlete_id)
                        if rider:
                            if 'sprintData' not in rider: rider['sprintData'] = {}
                            
                            rider['sprintData'][sprint_key] = {
                                'time': int(entry.get('elapsed', 0)),
                                'worldTime': int(entry.get('worldTime', 0)),
                                'avgPower': int(entry.get('avgPower', 0))
                            }

    def _calculate_sprint_points(self, riders, race_config, manual_dqs, manual_declass):
        """
        Iterates over rider['sprintData'] and awards points based on scheme.
        """
        # Determine segment types (sprint vs split)
        global_type = race_config.get('segmentType', 'sprint')
        sprint_type_map = {}
        for s in race_config.get('sprints', []):
            k = s.get('key') or f"{s['id']}_{s['count']}"
            sprint_type_map[k] = s.get('type') or global_type

        # Collect all sprint keys present in data
        all_keys = set()
        for r in riders:
            if r.get('sprintData'):
                all_keys.update(r['sprintData'].keys())

        for key in all_keys:
            segment_type = sprint_type_map.get(key, global_type)
            is_split = segment_type == 'split'

            # 1. Collect Valid Efforts
            efforts = []
            for r in riders:
                data = r.get('sprintData', {}).get(key)
                if data:
                    efforts.append({
                        'zwiftId': str(r['zwiftId']),
                        'rider': r,
                        'time': data.get('time', 0),
                        'worldTime': data.get('worldTime', 0)
                    })
            
            # 2. Sort (Fastest first)
            # Use worldTime as primary sort if available? No, elapsed time is speed.
            # Wait, original code used worldTime to determine ORDER on road, but elapsed time for speed ranking?
            # Original code: "Sort by worldTime (earliest = fastest through segment = rank 1)"
            # Wait, that logic in original code assumes "First across the line wins" (FTS) vs "Fastest Segment" (FAL).
            # Zwift API 'elapsed' is duration. 'worldTime' is when they crossed the line.
            # Original code comment said: "Use worldTime for ranking (lower is better = faster through segment)" - This comment was confusing or implied First Across Line mode.
            # However, standard league rules usually use FAL (Fastest Across Line) for primes? 
            # Actually, standard Zwift segments are FAL (Fastest time). FTS (First to Screen) is distinct.
            # The original code at line 329 said: `sprint_entries.sort(key=lambda x: x['worldTime'])`
            # This implies FIRST ACROSS THE LINE (FTS).
            # AND line 772 (in the live fetch block) calls `_filter_segment_results` which has `sort_by="worldTime"`.
            # So the league uses FTS (Order of crossing), NOT FAL (Duration).
            # I will preserve this behavior: Sort by worldTime.
            
            efforts.sort(key=lambda x: x['worldTime'])

            # 3. Assign Ranks & Points with tie handling
            # Standard competition ranking: ties share same rank/points, next position is skipped
            # E.g., if points are [10,9,8,7] and first two tie: 10,10,8,7
            
            # First pass: filter to valid riders only and group by worldTime
            valid_efforts = []
            for effort in efforts:
                zid = effort['zwiftId']
                is_valid = (zid not in manual_dqs) and (zid not in manual_declass)
                if is_valid:
                    valid_efforts.append(effort)
            
            # Assign ranks and points with tie handling
            position = 0  # 0-based position in points scheme
            i = 0
            while i < len(valid_efforts):
                current_time = valid_efforts[i]['worldTime']
                
                # Find all riders with the same worldTime (ties)
                tie_group = [valid_efforts[i]]
                j = i + 1
                while j < len(valid_efforts) and valid_efforts[j]['worldTime'] == current_time:
                    tie_group.append(valid_efforts[j])
                    j += 1
                
                # All riders in tie group get the same rank (position + 1, 1-based)
                rank = position + 1
                
                # Get points for this position (if available and not a split)
                points = 0
                if not is_split and position < len(self.sprint_points_scheme):
                    points = self.sprint_points_scheme[position]
                
                # Assign to all riders in the tie group
                for effort in tie_group:
                    rider = effort['rider']
                    rider['sprintData'][key]['rank'] = rank
                    
                    if is_split:
                        rider['sprintDetails'][key] = effort['worldTime']
                    else:
                        if points > 0:
                            rider['sprintDetails'][key] = points
                            rider['sprintPoints'] += points
                
                # Skip positions equal to the size of the tie group
                position += len(tie_group)
                i = j
            
            # Mark invalid riders (DQ/declassified) with rank 0
            for effort in efforts:
                zid = effort['zwiftId']
                is_valid = (zid not in manual_dqs) and (zid not in manual_declass)
                if not is_valid:
                    rider = effort['rider']
                    rider['sprintData'][key]['rank'] = 0
