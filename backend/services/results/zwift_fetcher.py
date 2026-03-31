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
    ) -> list[RiderResult]:
        """
        Fetches participants/finishers for a subgroup and maps them to registered riders.
        """
        finishers: list[RiderResult] = []
        if fetch_mode == 'finishers':
            finish_results_raw = self.zwift.get_event_results(subgroup_id, event_secret=event_secret)

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
    ) -> dict[str | int, Any]:
        """
        Fetches results for a list of segments within a time window.
        Returns a dictionary: { segment_id: raw_results }
        """
        results: dict[str | int, Any] = {}
        for seg_id in segment_ids:
            try:
                raw = self.zwift.get_segment_results(seg_id, from_date=start_time, to_date=end_time)
                results[seg_id] = raw
            except Exception as e:
                logger.error(f"Failed to fetch segment {seg_id}: {e}")
        return results
