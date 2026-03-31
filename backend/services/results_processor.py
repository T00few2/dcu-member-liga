from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from collections import defaultdict
from typing import Any

from services.zwift import ZwiftService
from services.zwift_game import ZwiftGameService
from services.results.race_scorer import RaceScorer
from services.results.league_engine import LeagueEngine
from services.results.zwift_fetcher import ZwiftFetcher
from services.category_config import CategoryConfigResolver
from services.schema_validation import (
    log_schema_issues,
    validate_league_standings_doc,
    validate_race_doc,
    with_schema_version,
)
from firebase_admin import firestore

from models import LeagueStandings, RaceConfig, RaceResults

logger = logging.getLogger('ResultsProcessor')


class ResultsProcessor:
    def __init__(self, db: Any, zwift_service: ZwiftService, game_service: ZwiftGameService) -> None:
        self.db = db
        self.zwift_fetcher = ZwiftFetcher(zwift_service)
        # We might still need game_service if used elsewhere, but not used in this file currently?
        # Checked original file: game_service was imported but not seemingly used in the methods we refactored.
        # It was passed to __init__. I'll keep it to maintain signature compatibility.
        self.game = game_service

    def process_race_results(
        self,
        race_id: str,
        fetch_mode: str = 'finishers',
        filter_registered: bool = True,
        category_filter: str | None = None,
    ) -> RaceResults:
        """
        Main entry point to process results for a given race ID (Firestore ID).
        fetch_mode: 'finishers' (default), 'joined', 'signed_up'
        filter_registered: boolean, if True only include users in DB
        category_filter: string, e.g. 'A', 'B' or None/'All'
        """
        if not self.db:
            raise Exception("Database not available")

        logger.info(f"Processing results for race: {race_id} (Mode: {fetch_mode}, Filter: {filter_registered}, Cat: {category_filter})")

        # 1. Fetch Race Config
        race_doc = self.db.collection('races').document(race_id).get()
        if not race_doc.exists:
            raise Exception(f"Race {race_id} not found")

        race_data = race_doc.to_dict()

        # Determine Event Sources
        event_sources: list[dict[str, Any]] = []
        event_config = race_data.get('eventConfiguration', [])
        if event_config and len(event_config) > 0:
            logger.info("Using eventConfiguration sources")
            for cfg in event_config:
                event_sources.append({
                    'id': cfg.get('eventId'),
                    'subgroupId': cfg.get('subgroupId'),
                    'secret': cfg.get('eventSecret'),
                    'customCategory': cfg.get('customCategory'),
                    'sprints': cfg.get('sprints', []),
                    'segmentType': cfg.get('segmentType') or race_data.get('segmentType'),
                    'startTime': cfg.get('startTime') or race_data.get('date'),
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
        registered_riders: dict[str, Any] = {}
        for doc in users_docs:
            data = doc.to_dict()
            zid = data.get('zwiftId')
            zuid = data.get('zwiftUserId')

            reg = data.get('registration', {})
            is_registered = reg.get('status') == 'complete'
            if data.get('registrationComplete') is True or data.get('verified') is True:
                logger.warning(
                    "Deprecated registration fields found for user doc %s; canonical registration.status is required",
                    doc.id,
                )

            if zid and is_registered:
                registered_riders[str(zid)] = data
            if zuid and is_registered:
                registered_riders[str(zuid)] = data

        logger.info(f"Found {len(registered_riders)} registered riders in database.")

        # 4. Process Each Source
        all_results: RaceResults = race_data.get('results', {})
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
                category_filter
            )

        # 6. Save Results to Firestore
        race_update = with_schema_version({
            'results': all_results,
            'resultsUpdatedAt': datetime.now()
        })
        log_schema_issues(logger, f"races/{race_id} (results processing)", validate_race_doc(race_update, partial=True))
        self.db.collection('races').document(race_id).update(race_update)

        race_data['results'] = all_results

        # 7. Update Global League Standings
        try:
            self.save_league_standings(override_race_id=race_id, override_race_data=race_data)
        except Exception as e:
            logger.error(f"Error updating league standings: {e}")

        return all_results

    def save_league_standings(
        self,
        override_race_id: str | None = None,
        override_race_data: dict[str, Any] | None = None,
    ) -> LeagueStandings:
        standings = self.calculate_league_standings(override_race_id, override_race_data)
        standings_payload = with_schema_version({
            'standings': standings,
            'updatedAt': firestore.SERVER_TIMESTAMP
        })
        log_schema_issues(logger, "league/standings (save)", validate_league_standings_doc(standings_payload))
        self.db.collection('league').document('standings').set(standings_payload, merge=True)
        logger.info("Updated league standings document.")
        return standings

    def recalculate_race_points(self, race_id: str) -> RaceResults:
        """
        Recalculates points for an existing race using league scoring settings.
        """
        if not self.db:
            raise Exception("Database not available")

        logger.info(f"Recalculating points for race: {race_id}")

        race_doc = self.db.collection('races').document(race_id).get()
        if not race_doc.exists:
            raise Exception(f"Race {race_id} not found")

        race_data = race_doc.to_dict()
        results = race_data.get('results', {})

        if not results:
            logger.info("  No results to recalculate")
            return results

        settings_doc = self.db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}

        scorer = RaceScorer(
            finish_points_scheme=settings.get('finishPoints', []),
            sprint_points_scheme=settings.get('sprintPoints', [])
        )

        updated_results: RaceResults = {}

        for category, riders in results.items():
            logger.info(f"  Processing category {category} ({len(riders)} riders)")
            category_config = self._get_category_config(race_data, category)
            updated_riders = scorer.calculate_results(riders, category_config, segment_efforts_map=None)
            updated_results[category] = updated_riders

        race_update = with_schema_version({
            'results': updated_results,
            'resultsUpdatedAt': datetime.now()
        })
        log_schema_issues(logger, f"races/{race_id} (recalculate)", validate_race_doc(race_update, partial=True))
        self.db.collection('races').document(race_id).update(race_update)

        race_data['results'] = updated_results
        try:
            self.save_league_standings(override_race_id=race_id, override_race_data=race_data)
        except Exception as e:
            logger.error(f"Error updating league standings: {e}")

        logger.info(f"  Recalculation complete for {len(updated_results)} categories")
        return updated_results

    def calculate_league_standings(
        self,
        override_race_id: str | None = None,
        override_race_data: dict[str, Any] | None = None,
    ) -> LeagueStandings:
        """
        Aggregates results from all races to produce a league table per category.
        """
        if not self.db:
            return {}

        try:
            settings_doc = self.db.collection('league').document('settings').get()
            settings = settings_doc.to_dict() if settings_doc.exists else {}
        except Exception as e:
            logger.error(f"Error fetching settings: {e}")
            settings = {}

        try:
            races_ref = self.db.collection('races')
            docs = races_ref.stream()

            races_data: list[dict[str, Any]] = []
            for doc in docs:
                data = doc.to_dict()
                data['id'] = doc.id
                races_data.append(data)
        except Exception as e:
            logger.error(f"Error fetching races: {e}")
            return {}

        engine = LeagueEngine(settings)
        return engine.calculate_standings(races_data, override_race_id, override_race_data)

    def _process_event_source(
        self,
        source: dict[str, Any],
        race_data: dict[str, Any],
        registered_riders: dict[str, Any],
        scorer: RaceScorer,
        all_results: RaceResults,
        fetch_mode: str,
        filter_registered: bool,
        category_filter: str | None,
    ) -> None:
        event_id = source.get('id')
        direct_subgroup_id = source.get('subgroupId')
        event_secret = source['secret']
        custom_category = source['customCategory']
        category_config_map = source.get('categoryConfigMap', {})

        if not event_id and not direct_subgroup_id:
            return

        logger.info(f"Processing Event Source: {event_id} (Target Cat: {custom_category or 'Auto'})")

        if direct_subgroup_id:
            subgroups = [{
                "id": direct_subgroup_id,
                "eventName": race_data.get("name", ""),
                "subgroupLabel": custom_category or "All",
                "routeId": race_data.get("routeId"),
                "laps": race_data.get("laps"),
                "eventSubgroupStart": source.get("startTime") or race_data.get("date"),
            }]
        else:
            try:
                event_info = self.zwift_fetcher.get_event_info(event_id, event_secret)
            except Exception as e:
                logger.error(f"Failed to fetch event info for {event_id}: {e}")
                return
            subgroups = self.zwift_fetcher.extract_subgroups(event_info)
        logger.info(f"  Found {len(subgroups)} subgroups.")

        custom_cat_finishers: list[Any] = []
        custom_cat_segment_efforts: dict[str | int, Any] = {}

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
                if isinstance(start_time_str, datetime):
                    start_time = start_time_str
                else:
                    raw = str(start_time_str or "")
                    if raw.endswith("Z"):
                        try:
                            start_time = datetime.fromisoformat(raw.replace("Z", "+00:00"))
                        except ValueError:
                            clean_time = raw.replace('Z', '+0000')
                            start_time = datetime.strptime(clean_time, '%Y-%m-%dT%H:%M:%S.%f%z')
                    elif "T" in raw:
                        dt_format = '%Y-%m-%dT%H:%M:%S' if len(raw) >= 19 else '%Y-%m-%dT%H:%M'
                        start_time = datetime.strptime(raw[:19], dt_format)
                    else:
                        start_time = datetime.strptime(race_data.get('date', ''), '%Y-%m-%d')
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
                    logger.info(f"    Using per-category sprints for {category_label}: {len(category_sprints)} sprints")
                if cat_cfg.get('segmentType'):
                    category_segment_type = cat_cfg['segmentType']

            category_config = self._get_category_config(race_data, effective_category)
            category_config['sprints'] = category_sprints
            category_config['segmentType'] = category_segment_type

            # Fetch Segment Efforts using ZwiftFetcher
            segment_efforts: dict[str | int, Any] = {}
            if fetch_mode in ['finishers', 'joined'] and category_sprints:
                end_time = start_time + timedelta(hours=3)
                unique_segment_ids = set(s['id'] for s in category_sprints)
                segment_efforts = self.zwift_fetcher.fetch_segment_efforts(unique_segment_ids, start_time, end_time)

            if custom_category:
                custom_cat_finishers.extend(finishers)
                custom_cat_segment_efforts.update(segment_efforts)
            else:
                if category_config_map and category_label not in category_config_map:
                    logger.info(f"    Skipping category {category_label} (not in configured categories)")
                    continue

                processed_batch = scorer.calculate_results(finishers, category_config, segment_efforts)
                all_results[category_label] = processed_batch
                logger.info(f"    Saved {len(processed_batch)} results to {category_label}")

        if custom_category and custom_cat_finishers:
            cat_config = self._get_category_config(race_data, custom_category)
            cat_config['sprints'] = source.get('sprints', [])
            cat_config['segmentType'] = source.get('segmentType')

            processed_batch = scorer.calculate_results(custom_cat_finishers, cat_config, custom_cat_segment_efforts)
            all_results[custom_category] = processed_batch
            logger.info(f"    Saved {len(processed_batch)} merged results to {custom_category}")

    def _get_category_config(self, race_data: dict[str, Any], category: str) -> RaceConfig:
        """Build a RaceConfig for a category, delegating to CategoryConfigResolver."""
        return CategoryConfigResolver.get_race_config(race_data, category)
