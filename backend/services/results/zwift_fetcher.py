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

        sprint_segment_ids and route_segment_ids_ordered are used to identify
        the finish-line segment by exclusion from sprint segments.
        This is required for correct live/partial results.
        """
        finishers: list[RiderResult] = []
        if fetch_mode == 'finishers':
            all_results_raw = self.zwift.get_event_results(
                subgroup_id,
                event_secret=event_secret,
            )
            finish_results_raw = self._filter_finish_entries(
                all_results_raw, sprint_segment_ids, route_segment_ids_ordered
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

    def _filter_finish_entries(
        self,
        entries: list[dict[str, Any]],
        sprint_segment_ids: set[str | int] | None,
        route_segment_ids_ordered: list[str | int] | None,
    ) -> list[dict[str, Any]]:
        """
        Filter segment entries to finish-line entries only.

        Groups entries by segmentId (from _officialSegmentResult), excludes sprint
        segments, and uses route order or max-duration heuristic as tiebreaker.
        Entries without a segmentId (legacy path) are returned as-is.
        """
        by_segment: dict[str, list[dict[str, Any]]] = {}
        for e in entries:
            raw = e.get("_officialSegmentResult") or {}
            seg_id = str(raw.get("segmentId", ""))
            by_segment.setdefault(seg_id, []).append(e)

        # All entries have no segmentId → legacy path or single-segment; return as-is.
        if set(by_segment.keys()) == {""}:
            return entries

        # Work only with entries that carry a segmentId.
        segmented = {sid: ents for sid, ents in by_segment.items() if sid}

        if not segmented:
            return entries

        if sprint_segment_ids:
            sprint_ids_str = {str(s) for s in sprint_segment_ids}
            non_sprint = {sid: ents for sid, ents in segmented.items() if sid not in sprint_ids_str}
        else:
            non_sprint = dict(segmented)

        if not non_sprint:
            logger.warning(
                "segment-results: all entries are sprint segments; cannot identify finish. "
                "Returning all entries."
            )
            return entries

        if len(non_sprint) == 1:
            return next(iter(non_sprint.values()))

        # Multiple non-sprint segments: try route order (last segment = finish arch).
        if route_segment_ids_ordered:
            for seg_id in reversed([str(s) for s in route_segment_ids_ordered]):
                if seg_id in non_sprint:
                    return non_sprint[seg_id]

        # Final fallback: segment with the highest maximum duration per rider.
        logger.warning(
            "segment-results: multiple non-sprint segments and no route order available. "
            "Using max-duration heuristic to select finish segment."
        )
        finish_seg = max(
            non_sprint,
            key=lambda sid: max(
                (e.get("activityData", {}).get("durationInMilliseconds", 0) for e in non_sprint[sid]),
                default=0,
            ),
        )
        return non_sprint[finish_seg]

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
