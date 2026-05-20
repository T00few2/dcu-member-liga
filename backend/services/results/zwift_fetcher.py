from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from models import RiderResult
from services.results.constants import (
    FETCH_MODE_FINISHERS,
    FETCH_MODE_LIVE,
    RACE_STATUS_DNF,
    RACE_STATUS_FIN,
)
from services.results.errors import FinishSegmentResolutionError
from services.results.finish_selector import (
    resolve_finish_segment_candidate,
    select_finish_entries_from_route_instances,
)
from services.results.finish_time import resolve_finish_time_ms
from services.results.critical_power import resolve_critical_power

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

    def fetch_subgroup_crossings(
        self,
        subgroup_id: str,
        event_secret: str = "",
    ) -> list[dict[str, Any]]:
        """
        Fetch all official subgroup segment-result crossings in internal entry shape.
        """
        return self.zwift.get_event_results(subgroup_id, event_secret=event_secret)

    def fetch_finishers(
        self,
        subgroup_id: str,
        event_secret: str,
        fetch_mode: str,
        registered_riders: dict[str, Any],
        route_segments: list[dict[str, Any]] | None = None,
        configured_sprints: list[dict[str, Any]] | None = None,
        subgroup_start_time: datetime | None = None,
        all_results_raw: list[dict[str, Any]] | None = None,
    ) -> list[RiderResult]:
        """
        Fetches participants/finishers for a subgroup and maps them to registered riders.
        """
        finishers: list[RiderResult] = []
        if fetch_mode == FETCH_MODE_FINISHERS:
            crossings = all_results_raw or self.fetch_subgroup_crossings(
                subgroup_id, event_secret
            )
            finish_results_raw = self._filter_finish_entries(
                crossings,
                route_segments,
                configured_sprints,
            )

            for entry in finish_results_raw:
                profile = entry.get('profileData', {})
                zid = str(profile.get('id') or entry.get('profileId'))
                registered_profile = registered_riders.get(zid)
                canonical_zwift_id = str(registered_profile.get('zwiftId')) if registered_profile and registered_profile.get('zwiftId') else zid

                # Helper to build finisher object
                finish_time_ms = resolve_finish_time_ms(entry, subgroup_start_time)
                finisher: RiderResult = {
                    'zwiftId': canonical_zwift_id,
                    'finishTime': finish_time_ms,
                    'raceStatus': RACE_STATUS_FIN if finish_time_ms > 0 else RACE_STATUS_DNF,
                    'flaggedCheating': entry.get('flaggedCheating', False),
                    'flaggedSandbagging': entry.get('flaggedSandbagging', False),
                    'criticalP': resolve_critical_power(entry.get('criticalP'), registered_profile),
                }
                official_sr = entry.get('_officialSegmentResult') or {}
                seg_activity_id = str(official_sr.get('activityId') or '').strip()
                if seg_activity_id:
                    finisher['activityId'] = seg_activity_id

                if registered_profile:
                    finisher['name'] = registered_profile.get('name')
                    finishers.append(finisher)

            finishers.sort(key=lambda x: x['finishTime'])

        else:
            participants_raw = self.zwift.get_event_participants(subgroup_id)

            for p in participants_raw:
                zid = str(p.get('id'))
                registered_profile = registered_riders.get(zid)
                canonical_zwift_id = str(registered_profile.get('zwiftId')) if registered_profile and registered_profile.get('zwiftId') else zid
                finisher = {
                    'zwiftId': canonical_zwift_id,
                    'finishTime': 0,
                    'raceStatus': RACE_STATUS_DNF,
                    'flaggedCheating': False,
                    'flaggedSandbagging': False,
                    'criticalP': resolve_critical_power(None, registered_profile),
                }

                if registered_profile:
                    finisher['name'] = registered_profile.get('name')
                    finishers.append(finisher)

            finishers.sort(key=lambda x: x['name'])

        return finishers

    def _filter_finish_entries(
        self,
        entries: list[dict[str, Any]],
        route_segments: list[dict[str, Any]] | None = None,
        configured_sprints: list[dict[str, Any]] | None = None,
    ) -> list[dict[str, Any]]:
        """
        Filter segment entries to finish-line entries only.

        Deterministically select finish-line entries from route segment instances.
        No heuristic fallback is applied.
        """
        by_segment: dict[str, list[dict[str, Any]]] = {}
        for e in entries:
            raw = e.get("_officialSegmentResult") or {}
            seg_id = str(raw.get("segmentId", ""))
            by_segment.setdefault(seg_id, []).append(e)

        # All entries have no segmentId -> unsegmented/single-segment payload; return as-is.
        if set(by_segment.keys()) == {""}:
            return entries

        # Work only with entries that carry a segmentId.
        segmented = {sid: ents for sid, ents in by_segment.items() if sid}

        if not segmented:
            return entries

        self._log_configured_sprint_crossings(segmented, configured_sprints)

        selected_from_route = select_finish_entries_from_route_instances(
            segmented=segmented,
            route_segments=route_segments,
            configured_sprints=configured_sprints,
            entry_sort_key=self._entry_sort_key,
        )
        if selected_from_route:
            return selected_from_route
        finish_candidate = resolve_finish_segment_candidate(
            segmented=segmented,
            route_segments=route_segments,
            configured_sprints=configured_sprints,
        )
        # Provisional in-race runs can legitimately have zero finish crossings so far.
        # If finish mapping is deterministic but no rider reached that crossing yet,
        # return an empty finisher list rather than failing the whole processing pass.
        if finish_candidate:
            return []
        raise FinishSegmentResolutionError(
            "Could not deterministically resolve finish segment from route instances. "
            "Check route segments and configured sprint instances.",
            context={
                "segment_ids_in_payload": sorted(segmented.keys()),
                "route_segment_count": len(route_segments or []),
                "configured_sprint_count": len(configured_sprints or []),
            },
        )

    def _log_configured_sprint_crossings(
        self,
        segmented: dict[str, list[dict[str, Any]]],
        configured_sprints: list[dict[str, Any]] | None,
    ) -> None:
        sprint_ids = {
            str(s.get("id") or "").strip()
            for s in (configured_sprints or [])
            if str(s.get("id") or "").strip()
        }
        if not sprint_ids:
            return

        for sprint_id in sorted(sprint_ids):
            rows = segmented.get(sprint_id, [])
            if not rows:
                logger.info("Sprint crossings segment=%s total=0 riders=0", sprint_id)
                continue

            by_rider: dict[str, list[int]] = {}
            for e in rows:
                profile = e.get("profileData", {}) if isinstance(e, dict) else {}
                rider_id = str(profile.get("id") or e.get("profileId") or "").strip()
                if not rider_id:
                    continue
                raw = e.get("_officialSegmentResult") or {}
                wt = int(raw.get("endWorldTime", 0) or 0)
                by_rider.setdefault(rider_id, []).append(wt)

            details: list[str] = []
            for rider_id in sorted(by_rider.keys()):
                wts = sorted(by_rider[rider_id])
                details.append(f"{rider_id}:{wts}")

            logger.info(
                "Sprint crossings segment=%s total=%s riders=%s details=%s",
                sprint_id,
                len(rows),
                len(by_rider),
                " | ".join(details),
            )

    def _entry_sort_key(self, entry: dict[str, Any]) -> tuple[int, int]:
        raw = entry.get("_officialSegmentResult") or {}
        end_world_time = int(raw.get("endWorldTime", 0) or 0)
        duration_ms = int(entry.get("activityData", {}).get("durationInMilliseconds", 0) or 0)
        return (end_world_time, duration_ms)

    def fetch_segment_efforts(
        self,
        segment_ids: set[str | int],
        start_time: datetime,
        end_time: datetime,
        subgroup_id: str | None = None,
        registered_riders: dict[str, Any] | None = None,
        all_results_raw: list[dict[str, Any]] | None = None,
    ) -> dict[str | int, Any]:
        """
        Fetches sprint/KOM segment results for the given segment IDs.

        When subgroup_id is provided (official API path), segment efforts are
        derived from the subgroup segment-results crossings payload (either
        pre-fetched via all_results_raw or fetched here).

        Each entry is normalised into the internal shape expected by
        RaceScorer._map_segment_efforts:
          athleteId  – canonical numeric zwiftId (UUID resolved via registered_riders)
          elapsed    – durationInMilliseconds
          worldTime  – endWorldTime
          avgPower   – avgWatts

        When subgroup_id is absent the method falls back to the legacy
        per-segment global lookup (get_segment_results), which currently
        returns an empty payload for official-only mode.
        """
        del start_time, end_time
        if subgroup_id:
            crossings = all_results_raw
            if crossings is None:
                crossings = self.fetch_subgroup_crossings(subgroup_id)
            return self._normalise_segment_efforts_from_crossings(
                segment_ids, crossings, registered_riders or {}
            )

        # Legacy fallback path (returns empty in official_only mode)
        results: dict[str | int, Any] = {}
        for seg_id in segment_ids:
            try:
                raw = self.zwift.get_segment_results(seg_id)
                results[seg_id] = raw
            except Exception as e:
                logger.error(f"Failed to fetch segment {seg_id}: {e}")
        return results

    def _normalise_segment_efforts_from_crossings(
        self,
        segment_ids: set[str | int],
        all_results_raw: list[dict[str, Any]],
        registered_riders: dict[str, Any],
    ) -> dict[str | int, Any]:
        """
        Build sprint-effort payload from already-fetched subgroup crossings.
        """
        wanted_ids = {str(sid) for sid in segment_ids}
        by_seg_str: dict[str, list[dict[str, Any]]] = {}

        for entry in all_results_raw:
            raw = entry.get("_officialSegmentResult") or {}
            seg_id_str = str(raw.get("segmentId", "")).strip()
            if not seg_id_str or seg_id_str not in wanted_ids:
                continue

            user_id = str(
                raw.get("userId")
                or (entry.get("profileData") or {}).get("id")
                or entry.get("profileId")
                or ""
            ).strip()
            profile = registered_riders.get(user_id)
            canonical_id = (
                str(profile.get("zwiftId"))
                if profile and profile.get("zwiftId")
                else user_id
            )

            by_seg_str.setdefault(seg_id_str, []).append({
                "athleteId": canonical_id,
                "elapsed": int(
                    raw.get("durationInMilliseconds")
                    or (entry.get("activityData") or {}).get("durationInMilliseconds")
                    or 0
                ),
                "worldTime": int(raw.get("endWorldTime", 0) or 0),
                "avgPower": int(raw.get("avgWatts", 0) or 0),
            })

        results: dict[str | int, Any] = {}
        for sid in segment_ids:
            sid_str = str(sid)
            if sid_str in by_seg_str:
                results[sid] = by_seg_str[sid_str]
        return results

