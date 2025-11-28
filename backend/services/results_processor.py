import logging
from datetime import datetime, timedelta
from collections import defaultdict
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService

logger = logging.getLogger('ResultsProcessor')

class ResultsProcessor:
    def __init__(self, db, zwift_service: ZwiftService, game_service: ZwiftGameService):
        self.db = db
        self.zwift = zwift_service
        self.game = game_service

    def process_race_results(self, race_id):
        """
        Main entry point to process results for a given race ID (Firestore ID).
        """
        if not self.db:
            raise Exception("Database not available")

        print(f"Processing results for race: {race_id}")

        # 1. Fetch Race Config
        race_doc = self.db.collection('races').document(race_id).get()
        if not race_doc.exists:
            raise Exception(f"Race {race_id} not found")
        
        race_data = race_doc.to_dict()
        event_id = race_data.get('eventId')
        
        if not event_id:
            raise Exception("No Zwift Event ID linked to this race")

        # 2. Fetch League Settings (Point Schemes)
        settings_doc = self.db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
        finish_points_scheme = settings.get('finishPoints', [])
        sprint_points_scheme = settings.get('sprintPoints', [])

        # 3. Fetch Registered Participants (to map ZwiftID -> Name/Team)
        users_ref = self.db.collection('users')
        users_docs = users_ref.stream()
        registered_riders = {} # zwiftId -> {name, id, ...}
        for doc in users_docs:
            data = doc.to_dict()
            zid = data.get('zwiftId')
            if zid:
                registered_riders[str(zid)] = data
        
        print(f"Found {len(registered_riders)} registered riders in database.")

        # 4. Fetch Event Info from Zwift
        try:
            event_info = self.zwift.get_event_info(event_id)
        except Exception as e:
            raise Exception(f"Failed to fetch event info from Zwift: {e}")

        # 5. Identify Subgroups (Categories)
        subgroups = self._extract_subgroups(event_info)
        print(f"Found {len(subgroups)} subgroups in event.")
        
        all_results = {} # category -> results_list

        for subgroup in subgroups:
            category_label = subgroup['subgroupLabel'] # e.g. "A", "B"
            subgroup_id = subgroup['id']
            start_time_str = subgroup['eventSubgroupStart']
            
            print(f"Processing Subgroup {category_label} (ID: {subgroup_id})")
            
            # Parse start time
            try:
                clean_time = start_time_str.replace('Z', '+0000')
                start_time = datetime.strptime(clean_time, '%Y-%m-%dT%H:%M:%S.%f%z')
            except Exception as e:
                logger.error(f"Time parse error for {category_label}: {e}")
                continue

            # A. Fetch Finish Results
            finish_results_raw = self.zwift.get_event_results(subgroup_id)
            print(f"  Fetched {len(finish_results_raw)} raw finish results.")
            
            # Filter to only registered riders
            finishers = []
            for entry in finish_results_raw:
                profile = entry.get('profileData', {})
                zid = str(profile.get('id') or entry.get('profileId'))
                
                # Only process if rider is registered in our league
                if zid in registered_riders:
                    finishers.append({
                        'zwiftId': zid,
                        'time': entry.get('activityData', {}).get('durationInMilliseconds', 0),
                        'name': registered_riders[zid].get('name'),
                        'info': registered_riders[zid]
                    })
            
            print(f"  Matched {len(finishers)} registered finishers.")
            
            # Sort by time
            finishers.sort(key=lambda x: x['time'])

            # Assign Finish Points
            processed_riders = {} # zid -> result_obj
            
            for rank, rider in enumerate(finishers):
                points = finish_points_scheme[rank] if rank < len(finish_points_scheme) else 0
                
                res = {
                    'zwiftId': rider['zwiftId'],
                    'name': rider['name'],
                    'finishTime': rider['time'],
                    'finishRank': rank + 1,
                    'finishPoints': points,
                    'sprintPoints': 0,
                    'totalPoints': points,
                    'sprintDetails': {} # segment_key -> points
                }
                processed_riders[rider['zwiftId']] = res

            # B. Calculate Sprint Points
            # Identify which segments are "in play" for this race
            selected_sprints = race_data.get('sprints', []) # list of full segment objects
            
            if selected_sprints:
                # We need to fetch raw segment results for EACH unique segment ID used
                unique_segment_ids = set(s['id'] for s in selected_sprints)
                
                # Define time window for segment hits (Start to Start + 3h usually safe)
                end_time = start_time + timedelta(hours=3)
                
                segment_data_cache = {} # seg_id -> raw_results
                
                for seg_id in unique_segment_ids:
                    raw = self.zwift.get_segment_results(seg_id, from_date=start_time, to_date=end_time)
                    segment_data_cache[seg_id] = raw

                # Process each selected sprint (Sprint A Lap 1, Sprint A Lap 2...)
                # They are processed in order, but point allocation depends on specific occurrences
                
                # Prepare participant list for filter function
                # CRITICAL FIX: Only include riders in the CURRENT subgroup/category
                participants_list = [
                    {'id': int(zid), 'firstName': processed_riders[zid]['name'], 'lastName': ''} 
                    for zid in processed_riders.keys()
                ]
                
                # Group selected sprints by Segment ID to determine max count needed
                sprints_by_id = defaultdict(list)
                for s in selected_sprints:
                    sprints_by_id[s['id']].append(s)
                
                for seg_id, sprints in sprints_by_id.items():
                    raw_res = segment_data_cache.get(seg_id)
                    if not raw_res:
                        continue
                        
                    # Use the ported logic to filter/rank
                    ranked_table = self._filter_segment_results(raw_res, sprints, participants_list)
                    
                    # Award points
                    for sprint_config in sprints:
                        occ_idx = sprint_config['count'] # 1-based occurrence
                        
                        if occ_idx in ranked_table:
                            rankings = ranked_table[occ_idx] # { 1: {name, id}, 2: ... }
                            
                            # Award points based on Sprint Scheme
                            for p_idx, points in enumerate(sprint_points_scheme):
                                rank = p_idx + 1
                                if rank in rankings:
                                    winner_entry = rankings[rank]
                                    w_zid = str(winner_entry['id'])
                                    
                                    if w_zid in processed_riders:
                                        rider_data = processed_riders[w_zid]
                                        rider_data['sprintPoints'] += points
                                        rider_data['totalPoints'] += points
                                        
                                        # Log detail
                                        sprint_key = sprint_config.get('key') or f"{sprint_config['id']}_{sprint_config['count']}"
                                        rider_data['sprintDetails'][sprint_key] = points

            # Final sorting by Total Points for this category
            final_list = list(processed_riders.values())
            final_list.sort(key=lambda x: x['totalPoints'], reverse=True)
            
            if final_list:
                all_results[category_label] = final_list
                print(f"  Saved {len(final_list)} results for Category {category_label}.")
            else:
                print(f"  No registered finishers for Category {category_label}.")

        # 6. Save Results to Firestore
        self.db.collection('races').document(race_id).update({
            'results': all_results,
            'resultsUpdatedAt': datetime.now()
        })
        
        return all_results

    def calculate_league_standings(self):
        """
        Aggregates results from all races to produce a league table per category.
        Returns: { 'A': [ {name, zwiftId, totalPoints, raceCount, ...} ], 'B': ... }
        """
        if not self.db:
            return {}

        print("Calculating league standings...")
        races_ref = self.db.collection('races')
        docs = races_ref.stream()
        
        league_table = {} # { category: { zwiftId: { ... } } }
        race_count = 0

        for doc in docs:
            race_data = doc.to_dict()
            results = race_data.get('results', {}) # { 'A': [...], 'B': [...] }
            if not results:
                continue
            
            race_count += 1
            for category, riders in results.items():
                if category not in league_table:
                    league_table[category] = {}
                
                for rider in riders:
                    zid = rider['zwiftId']
                    points = rider['totalPoints']
                    
                    if zid not in league_table[category]:
                        league_table[category][zid] = {
                            'zwiftId': zid,
                            'name': rider['name'],
                            'totalPoints': 0,
                            'raceCount': 0,
                            'results': [] 
                        }
                    
                    entry = league_table[category][zid]
                    entry['totalPoints'] += points
                    entry['raceCount'] += 1
                    entry['results'].append({
                        'raceId': doc.id,
                        'points': points
                    })

        print(f"Processed {race_count} races for standings.")

        # Convert to sorted lists
        final_standings = {}
        for category, riders_dict in league_table.items():
            sorted_riders = list(riders_dict.values())
            sorted_riders.sort(key=lambda x: x['totalPoints'], reverse=True)
            final_standings[category] = sorted_riders
            
        return final_standings

    def _extract_subgroups(self, event_info):
        result = []
        event_name = event_info.get("name", "")
        for subgroup in event_info.get("eventSubgroups", []):
            result.append({
                "id": subgroup.get("id"),
                "eventName": event_name,
                "subgroupLabel": subgroup.get("subgroupLabel"),
                "routeId": subgroup.get("routeId"),
                "laps": subgroup.get("laps"),
                "eventSubgroupStart": subgroup.get("eventSubgroupStart"),
            })
        return result

    def _filter_segment_results(self, segment_results, event_sub_id_segments, participants, sort_by="worldTime"):
        """
        Ported from Qt App logic.
        """
        # Filter IDs (integers)
        filter_ids = [p['id'] for p in participants]
        
        raw_list = segment_results.get('results', []) if isinstance(segment_results, dict) else []
        
        filtered_results = [
            result for result in raw_list
            if result.get("athleteId") in filter_ids
        ]

        results_by_athlete = {}
        for entry in filtered_results:
            athlete_id = entry['athleteId']
            results_by_athlete.setdefault(athlete_id, []).append({
                'worldTime': entry.get('worldTime'),
                'elapsed': entry.get('elapsed')
            })

        # Sort by worldTime (lowest best) to determine occurrence order
        for athlete_id, entries in results_by_athlete.items():
            # Ensure int for sorting
            entries.sort(key=lambda x: int(x.get('worldTime', 99999999)))
            for count, entry in enumerate(entries, start=1):
                entry['count'] = count

        max_segment_count = 0
        if event_sub_id_segments:
             max_segment_count = max(seg['count'] for seg in event_sub_id_segments)

        # Lookup map
        participant_lookup = {p['id']: p.get('firstName', 'Unknown') for p in participants}

        entries_by_count = {}
        for athlete_id, entries in results_by_athlete.items():
            for entry in entries:
                count = entry['count']
                if count > max_segment_count:
                    continue
                
                entries_by_count.setdefault(count, []).append({
                    'athleteId': athlete_id,
                    'worldTime': int(entry.get('worldTime', 99999999)),
                    'elapsed': int(entry.get('elapsed', 99999999))
                })

        table = {}
        for count in sorted(entries_by_count.keys()):
            # Sort by the chosen metric (default worldTime)
            sorted_entries = sorted(entries_by_count[count], key=lambda x: x[sort_by])
            
            # Build rank map: 1 -> {name, id}
            table[count] = {
                rank + 1: {
                    "name": participant_lookup.get(entry['athleteId']),
                    "id": entry['athleteId']
                }
                for rank, entry in enumerate(sorted_entries)
            }

        return table
