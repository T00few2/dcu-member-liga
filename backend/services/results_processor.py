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
from services.category_engine import _effective_cat_name
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
        event_mode = race_data.get('eventMode', 'single')

        if event_mode == 'grouped':
            logger.info("Using raceGroups sources (grouped mode)")
            for group in race_data.get('raceGroups', []):
                category_config_map = {
                    str(c.get('category')).strip(): c
                    for c in group.get('categories', [])
                    if str(c.get('category', '')).strip()
                }
                event_sources.append({
                    'id': group.get('eventId'),
                    'secret': group.get('eventSecret', ''),
                    'customCategory': None,
                    'groupedMode': True,
                    'categoryConfigMap': category_config_map,
                    'sprints': group.get('sprints', []),
                    'segmentType': group.get('segmentType') or race_data.get('segmentType'),
                    'startTime': group.get('startTime') or race_data.get('date'),
                })
        else:
            event_config = race_data.get('eventConfiguration', [])
            if event_config and len(event_config) > 0:
                logger.info("Using eventConfiguration sources (multi mode)")
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
            conn_zwift = (data.get('connections') or {}).get('zwift') if isinstance(data.get('connections'), dict) else {}
            conn_user_id = (conn_zwift or {}).get('userId')

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
            if conn_user_id and is_registered:
                registered_riders[str(conn_user_id)] = data

        logger.info(f"Found {len(registered_riders)} registered riders in database.")

        # 4. Process Each Source
        all_results: RaceResults = race_data.get('results', {})
        if not all_results:
            all_results = {}

        processed_sources = 0
        failed_sources = 0
        for source in event_sources:
            ok = self._process_event_source(
                source,
                race_data,
                registered_riders,
                scorer,
                all_results,
                fetch_mode,
                filter_registered,
                category_filter
            )
            if ok:
                processed_sources += 1
            else:
                failed_sources += 1

        if processed_sources == 0 and failed_sources > 0:
            raise Exception(
                "Unable to fetch Zwift event data for configured source(s). "
                "Verify Event IDs, Event Secret, and event availability."
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
    ) -> bool:
        event_id = source.get('id')
        direct_subgroup_id = source.get('subgroupId')
        event_secret = source['secret']
        custom_category = source['customCategory']
        category_config_map = source.get('categoryConfigMap', {})
        grouped_mode = bool(source.get('groupedMode'))
        configured_categories = list(category_config_map.keys()) if grouped_mode else []

        if not event_id and not direct_subgroup_id:
            return False

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
                return False
            subgroups = self.zwift_fetcher.extract_subgroups(event_info)

            # If this source targets one custom category but subgroupId was not
            # persisted yet, restrict to the matching subgroup label when present.
            if custom_category:
                wanted = str(custom_category).strip().upper()
                matched = [
                    sg for sg in subgroups
                    if str(sg.get("subgroupLabel") or "").strip().upper() == wanted
                ]
                if matched:
                    subgroups = matched
        logger.info(f"  Found {len(subgroups)} subgroups.")

        custom_cat_finishers: list[Any] = []
        custom_cat_segment_efforts: dict[str | int, Any] = {}
        grouped_finishers_by_category: dict[str, list[Any]] = defaultdict(list)
        grouped_segment_efforts: dict[str | int, list[Any]] = {}
        grouped_sprints_union = self._merge_grouped_sprints(source)

        for subgroup in subgroups:
            category_label = subgroup['subgroupLabel']
            effective_category = custom_category if custom_category else category_label

            if category_filter and category_filter != 'All':
                if grouped_mode:
                    if category_filter not in configured_categories:
                        continue
                elif custom_category:
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

            # Determine Configs (must happen before fetch_finishers so sprint IDs
            # can be forwarded for accurate finish-segment identification)
            category_sprints = source.get('sprints', [])
            category_segment_type = source.get('segmentType')
            if grouped_mode:
                category_sprints = grouped_sprints_union

            if not custom_category and category_label in category_config_map:
                cat_cfg = category_config_map[category_label]
                if cat_cfg.get('sprints'):
                    category_sprints = cat_cfg['sprints']
                    logger.info(f"    Using per-category sprints for {category_label}: {len(category_sprints)} sprints")
                if cat_cfg.get('segmentType'):
                    category_segment_type = cat_cfg['segmentType']

            # Build ordered route segment list for finish-line identification.
            # The finish segment = last non-sprint segment in route chronology.
            route_segment_ids_ordered: list[Any] = []
            route_id = race_data.get('routeId') or subgroup.get('routeId')
            route_laps = subgroup.get('laps') or race_data.get('laps') or 1
            if route_id:
                try:
                    route_segs = self.game.get_event_segments(str(route_id), int(route_laps))
                    route_segment_ids_ordered = [s['id'] for s in route_segs if s.get('id')]
                except Exception as e:
                    logger.warning(f"Could not resolve route segments for {route_id}: {e}")

            sprint_ids_set: set[str | int] = {s['id'] for s in category_sprints}

            # Fetch Finishers using ZwiftFetcher
            finishers = self.zwift_fetcher.fetch_finishers(
                subgroup_id,
                event_secret,
                fetch_mode,
                filter_registered,
                registered_riders,
                sprint_segment_ids=sprint_ids_set,
                route_segment_ids_ordered=route_segment_ids_ordered,
                subgroup_start_time=start_time,
            )

            # Fetch Segment Efforts using ZwiftFetcher
            segment_efforts: dict[str | int, Any] = {}
            if fetch_mode in ['finishers', 'joined'] and category_sprints:
                end_time = start_time + timedelta(hours=3)
                unique_segment_ids = set(s['id'] for s in category_sprints)
                segment_efforts = self.zwift_fetcher.fetch_segment_efforts(
                    unique_segment_ids,
                    start_time,
                    end_time,
                    subgroup_id=subgroup_id,
                    registered_riders=registered_riders,
                )
                logger.info(
                    "    Segment fetch subgroup=%s requested_ids=%s returned_segments=%s",
                    subgroup_id,
                    len(unique_segment_ids),
                    len(segment_efforts),
                )
                finishers = self._append_segment_starter_dnfs(
                    finishers=finishers,
                    segment_efforts=segment_efforts,
                    registered_riders=registered_riders,
                )

            if grouped_mode:
                for seg_id, efforts in segment_efforts.items():
                    existing = grouped_segment_efforts.setdefault(seg_id, [])
                    if isinstance(efforts, list):
                        existing.extend(efforts)
                for finisher in finishers:
                    subgroup_category = self._match_configured_category(
                        configured_categories,
                        category_label,
                    )
                    rider_doc = registered_riders.get(str(finisher.get('zwiftId') or '').strip())
                    registered_category = self._effective_registered_category(rider_doc)
                    if (
                        subgroup_category
                        and registered_category
                        and subgroup_category != registered_category
                        and registered_category in configured_categories
                    ):
                        wc_finisher = dict(finisher)
                        wc_finisher['finishTime'] = 0
                        wc_finisher['raceStatus'] = 'WC'
                        grouped_finishers_by_category[registered_category].append(wc_finisher)
                        continue
                    mapped_category = self._resolve_grouped_category(
                        finisher,
                        registered_riders,
                        configured_categories,
                        category_label,
                    )
                    if not mapped_category:
                        continue
                    grouped_finishers_by_category[mapped_category].append(finisher)
            elif custom_category:
                custom_cat_finishers.extend(finishers)
                custom_cat_segment_efforts.update(segment_efforts)
            else:
                category_config = self._get_category_config(race_data, effective_category)
                category_config['sprints'] = category_sprints
                category_config['segmentType'] = category_segment_type
                if category_config_map and category_label not in category_config_map:
                    logger.info(f"    Skipping category {category_label} (not in configured categories)")
                    continue

                processed_batch = scorer.calculate_results(finishers, category_config, segment_efforts)
                all_results[category_label] = processed_batch
                logger.info(f"    Saved {len(processed_batch)} results to {category_label}")

        if grouped_mode:
            for category_name in configured_categories:
                if category_filter and category_filter != 'All' and category_name != category_filter:
                    continue
                riders = self._dedupe_finishers(grouped_finishers_by_category.get(category_name, []))
                if not riders:
                    continue
                cat_config = self._get_category_config(race_data, category_name)
                processed_batch = scorer.calculate_results(riders, cat_config, grouped_segment_efforts)
                all_results[category_name] = processed_batch
                logger.info(f"    Saved {len(processed_batch)} grouped results to {category_name}")
        elif custom_category and custom_cat_finishers:
            cat_config = self._get_category_config(race_data, custom_category)
            cat_config['sprints'] = source.get('sprints', [])
            cat_config['segmentType'] = source.get('segmentType')

            processed_batch = scorer.calculate_results(custom_cat_finishers, cat_config, custom_cat_segment_efforts)
            all_results[custom_category] = processed_batch
            logger.info(f"    Saved {len(processed_batch)} merged results to {custom_category}")
        return True

    def _get_category_config(self, race_data: dict[str, Any], category: str) -> RaceConfig:
        """Build a RaceConfig for a category, delegating to CategoryConfigResolver."""
        return CategoryConfigResolver.get_race_config(race_data, category)

    def _merge_grouped_sprints(self, source: dict[str, Any]) -> list[dict[str, Any]]:
        merged: list[dict[str, Any]] = []
        seen: set[str] = set()
        for sprint in source.get('sprints', []) or []:
            key = str(sprint.get('key') or f"{sprint.get('id')}_{sprint.get('count', '')}")
            if key and key not in seen:
                merged.append(sprint)
                seen.add(key)
        for cfg in (source.get('categoryConfigMap') or {}).values():
            for sprint in cfg.get('sprints', []) or []:
                key = str(sprint.get('key') or f"{sprint.get('id')}_{sprint.get('count', '')}")
                if key and key not in seen:
                    merged.append(sprint)
                    seen.add(key)
        return merged

    def _resolve_grouped_category(
        self,
        finisher: dict[str, Any],
        registered_riders: dict[str, Any],
        configured_categories: list[str],
        subgroup_label: str | None,
    ) -> str | None:
        if not configured_categories:
            return None
        configured_map = {str(c).strip().lower(): str(c).strip() for c in configured_categories if str(c).strip()}

        zid = str(finisher.get('zwiftId') or '').strip()
        rider_doc = registered_riders.get(zid)
        candidate = self._effective_registered_category(rider_doc)
        if candidate:
            matched = configured_map.get(str(candidate).strip().lower())
            if matched:
                return matched

        subgroup_name = str(subgroup_label or '').strip()
        matched_subgroup = configured_map.get(subgroup_name.lower())
        if matched_subgroup:
            return matched_subgroup
        return None

    def _match_configured_category(
        self,
        configured_categories: list[str],
        category_value: str | None,
    ) -> str | None:
        if not configured_categories:
            return None
        value = str(category_value or '').strip().lower()
        if not value:
            return None
        lookup = {str(c).strip().lower(): str(c).strip() for c in configured_categories if str(c).strip()}
        return lookup.get(value)

    def _effective_registered_category(self, rider_doc: dict[str, Any] | None) -> str | None:
        if not rider_doc:
            return None
        liga = rider_doc.get('ligaCategory') or {}
        if liga.get('locked') and liga.get('category'):
            return str(liga.get('category'))

        auto_cat = (liga.get('autoAssigned') or {}).get('category')
        self_cat = (liga.get('selfSelected') or {}).get('category')
        effective = _effective_cat_name(auto_cat, self_cat)
        if effective:
            return str(effective)
        if auto_cat:
            return str(auto_cat)
        if self_cat:
            return str(self_cat)
        return None

    def _dedupe_finishers(self, riders: list[dict[str, Any]]) -> list[dict[str, Any]]:
        by_id: dict[str, dict[str, Any]] = {}
        for rider in riders:
            zid = str(rider.get('zwiftId') or '').strip()
            if not zid:
                continue
            existing = by_id.get(zid)
            if not existing:
                by_id[zid] = rider
                continue
            current_time = int(rider.get('finishTime') or 0)
            existing_time = int(existing.get('finishTime') or 0)
            # Keep the latest elapsed race time when duplicate entries exist
            # (e.g. multiple segment crossings for the same rider).
            if current_time > existing_time:
                by_id[zid] = rider
        return list(by_id.values())

    def _append_segment_starter_dnfs(
        self,
        finishers: list[dict[str, Any]],
        segment_efforts: dict[str | int, Any],
        registered_riders: dict[str, Any],
    ) -> list[dict[str, Any]]:
        """
        Ensure riders who started (have segment efforts) but never crossed finish
        still appear in results as DNF.
        """
        if not segment_efforts:
            return finishers

        out = list(finishers)
        existing_ids = {str(r.get('zwiftId') or '').strip() for r in out if str(r.get('zwiftId') or '').strip()}

        for efforts in segment_efforts.values():
            rows = efforts.get('results', []) if isinstance(efforts, dict) else efforts
            if not isinstance(rows, list):
                continue
            for entry in rows:
                if not isinstance(entry, dict):
                    continue
                raw_id = str(
                    entry.get('athleteId')
                    or entry.get('userId')
                    or entry.get('profileId')
                    or ''
                ).strip()
                if not raw_id:
                    continue

                profile = registered_riders.get(raw_id)
                if not profile:
                    continue
                canonical_id = str(profile.get('zwiftId') or raw_id).strip()
                if not canonical_id or canonical_id in existing_ids:
                    continue

                out.append({
                    'zwiftId': canonical_id,
                    'name': profile.get('name') or canonical_id,
                    'finishTime': 0,
                    'raceStatus': 'DNF',
                    'flaggedCheating': False,
                    'flaggedSandbagging': False,
                    'criticalP': {},
                })
                existing_ids.add(canonical_id)

        return out
