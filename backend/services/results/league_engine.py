
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
            for category, riders in results.items():
                if category not in league_table:
                    league_table[category] = {}
                
                # Calculate what "Last Place" points would be for this category if needed
                valid_riders_count = sum(1 for r in riders if str(r['zwiftId']) not in manual_dqs and str(r['zwiftId']) not in manual_declassifications)
                
                last_place_points = self.finish_points_scheme[valid_riders_count] if valid_riders_count < len(self.finish_points_scheme) else 0

                # NEW: League Rank Points Logic
                race_league_points_map = {}
                league_last_place_points = 0
                
                if self.league_rank_points:
                    # 1. Identify valid riders for ranking
                    ranking_candidates = [
                        r for r in riders 
                        if str(r['zwiftId']) not in manual_dqs
                        and str(r['zwiftId']) not in manual_declassifications
                        and str(r['zwiftId']) not in manual_exclusions
                        and (
                            r.get('finishTime', 0) > 0 
                            or r.get('totalPoints', 0) > 0 
                            or bool(r.get('sprintData'))
                        )
                    ]
                    
                    # 2. Sort by Raw Total Points (Descending), then by Finish Rank (Ascending) as tie breaker
                    # Tie-breaker logic: FinishRank 1 is better than 2. So we negate it?
                    # Original code: -x.get('finishRank', 9999) 
                    # If rank is 1 => -1. If rank is 2 => -2. -1 > -2. So Rank 1 comes first. Correct.
                    # DNF (finishRank 0 or high) should be last.
                    # Updated logic from previous turn:
                    # - (x.get('finishRank') if x.get('finishRank', 0) > 0 else 9999999)
                    
                    ranking_candidates.sort(key=lambda x: (
                        x.get('totalPoints', 0), 
                        - (x.get('finishRank') if x.get('finishRank', 0) > 0 else 9999999)
                    ), reverse=True)
                    
                    # 3. Assign points from scheme
                    for rank, r in enumerate(ranking_candidates):
                        p = self.league_rank_points[rank] if rank < len(self.league_rank_points) else 0
                        race_league_points_map[str(r['zwiftId'])] = p
                    
                    # 4. Determine "Last Place" points for declassified riders
                    last_valid_idx = len(ranking_candidates)
                    league_last_place_points = self.league_rank_points[last_valid_idx] if last_valid_idx < len(self.league_rank_points) else 0

                for rider in riders:
                    zid = str(rider['zwiftId'])
                    if zid in manual_exclusions:
                        continue
                    
                    if zid in manual_dqs:
                        points = 0
                        # print(f"  [Standings] Rider {zid} is DQ in race {race_id}, forcing 0 points.")
                    
                    elif self.league_rank_points:
                        if zid in manual_declassifications:
                            points = league_last_place_points
                        else:
                            points = race_league_points_map.get(zid, 0)
                            
                    elif zid in manual_declassifications:
                        points = last_place_points
                    else:
                        points = rider.get('totalPoints', 0)
                    
                    # --- EXCLUSION LOGIC ---
                    has_finished = rider.get('finishTime', 0) > 0
                    has_points = points > 0
                    has_activity = bool(rider.get('sprintData'))
                    
                    if not (has_finished or has_points or has_activity):
                        continue
                    # -----------------------

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
