import logging
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from services.results.race_scorer import RaceScorer
from services.results.league_engine import LeagueEngine
from services.results.zwift_fetcher import ZwiftFetcher
from firebase_admin import firestore

logger = logging.getLogger('ResultsProcessor')

class ResultsProcessor:
    def __init__(self, db, zwift_service: ZwiftService, game_service: ZwiftGameService):
        self.db = db
        self.zwift_fetcher = ZwiftFetcher(zwift_service)
        # We might still need game_service if used elsewhere, but not used in this file currently?
        # Checked original file: game_service was imported but not seemingly used in the methods we refactored.
        # It was passed to __init__. I'll keep it to maintain signature compatibility.
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
        single_mode_categories = race_data.get('singleModeCategories', [])

        if event_config and len(event_config) > 0:
            # Multi-Event Mode
            print("Using Multi-Event Configuration")
            for cfg in event_config:
                event_sources.append({
                    'id': cfg.get('eventId'),
                    'secret': cfg.get('eventSecret'),
                    'customCategory': cfg.get('customCategory'),
                    'sprints': cfg.get('sprints', []),
                    'segmentType': cfg.get('segmentType') or race_data.get('segmentType')
                })
        else:
            # Legacy/Single Mode
            event_id = race_data.get('eventId')
            event_secret = race_data.get('eventSecret')
            global_sprints = race_data.get('sprints', [])
            
            if event_id:
                print("Using Single Event Configuration")
                category_config_map = {}
                if single_mode_categories:
                    print(f"  Found {len(single_mode_categories)} per-category configurations")
                    for cat_cfg in single_mode_categories:
                        cat_name = cat_cfg.get('category')
                        if cat_name:
                            category_config_map[cat_name] = {
                                'sprints': cat_cfg.get('sprints', []),
                                'segmentType': cat_cfg.get('segmentType') or race_data.get('segmentType'),
                                'laps': cat_cfg.get('laps')
                            }
                
                event_sources.append({
                    'id': event_id,
                    'secret': event_secret,
                    'customCategory': None,
                    'sprints': global_sprints,
                    'segmentType': race_data.get('segmentType'),
                    'categoryConfigMap': category_config_map
                })
        
        if not event_sources:
            raise Exception("No Zwift Event ID(s) linked to this race")

        # 2. Fetch League Settings (Point Schemes)
        settings_doc = self.db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
        
        # Initialize Scorer
        scorer = RaceScorer(
            finish_points_scheme=settings.get('finishPoints', []),
            sprint_points_scheme=settings.get('sprintPoints', [])
        )

        # 3. Fetch Registered Participants
        users_ref = self.db.collection('users')
        users_docs = users_ref.stream()
        registered_riders = {}
        for doc in users_docs:
            data = doc.to_dict()
            zid = data.get('zwiftId')
            if zid:
                registered_riders[str(zid)] = data
        
        print(f"Found {len(registered_riders)} registered riders in database.")

        # Get league rank points for preliminary league points calculation
        league_rank_points = settings.get('leagueRankPoints', [])

        # 4. Process Each Source
        all_results = race_data.get('results', {})
        if not all_results:
            all_results = {}
        
        for source in event_sources:
            self._process_event_source(
                source, 
                race_data,
                registered_riders,
                scorer,
                all_results,
                fetch_mode,
                filter_registered,
                category_filter,
                league_rank_points
            )

        # 6. Save Results to Firestore
        self.db.collection('races').document(race_id).update({
            'results': all_results,
            'resultsUpdatedAt': datetime.now()
        })
        
        race_data['results'] = all_results

        # 7. Update Global League Standings
        try:
            self.save_league_standings(override_race_id=race_id, override_race_data=race_data)
        except Exception as e:
            print(f"Error updating league standings: {e}")

        return all_results

    def save_league_standings(self, override_race_id=None, override_race_data=None):
        standings = self.calculate_league_standings(override_race_id, override_race_data)
        self.db.collection('league').document('standings').set({
            'standings': standings,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }, merge=True)
        print("Updated league standings document.")
        return standings

    def recalculate_race_points(self, race_id):
        """
        Recalculates points for an existing race using league scoring settings.
        """
        if not self.db:
            raise Exception("Database not available")
        
        print(f"Recalculating points for race: {race_id}")
        
        race_doc = self.db.collection('races').document(race_id).get()
        if not race_doc.exists:
            raise Exception(f"Race {race_id} not found")
        
        race_data = race_doc.to_dict()
        results = race_data.get('results', {})
        
        if not results:
            print("  No results to recalculate")
            return results
        
        settings_doc = self.db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
        
        scorer = RaceScorer(
            finish_points_scheme=settings.get('finishPoints', []),
            sprint_points_scheme=settings.get('sprintPoints', [])
        )
        
        league_rank_points = settings.get('leagueRankPoints', [])
        
        updated_results = {}
        
        for category, riders in results.items():
            print(f"  Processing category {category} ({len(riders)} riders)")
            category_config = self._get_category_config(race_data, category)
            category_config['type'] = race_data.get('type', 'scratch')
            updated_riders = scorer.calculate_results(riders, category_config, segment_efforts_map=None)
            
            # Calculate preliminary league points
            if league_rank_points:
                scorer.calculate_league_points(updated_riders, category_config, league_rank_points)
            
            updated_results[category] = updated_riders
        
        self.db.collection('races').document(race_id).update({
            'results': updated_results,
            'resultsUpdatedAt': datetime.now()
        })
        
        race_data['results'] = updated_results
        try:
            self.save_league_standings(override_race_id=race_id, override_race_data=race_data)
        except Exception as e:
            print(f"Error updating league standings: {e}")
        
        print(f"  Recalculation complete for {len(updated_results)} categories")
        return updated_results

    def calculate_league_standings(self, override_race_id=None, override_race_data=None):
        """
        Aggregates results from all races to produce a league table per category.
        """
        if not self.db:
            return {}

        try:
            settings_doc = self.db.collection('league').document('settings').get()
            settings = settings_doc.to_dict() if settings_doc.exists else {}
        except Exception as e:
            print(f"Error fetching settings: {e}")
            settings = {}

        try:
            races_ref = self.db.collection('races')
            docs = races_ref.stream()
            
            races_data = []
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                races_data.append(data)
        except Exception as e:
            print(f"Error fetching races: {e}")
            return {}

        engine = LeagueEngine(settings)
        return engine.calculate_standings(races_data, override_race_id, override_race_data)

    def _process_event_source(self, source, race_data, registered_riders, scorer, 
                              all_results, fetch_mode, filter_registered, category_filter,
                              league_rank_points=None):
        
        event_id = source['id']
        event_secret = source['secret']
        custom_category = source['customCategory']
        category_config_map = source.get('categoryConfigMap', {})
        
        if not event_id:
            return

        print(f"Processing Event Source: {event_id} (Target Cat: {custom_category or 'Auto'})")

        try:
            event_info = self.zwift_fetcher.get_event_info(event_id, event_secret)
        except Exception as e:
            print(f"Failed to fetch event info for {event_id}: {e}")
            return

        subgroups = self.zwift_fetcher.extract_subgroups(event_info)
        print(f"  Found {len(subgroups)} subgroups.")
        
        custom_cat_finishers = []
        custom_cat_segment_efforts = {}
        
        for subgroup in subgroups:
            category_label = subgroup['subgroupLabel']
            effective_category = custom_category if custom_category else category_label
            
            if category_filter and category_filter != 'All':
                if custom_category:
                     if category_filter != custom_category:
                         continue
                else:
                     if category_label != category_filter:
                         continue

            subgroup_id = subgroup['id']
            start_time_str = subgroup['eventSubgroupStart']
            
            try:
                clean_time = start_time_str.replace('Z', '+0000')
                start_time = datetime.strptime(clean_time, '%Y-%m-%dT%H:%M:%S.%f%z')
            except Exception as e:
                logger.error(f"Time parse error: {e}")
                continue

            # Fetch Finishers using ZwiftFetcher
            finishers = self.zwift_fetcher.fetch_finishers(
                subgroup_id, event_secret, fetch_mode, filter_registered, registered_riders
            )
            
            # Determine Configs
            category_sprints = source.get('sprints', [])
            category_segment_type = source.get('segmentType')
            
            if not custom_category and category_label in category_config_map:
                cat_cfg = category_config_map[category_label]
                if cat_cfg.get('sprints'):
                    category_sprints = cat_cfg['sprints']
                    print(f"    Using per-category sprints for {category_label}: {len(category_sprints)} sprints")
                if cat_cfg.get('segmentType'):
                    category_segment_type = cat_cfg['segmentType']
            
            category_config = self._get_category_config(race_data, effective_category)
            category_config['sprints'] = category_sprints
            category_config['segmentType'] = category_segment_type
            
            # Fetch Segment Efforts using ZwiftFetcher
            segment_efforts = {}
            if fetch_mode in ['finishers', 'joined'] and category_sprints:
                end_time = start_time + timedelta(hours=3)
                unique_segment_ids = set(s['id'] for s in category_sprints)
                segment_efforts = self.zwift_fetcher.fetch_segment_efforts(unique_segment_ids, start_time, end_time)
            
            if custom_category:
                custom_cat_finishers.extend(finishers)
                custom_cat_segment_efforts.update(segment_efforts)
            else:
                if category_config_map and category_label not in category_config_map:
                    print(f"    Skipping category {category_label} (not in configured categories)")
                    continue
                
                # Add race type to config for league points calculation
                category_config['type'] = race_data.get('type', 'scratch')
                
                processed_batch = scorer.calculate_results(finishers, category_config, segment_efforts)
                
                # Calculate preliminary league points
                if league_rank_points:
                    scorer.calculate_league_points(processed_batch, category_config, league_rank_points)
                
                all_results[category_label] = processed_batch
                print(f"    Saved {len(processed_batch)} results to {category_label}")

        if custom_category and custom_cat_finishers:
            cat_config = self._get_category_config(race_data, custom_category)
            cat_config['sprints'] = source.get('sprints', [])
            cat_config['segmentType'] = source.get('segmentType')
            cat_config['type'] = race_data.get('type', 'scratch')
            
            processed_batch = scorer.calculate_results(custom_cat_finishers, cat_config, custom_cat_segment_efforts)
            
            # Calculate preliminary league points
            if league_rank_points:
                scorer.calculate_league_points(processed_batch, cat_config, league_rank_points)
            
            all_results[custom_category] = processed_batch
            print(f"    Saved {len(processed_batch)} merged results to {custom_category}")

    def _get_category_config(self, race_data, category):
        """Helper to build a config dict for RaceScorer from race_data"""
        
        # Default global config
        config = {
            'manualDQs': race_data.get('manualDQs', []),
            'manualDeclassifications': race_data.get('manualDeclassifications', []),
            'manualExclusions': race_data.get('manualExclusions', []),
            'segmentType': race_data.get('segmentType', 'sprint'),
            'sprints': race_data.get('sprints', [])
        }
        
        # Try to find specific category config overrides
        
        # 1. Check Multi-Mode Config (eventConfiguration)
        if race_data.get('eventMode') == 'multi' and race_data.get('eventConfiguration'):
            for cfg in race_data['eventConfiguration']:
                if cfg.get('customCategory') == category:
                    if cfg.get('segmentType'):
                        config['segmentType'] = cfg['segmentType']
                    if cfg.get('sprints'):
                        config['sprints'] = cfg['sprints']
                    return config
                    
        # 2. Check Single-Mode Config (singleModeCategories)
        if race_data.get('singleModeCategories'):
            for cfg in race_data['singleModeCategories']:
                if cfg.get('category') == category:
                    if cfg.get('segmentType'):
                        config['segmentType'] = cfg['segmentType']
                    if cfg.get('sprints'):
                        config['sprints'] = cfg['sprints']
                    return config
                    
        return config
