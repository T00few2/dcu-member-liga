
from datetime import datetime, timezone

class LeagueEngine:
    def __init__(self, settings):
        """
        Initialize with league settings.
        settings: dict containing 'bestRacesCount', 'finishPoints', 'leagueRankPoints', etc.
        """
        self.settings = settings or {}
        self.best_races_count = self.settings.get('bestRacesCount', 5)
        self.finish_points_scheme = self.settings.get('finishPoints', [])
        self.league_rank_points = self.settings.get('leagueRankPoints', [])

    def calculate_standings(self, races_data, override_race_id=None, override_race_data=None):
        """
        Calculate league standings from a list/iterable of race data dictionaries.
        
        races_data: iterable of race dicts. Each dict must have 'id' (or we assume it's passed or inside).
                    In the original code, it iterated Firestore docs. 
                    Here we expect dictionaries that ALREADY include the 'id'.
        
        override_race_id: ID of race to override.
        override_race_data: Data to use for the override race.
        """
        print(f"Calculating league standings (Best {self.best_races_count} races)...")
        
        league_table = {} # { category: { zwiftId: { ... } } }
        race_count = 0

        for race_data in races_data:
            race_id = race_data.get('id')
            
            # Use override data if this is the race we just updated
            if override_race_id and race_id == override_race_id and override_race_data:
                race_data = override_race_data
                # Ensure manualDQs is present
                if 'manualDQs' not in race_data:
                     # If we can't get it from original doc here easily without passing it, 
                     # we rely on override_race_data having it or being merged previously.
                     # For safety in this refactor, assume override_race_data is complete enough
                     # or fallback to empty list if missing.
                     race_data['manualDQs'] = race_data.get('manualDQs', [])
                
                print(f"  Using fresh data for race {race_id} (Override). Manual DQs: {len(race_data.get('manualDQs', []))}")

            results = race_data.get('results', {})
            race_date = self._get_race_datetime(race_data)
            manual_dqs = set(str(dq) for dq in race_data.get('manualDQs', []))
            manual_declassifications = set(str(dq) for dq in race_data.get('manualDeclassifications', []))
            manual_exclusions = set(str(ex) for ex in race_data.get('manualExclusions', []))

            if not results:
                continue
            
            race_count += 1
            race_type = race_data.get('type', 'scratch')
            
            for category, riders in results.items():
                if category not in league_table:
                    league_table[category] = {}
                
                # Calculate league points for this race/category
                league_points_map = self._calculate_race_league_points(
                    riders, race_data, category, race_type,
                    manual_dqs, manual_declassifications, manual_exclusions
                )

                for rider in riders:
                    zid = str(rider['zwiftId'])
                    if zid in manual_exclusions:
                        continue
                    
                    # Get league points from the calculated map
                    points = league_points_map.get(zid)
                    
                    # Skip riders with no points (None means not ranked)
                    if points is None:
                        continue

                    if zid not in league_table[category]:
                        league_table[category][zid] = {
                            'zwiftId': zid,
                            'name': rider['name'],
                            'totalPoints': 0,
                            'raceCount': 0,
                            'results': [],
                            'lastRacePoints': 0,
                            'lastRaceDate': None
                        }
                    
                    entry = league_table[category][zid]
                    entry['totalPoints'] += points
                    entry['raceCount'] += 1
                    entry['results'].append({
                        'raceId': race_id,
                        'points': points
                    })
                    
                    if race_date:
                        last_date = entry.get('lastRaceDate')
                        if not last_date or race_date >= last_date:
                            entry['lastRaceDate'] = race_date
                            entry['lastRacePoints'] = points

        print(f"Processed {race_count} races for standings.")

        # Convert to sorted lists
        final_standings = {}
        for category, riders_dict in league_table.items():
            sorted_riders = list(riders_dict.values())
            
            # Apply Best X Calculation
            for rider in sorted_riders:
                results_list = rider['results']
                results_list.sort(key=lambda x: x['points'], reverse=True)
                best_results = results_list[:self.best_races_count]
                rider['totalPoints'] = sum(r['points'] for r in best_results)

            sorted_riders.sort(
                key=lambda x: (x['totalPoints'], x.get('lastRacePoints', 0)),
                reverse=True
            )
            final_standings[category] = sorted_riders
            
        return final_standings

    def _calculate_race_league_points(self, riders, race_data, category, race_type, 
                                       manual_dqs, manual_declassifications, manual_exclusions):
        """
        Calculate league points for a single race/category.
        Returns a dict mapping zwiftId -> points (or None if not ranked).
        """
        if not self.league_rank_points:
            # No league rank points configured - use raw totalPoints
            result = {}
            valid_riders_count = sum(1 for r in riders 
                if str(r['zwiftId']) not in manual_dqs 
                and str(r['zwiftId']) not in manual_declassifications)
            last_place_points = self.finish_points_scheme[valid_riders_count] if valid_riders_count < len(self.finish_points_scheme) else 0
            
            for rider in riders:
                zid = str(rider['zwiftId'])
                if zid in manual_exclusions:
                    continue
                if zid in manual_dqs:
                    result[zid] = 0
                elif zid in manual_declassifications:
                    result[zid] = last_place_points
                else:
                    points = rider.get('totalPoints', 0)
                    has_finished = rider.get('finishTime', 0) > 0
                    has_activity = bool(rider.get('sprintData'))
                    if points > 0 or has_finished or has_activity:
                        result[zid] = points
            return result
        
        # League rank points configured - rank riders and assign points
        if race_type == 'time-trial':
            return self._calculate_time_trial_league_points(
                riders, race_data, category, manual_dqs, manual_declassifications, manual_exclusions
            )
        elif race_type == 'scratch':
            return self._calculate_scratch_race_league_points(
                riders, manual_dqs, manual_declassifications, manual_exclusions
            )
        else:
            # Points races - rank by totalPoints
            return self._calculate_points_race_league_points(
                riders, manual_dqs, manual_declassifications, manual_exclusions
            )
    
    def _calculate_scratch_race_league_points(self, riders, manual_dqs, manual_declassifications, manual_exclusions):
        """
        Calculate league points for scratch races.
        Ranking: finishTime (asc) - fastest finisher wins
        """
        result = {}
        ranking_data = []
        
        for rider in riders:
            zid = str(rider.get('zwiftId'))
            
            if zid in manual_exclusions:
                continue
            
            if zid in manual_dqs:
                result[zid] = 0
                continue
            
            has_finished = rider.get('finishTime', 0) > 0
            
            # Only rank riders who finished
            if not has_finished:
                continue
            
            ranking_data.append({
                'zid': zid,
                'finishTime': rider.get('finishTime', 0),
                'isDeclassified': zid in manual_declassifications
            })
        
        # Sort: non-declassified first, then by finishTime asc (fastest first)
        ranking_data.sort(key=lambda x: (
            1 if x['isDeclassified'] else 0,
            x['finishTime']
        ))
        
        for rank, entry in enumerate(ranking_data):
            points = self.league_rank_points[rank] if rank < len(self.league_rank_points) else 0
            result[entry['zid']] = points
        
        return result
    
    def _calculate_points_race_league_points(self, riders, manual_dqs, manual_declassifications, manual_exclusions):
        """
        Calculate league points for points races.
        Ranking: totalPoints (desc), finishRank (asc) as tie-breaker
        """
        result = {}
        ranking_data = []
        
        for rider in riders:
            zid = str(rider.get('zwiftId'))
            
            if zid in manual_exclusions:
                continue
            
            if zid in manual_dqs:
                result[zid] = 0
                continue
            
            has_finished = rider.get('finishTime', 0) > 0
            has_points = rider.get('totalPoints', 0) > 0
            has_activity = bool(rider.get('sprintData'))
            
            if not (has_finished or has_points or has_activity):
                continue
            
            ranking_data.append({
                'zid': zid,
                'totalPoints': rider.get('totalPoints', 0),
                'finishRank': rider.get('finishRank', 0) if rider.get('finishRank', 0) > 0 else 9999999,
                'isDeclassified': zid in manual_declassifications
            })
        
        # Sort: non-declassified first, then by totalPoints desc, finishRank asc
        ranking_data.sort(key=lambda x: (
            0 if x['isDeclassified'] else 1,
            x['totalPoints'],
            -x['finishRank']
        ), reverse=True)
        
        for rank, entry in enumerate(ranking_data):
            points = self.league_rank_points[rank] if rank < len(self.league_rank_points) else 0
            result[entry['zid']] = points
        
        return result
    
    def _calculate_time_trial_league_points(self, riders, race_data, category, 
                                            manual_dqs, manual_declassifications, manual_exclusions):
        """
        Calculate league points for time trials.
        Ranking: finishTime (asc) if finished, otherwise by furthest segment + worldTime
        """
        result = {}
        
        # Get split segments configuration
        # The sprints array is already in chronological order (course order)
        sprints_config = self._get_category_sprints(race_data, category)
        segment_type = self._get_category_segment_type(race_data, category)
        
        # Filter to only split type segments, preserving original order
        if segment_type == 'split':
            splits = list(sprints_config)  # Keep original order
        else:
            splits = [s for s in sprints_config if s.get('type') == 'split']
        
        def get_furthest_segment(rider):
            """Find the furthest segment crossed, return (index, worldTime) or None"""
            sprint_data = rider.get('sprintData', {})
            if not sprint_data:
                return None
            
            for i in range(len(splits) - 1, -1, -1):
                s = splits[i]
                keys = [s.get('key'), f"{s['id']}_{s['count']}", str(s['id'])]
                for key in keys:
                    if key and key in sprint_data:
                        data = sprint_data[key]
                        world_time = data.get('worldTime', 0) if isinstance(data, dict) else 0
                        if world_time > 0:
                            return (i, world_time)
            return None
        
        ranking_data = []
        
        for rider in riders:
            zid = str(rider.get('zwiftId'))
            
            if zid in manual_exclusions:
                continue
            
            if zid in manual_dqs:
                result[zid] = 0
                continue
            
            has_finished = rider.get('finishTime', 0) > 0
            furthest = get_furthest_segment(rider)
            can_rank = has_finished or furthest is not None
            
            if not can_rank:
                continue
            
            ranking_data.append({
                'zid': zid,
                'hasFinished': has_finished,
                'finishTime': rider.get('finishTime', 0),
                'segmentIndex': furthest[0] if furthest else -1,
                'segmentWorldTime': furthest[1] if furthest else float('inf'),
                'isDeclassified': zid in manual_declassifications
            })
        
        # Sort: non-declassified first, finishers by time, non-finishers by segment progress
        def sort_key(x):
            declass_key = 1 if x['isDeclassified'] else 0
            if x['hasFinished']:
                return (declass_key, 0, x['finishTime'], 0, 0)
            else:
                return (declass_key, 1, 0, -x['segmentIndex'], x['segmentWorldTime'])
        
        ranking_data.sort(key=sort_key)
        
        for rank, entry in enumerate(ranking_data):
            points = self.league_rank_points[rank] if rank < len(self.league_rank_points) else 0
            result[entry['zid']] = points
        
        return result
    
    def _get_category_sprints(self, race_data, category):
        """Get sprint/segment configuration for a category"""
        if race_data.get('eventMode') == 'multi' and race_data.get('eventConfiguration'):
            for cfg in race_data['eventConfiguration']:
                if cfg.get('customCategory') == category:
                    return cfg.get('sprints', [])
        
        if race_data.get('singleModeCategories'):
            for cfg in race_data['singleModeCategories']:
                if cfg.get('category') == category:
                    return cfg.get('sprints', [])
        
        return race_data.get('sprints', [])
    
    def _get_category_segment_type(self, race_data, category):
        """Get segment type for a category"""
        if race_data.get('eventMode') == 'multi' and race_data.get('eventConfiguration'):
            for cfg in race_data['eventConfiguration']:
                if cfg.get('customCategory') == category:
                    return cfg.get('segmentType') or race_data.get('segmentType', 'sprint')
        
        if race_data.get('singleModeCategories'):
            for cfg in race_data['singleModeCategories']:
                if cfg.get('category') == category:
                    return cfg.get('segmentType') or race_data.get('segmentType', 'sprint')
        
        return race_data.get('segmentType', 'sprint')

    @staticmethod
    def _normalize_dt(value):
        if not value:
            return None
        if value.tzinfo:
            return value.astimezone(timezone.utc).replace(tzinfo=None)
        return value

    @staticmethod
    def _parse_dt(value):
        if not value:
            return None
        if isinstance(value, datetime):
            return LeagueEngine._normalize_dt(value)
        try:
            parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
            return LeagueEngine._normalize_dt(parsed)
        except Exception:
            return None

    @staticmethod
    def _get_race_datetime(race_data):
        date_value = race_data.get('date')
        date_str = str(date_value) if date_value is not None else ''
        parsed_date = LeagueEngine._parse_dt(date_value)
        
        if parsed_date and ('T' in date_str or ' ' in date_str):
            return parsed_date
        
        start_time = race_data.get('startTime')
        if not start_time:
            times = [
                cfg.get('startTime')
                for cfg in (race_data.get('eventConfiguration') or [])
                if cfg.get('startTime')
            ]
            if times:
                times.sort()
                start_time = times[0]
        
        if start_time:
            parsed_start = LeagueEngine._parse_dt(start_time)
            if parsed_start:
                return parsed_start
            
            if date_str:
                try:
                    combined = f"{date_str}T{start_time}"
                    parsed_combined = LeagueEngine._parse_dt(combined)
                    if parsed_combined:
                        return parsed_combined
                except:
                    pass
        
        return parsed_date
