from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from models import RiderResult

logger = logging.getLogger('ZwiftFetcher')


class ZwiftFetcher:
    def __init__(self, zwift_service: Any) -> None:
        self.zwift = zwift_service

    def get_event_info(self, event_id: str, event_secret: str) -> dict[str, Any]:
        return self.zwift.get_event_info(event_id, event_secret)

    def extract_subgroups(self, event_info: dict[str, Any]) -> list[dict[str, Any]]:
        result: list[dict[str, Any]] = []
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

    def fetch_finishers(
        self,
        subgroup_id: str,
        event_secret: str,
        fetch_mode: str,
        filter_registered: bool,
        registered_riders: dict[str, Any],
        sprint_segment_ids: set[str | int] | None = None,
        route_segment_ids_ordered: list[str | int] | None = None,
    ) -> list[RiderResult]:
        """
        Fetches participants/finishers for a subgroup and maps them to registered riders.

        sprint_segment_ids and route_segment_ids_ordered are forwarded to
        ZwiftService.get_event_results so it can identify the finish-line
        segment by exclusion rather than relying on duration heuristics.
        This is required for correct live/partial results.
        """
        finishers: list[RiderResult] = []
        if fetch_mode == 'finishers':
            finish_results_raw = self.zwift.get_event_results(
                subgroup_id,
                event_secret=event_secret,
                sprint_segment_ids=sprint_segment_ids,
                route_segment_ids_ordered=route_segment_ids_ordered,
            )

            for entry in finish_results_raw:
                profile = entry.get('profileData', {})
                zid = str(profile.get('id') or entry.get('profileId'))
                registered_profile = registered_riders.get(zid)
                canonical_zwift_id = str(registered_profile.get('zwiftId')) if registered_profile and registered_profile.get('zwiftId') else zid

                # Helper to build finisher object
                finisher: RiderResult = {
                    'zwiftId': canonical_zwift_id,
                    'finishTime': entry.get('activityData', {}).get('durationInMilliseconds', 0),
                    'flaggedCheating': entry.get('flaggedCheating', False),
                    'flaggedSandbagging': entry.get('flaggedSandbagging', False),
                    'criticalP': entry.get('criticalP', {})
                }

                if registered_profile:
                    finisher['name'] = registered_profile.get('name')
                    finishers.append(finisher)
                elif not filter_registered:
                    finisher['name'] = f"{profile.get('firstName', '')} {profile.get('lastName', '')}".strip()
                    finishers.append(finisher)

            finishers.sort(key=lambda x: x['finishTime'])

        else:
            is_joined = (fetch_mode == 'joined')
            participants_raw = self.zwift.get_event_participants(subgroup_id, joined=is_joined)

            for p in participants_raw:
                zid = str(p.get('id'))
                registered_profile = registered_riders.get(zid)
                canonical_zwift_id = str(registered_profile.get('zwiftId')) if registered_profile and registered_profile.get('zwiftId') else zid
                finisher = {
                    'zwiftId': canonical_zwift_id,
                    'finishTime': 0,
                    'flaggedCheating': False,
                    'flaggedSandbagging': False,
                    'criticalP': {}
                }

                if registered_profile:
                    finisher['name'] = registered_profile.get('name')
                    finishers.append(finisher)
                elif not filter_registered:
                    finisher['name'] = f"{p.get('firstName', '')} {p.get('lastName', '')}".strip()
                    finishers.append(finisher)

            finishers.sort(key=lambda x: x['name'])

        return finishers

    def fetch_segment_efforts(
        self,
        segment_ids: set[str | int],
        start_time: datetime,
        end_time: datetime,
        subgroup_id: str | None = None,
        registered_riders: dict[str, Any] | None = None,
    ) -> dict[str | int, Any]:
        """
        Fetches sprint/KOM segment results for the given segment IDs.

        When subgroup_id is provided (official API path) the method calls
        ZwiftService.get_subgroup_segment_efforts which retrieves all
        segment-results for the subgroup in one paginated sweep and filters
        down to the configured sprint IDs.

        Each entry is normalised into the legacy shape expected by
        RaceScorer._map_segment_efforts:
          athleteId  – canonical numeric zwiftId (UUID resolved via registered_riders)
          elapsed    – durationInMilliseconds
          worldTime  – endWorldTime
          avgPower   – avgWatts

        When subgroup_id is absent the method falls back to the legacy
        per-segment global lookup (get_segment_results), which currently
        returns an empty payload for official-only mode.
        """
        if subgroup_id:
            return self._fetch_segment_efforts_official(
                segment_ids, subgroup_id, registered_riders or {}
            )

        # Legacy fallback path (returns empty in official_only mode)
        results: dict[str | int, Any] = {}
        for seg_id in segment_ids:
            try:
                raw = self.zwift.get_segment_results(seg_id, from_date=start_time, to_date=end_time)
                results[seg_id] = raw
            except Exception as e:
                logger.error(f"Failed to fetch segment {seg_id}: {e}")
        return results

    def _fetch_segment_efforts_official(
        self,
        segment_ids: set[str | int],
        subgroup_id: str,
        registered_riders: dict[str, Any],
    ) -> dict[str | int, Any]:
        """
        Official-API sprint data fetch via subgroup segment-results endpoint.
        Normalises raw entries to the legacy athleteId/elapsed/worldTime/avgPower
        schema so RaceScorer._map_segment_efforts requires no changes.
        """
        try:
            raw_by_seg = self.zwift.get_subgroup_segment_efforts(subgroup_id, segment_ids)
        except Exception as e:
            logger.error(f"Failed to fetch subgroup segment efforts for {subgroup_id}: {e}")
            return {}

        results: dict[str | int, Any] = {}
        for seg_id_str, entries in raw_by_seg.items():
            normalised: list[dict[str, Any]] = []
            for e in entries:
                user_id = str(e.get("userId", ""))
                # Resolve UUID -> canonical numeric zwiftId via registered_riders
                profile = registered_riders.get(user_id)
                canonical_id = (
                    str(profile.get("zwiftId"))
                    if profile and profile.get("zwiftId")
                    else user_id
                )
                normalised.append({
                    "athleteId": canonical_id,
                    "elapsed": int(e.get("durationInMilliseconds", 0)),
                    "worldTime": int(e.get("endWorldTime", 0)),
                    "avgPower": int(e.get("avgWatts", 0)),
                })
            # Preserve the original seg_id type (str or int) from the input set
            # so RaceScorer can match against sprint configs stored as either type.
            original_key: str | int = seg_id_str
            for sid in segment_ids:
                if str(sid) == seg_id_str:
                    original_key = sid
                    break
            results[original_key] = normalised

        return results
