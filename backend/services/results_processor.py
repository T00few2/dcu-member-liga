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

    def process_race_results(self, race_id, fetch_mode='finishers', filter_registered=True, category_filter=None):
        """
        Main entry point to process results for a given race ID (Firestore ID).
        fetch_mode: 'finishers' (default), 'joined', 'signed_up'
        filter_registered: boolean, if True only include users in DB
        category_filter: string, e.g. 'A', 'B' or None/'All'
        """
        if not self.db:
            raise Exception("Database not available")

        print(f"Processing results for race: {race_id} (Mode: {fetch_mode}, Filter: {filter_registered}, Cat: {category_filter})")

        # 1. Fetch Race Config
        race_doc = self.db.collection('races').document(race_id).get()
        if not race_doc.exists:
            raise Exception(f"Race {race_id} not found")
        
        race_data = race_doc.to_dict()
        
        # Determine Event Sources
        event_sources = []
        event_config = race_data.get('eventConfiguration', [])
        
        if event_config and len(event_config) > 0:
            # Multi-Event Mode
            print("Using Multi-Event Configuration")
            for cfg in event_config:
                event_sources.append({
                    'id': cfg.get('eventId'),
                    'secret': cfg.get('eventSecret'),
                    'customCategory': cfg.get('customCategory') # If set, override category
                })
        else:
            # Legacy/Single Mode
            event_id = race_data.get('eventId')
            event_secret = race_data.get('eventSecret')
            if event_id:
                print("Using Single Event Configuration (Legacy)")
                event_sources.append({
                    'id': event_id,
                    'secret': event_secret,
                    'customCategory': None # Use Zwift Categories (A, B, C...)
                })
        
        if not event_sources:
            raise Exception("No Zwift Event ID(s) linked to this race")

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

        # 4. Process Each Source
        all_results = race_data.get('results', {})
        if not all_results:
            all_results = {} # Ensure it's a dict

        # If filtering by category, we need to know if we should skip certain sources
        # BUT customCategory logic complicates this. We process all and filter at save/assign time.
        
        for source in event_sources:
            self._process_event_source(
                source, 
                race_data,
                registered_riders,
                finish_points_scheme,
                sprint_points_scheme,
                all_results,
                fetch_mode,
                filter_registered,
                category_filter
            )

        # 6. Save Results to Firestore
        self.db.collection('races').document(race_id).update({
            'results': all_results,
            'resultsUpdatedAt': datetime.now()
        })
        
        # 7. Update Global League Standings
        try:
            self.save_league_standings()
        except Exception as e:
            print(f"Error updating league standings: {e}")

        return all_results

    def save_league_standings(self):
        standings = self.calculate_league_standings()
        self.db.collection('league').document('standings').set({
            'standings': standings,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }, merge=True)
        print("Updated league standings document.")
        return standings

    def _process_event_source(self, source, race_data, registered_riders, 
                              finish_points_scheme, sprint_points_scheme, 
                              all_results, fetch_mode, filter_registered, category_filter):
        
        event_id = source['id']
        event_secret = source['secret']
        custom_category = source['customCategory'] # If present, ALL results go here
        
        if not event_id:
            return

        print(f"Processing Event Source: {event_id} (Target Cat: {custom_category or 'Auto'})")

        try:
            event_info = self.zwift.get_event_info(event_id, event_secret)
        except Exception as e:
            print(f"Failed to fetch event info for {event_id}: {e}")
            return

        subgroups = self._extract_subgroups(event_info)
        print(f"  Found {len(subgroups)} subgroups.")
        
        # If we have a custom category, we might want to aggregate ALL subgroups into one list first
        custom_cat_finishers = []
        
        for subgroup in subgroups:
            category_label = subgroup['subgroupLabel'] # e.g. "A", "B"
            
            # Logic:
            # If custom_category is set -> We are aggregating EVERYTHING from this event into custom_category.
            # If custom_category is NOT set -> We use category_label (A, B...) as the key.
            #   AND we respect category_filter (if user asked for 'A', we skip 'B').
            
            effective_category = custom_category if custom_category else category_label
            
            # Filter check (only if NOT using custom category, or if custom category matches filter?)
            # Usually category_filter comes from UI dropdown "A", "B", "C". 
            # If user defined "Elite Men", the dropdown might not match unless we update UI to show dynamic categories.
            # For now, let's assume category_filter 'All' is used most of the time for Calc.
            if category_filter and category_filter != 'All':
                if custom_category:
                     # If we are mapping to "Elite Men", and filter is "A", do we process?
                     # Probably safest to only skip if we are in Auto mode and labels don't match.
                     # Or if filter matches the custom name.
                     if category_filter != custom_category:
                         # Skip if filter doesn't match the target category
                         continue
                else:
                     if category_label != category_filter:
                         continue

            subgroup_id = subgroup['id']
            start_time_str = subgroup['eventSubgroupStart']
            
            # Parse start time
            try:
                clean_time = start_time_str.replace('Z', '+0000')
                start_time = datetime.strptime(clean_time, '%Y-%m-%dT%H:%M:%S.%f%z')
            except Exception as e:
                logger.error(f"Time parse error: {e}")
                continue

            # Fetch Finishers
            finishers = self._fetch_finishers(
                subgroup_id, event_secret, fetch_mode, filter_registered, registered_riders
            )
            
            # Calculate Points & Sprints for this batch
            processed_batch = self._calculate_points_and_sprints(
                finishers, 
                race_data, 
                start_time, 
                registered_riders, 
                finish_points_scheme, 
                sprint_points_scheme,
                fetch_mode
            )
            
            if custom_category:
                custom_cat_finishers.extend(processed_batch)
            else:
                # Standard Mode: Save directly to A, B, C...
                # Note: This overwrites previous results for this category if multiple sources map to 'A' (unlikely in standard mode)
                all_results[category_label] = processed_batch
                print(f"    Saved {len(processed_batch)} results to {category_label}")

        # If Aggregating for Custom Category
        if custom_category and custom_cat_finishers:
            # We need to Re-Sort and Re-Rank because we might have merged multiple subgroups
            # e.g. Event 1 (Cat A + Cat B) -> "Open"
            
            # Sort
            if fetch_mode == 'finishers':
                custom_cat_finishers.sort(key=lambda x: x['finishTime'] if x['finishTime'] > 0 else 999999999999)
            else:
                custom_cat_finishers.sort(key=lambda x: x['name'])
            
            # Re-Calculate Rank and Finish Points based on new order
            for rank, rider in enumerate(custom_cat_finishers):
                if fetch_mode == 'finishers' and rider['finishTime'] > 0:
                     points = finish_points_scheme[rank] if rank < len(finish_points_scheme) else 0
                     finish_rank = rank + 1
                else:
                     points = 0
                     finish_rank = 0
                
                # Update points (subtract old finish points if any, add new)
                # Actually, _calculate_points_and_sprints already assigned finish points based on subgroup rank.
                # We need to recalculate for the merged group.
                
                old_finish_points = rider['finishPoints']
                rider['finishRank'] = finish_rank
                rider['finishPoints'] = points
                rider['totalPoints'] = rider['totalPoints'] - old_finish_points + points
            
            # Re-Sort by Total Points
            custom_cat_finishers.sort(key=lambda x: x['totalPoints'], reverse=True)
            
            all_results[custom_category] = custom_cat_finishers
            print(f"    Saved {len(custom_cat_finishers)} merged results to {custom_category}")


    def _fetch_finishers(self, subgroup_id, event_secret, fetch_mode, filter_registered, registered_riders):
        finishers = []
        if fetch_mode == 'finishers':
            finish_results_raw = self.zwift.get_event_results(subgroup_id, event_secret=event_secret)
            
            for entry in finish_results_raw:
                profile = entry.get('profileData', {})
                zid = str(profile.get('id') or entry.get('profileId'))
                
                if zid in registered_riders:
                    finishers.append({
                        'zwiftId': zid,
                        'time': entry.get('activityData', {}).get('durationInMilliseconds', 0),
                        'name': registered_riders[zid].get('name'),
                        'info': registered_riders[zid],
                        'flaggedCheating': entry.get('flaggedCheating', False),
                        'flaggedSandbagging': entry.get('flaggedSandbagging', False),
                        'criticalP': entry.get('criticalP', {})
                    })
                elif not filter_registered:
                        finishers.append({
                        'zwiftId': zid,
                        'time': entry.get('activityData', {}).get('durationInMilliseconds', 0),
                        'name': f"{profile.get('firstName', '')} {profile.get('lastName', '')}".strip(),
                        'info': {},
                        'flaggedCheating': entry.get('flaggedCheating', False),
                        'flaggedSandbagging': entry.get('flaggedSandbagging', False),
                        'criticalP': entry.get('criticalP', {})
                    })
            finishers.sort(key=lambda x: x['time'])
            
        else:
            is_joined = (fetch_mode == 'joined')
            participants_raw = self.zwift.get_event_participants(subgroup_id, joined=is_joined, event_secret=event_secret)
            
            for p in participants_raw:
                zid = str(p.get('id'))
                if zid in registered_riders:
                    finishers.append({
                        'zwiftId': zid,
                        'time': 0, 
                        'name': registered_riders[zid].get('name'),
                        'info': registered_riders[zid]
                    })
                elif not filter_registered:
                    finishers.append({
                        'zwiftId': zid,
                        'time': 0, 
                        'name': f"{p.get('firstName', '')} {p.get('lastName', '')}".strip(),
                        'info': {}
                    })
            finishers.sort(key=lambda x: x['name'])
            
        return finishers

    def _calculate_points_and_sprints(self, finishers, race_data, start_time, registered_riders, 
                                      finish_points_scheme, sprint_points_scheme, fetch_mode):
        processed_riders = {}
        
        # 1. Finish Points
        for rank, rider in enumerate(finishers):
            if fetch_mode == 'finishers' and rider['time'] > 0:
                    points = finish_points_scheme[rank] if rank < len(finish_points_scheme) else 0
                    finish_rank = rank + 1
            else:
                    points = 0
                    finish_rank = 0
            
            res = {
                'zwiftId': rider['zwiftId'],
                'name': rider['name'],
                'finishTime': rider['time'],
                'finishRank': finish_rank,
                'finishPoints': points,
                'sprintPoints': 0,
                'totalPoints': points,
                'sprintDetails': {}, 
                'sprintData': {},
                'flaggedCheating': rider.get('flaggedCheating', False),
                'flaggedSandbagging': rider.get('flaggedSandbagging', False),
                'criticalP': rider.get('criticalP', {})
            }
            processed_riders[rider['zwiftId']] = res

        # 2. Sprint Points
        if fetch_mode in ['finishers', 'joined']:
            selected_sprints = race_data.get('sprints', [])
            
            if selected_sprints:
                unique_segment_ids = set(s['id'] for s in selected_sprints)
                end_time = start_time + timedelta(hours=3)
                
                segment_data_cache = {}
                for seg_id in unique_segment_ids:
                    raw = self.zwift.get_segment_results(seg_id, from_date=start_time, to_date=end_time)
                    segment_data_cache[seg_id] = raw

                participants_list = [
                    {'id': int(zid), 'firstName': processed_riders[zid]['name'], 'lastName': ''} 
                    for zid in processed_riders.keys()
                ]
                
                sprints_by_id = defaultdict(list)
                for s in selected_sprints:
                    sprints_by_id[s['id']].append(s)
                
                for seg_id, sprints in sprints_by_id.items():
                    raw_res = segment_data_cache.get(seg_id)
                    if not raw_res:
                        continue
                        
                    ranked_table = self._filter_segment_results(raw_res, sprints, participants_list)
                    
                    for sprint_config in sprints:
                        occ_idx = sprint_config['count']
                        
                        if occ_idx in ranked_table:
                            rankings = ranked_table[occ_idx]
                            
                            # Save performance data
                            for s_rank, s_data in rankings.items():
                                s_zid = str(s_data['id'])
                                if s_zid in processed_riders:
                                    r_data = processed_riders[s_zid]
                                    sprint_key = sprint_config.get('key') or f"{sprint_config['id']}_{sprint_config['count']}"
                                    if 'sprintData' not in r_data:
                                        r_data['sprintData'] = {}
                                    r_data['sprintData'][sprint_key] = {
                                        'avgPower': s_data.get('avgPower'),
                                        'time': s_data.get('time'),
                                        'rank': s_rank
                                    }

                            # Award points
                            for p_idx, points in enumerate(sprint_points_scheme):
                                rank = p_idx + 1
                                if rank in rankings:
                                    winner_entry = rankings[rank]
                                    w_zid = str(winner_entry['id'])
                                    
                                    if w_zid in processed_riders:
                                        rider_data = processed_riders[w_zid]
                                        rider_data['sprintPoints'] += points
                                        rider_data['totalPoints'] += points
                                        
                                        sprint_key = sprint_config.get('key') or f"{sprint_config['id']}_{sprint_config['count']}"
                                        rider_data['sprintDetails'][sprint_key] = points

        # Return list sorted by total points (preliminary sort)
        final_list = list(processed_riders.values())
        final_list.sort(key=lambda x: x['totalPoints'], reverse=True)
        return final_list

    def calculate_league_standings(self):
        """
        Aggregates results from all races to produce a league table per category.
        Returns: { 'A': [ {name, zwiftId, totalPoints, raceCount, ...} ], 'B': ... }
        """
        if not self.db:
            return {}

        # Fetch settings to know how many best races to count (default 5)
        settings_doc = self.db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
        best_races_count = settings.get('bestRacesCount', 5)

        print(f"Calculating league standings (Best {best_races_count} races)...")
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
            
            # Apply Best X Calculation
            for rider in sorted_riders:
                results_list = rider['results']
                # Sort descending by points
                results_list.sort(key=lambda x: x['points'], reverse=True)
                # Take top N
                best_results = results_list[:best_races_count]
                rider['totalPoints'] = sum(r['points'] for r in best_results)

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
                'elapsed': entry.get('elapsed'),
                'avgPower': entry.get('avgPower')
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
                    'elapsed': int(entry.get('elapsed', 99999999)),
                    'avgPower': entry.get('avgPower')
                })

        table = {}
        for count in sorted(entries_by_count.keys()):
            # Sort by the chosen metric (default worldTime)
            sorted_entries = sorted(entries_by_count[count], key=lambda x: x[sort_by])
            
            # Build rank map: 1 -> {name, id, ...}
            table[count] = {
                rank + 1: {
                    "name": participant_lookup.get(entry['athleteId']),
                    "id": entry['athleteId'],
                    "avgPower": entry['avgPower'],
                    "time": entry['elapsed']
                }
                for rank, entry in enumerate(sorted_entries)
            }

        return table
