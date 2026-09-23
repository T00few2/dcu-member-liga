from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from models import RiderResult
from services.results.constants import (
    FETCH_MODE_FINISHERS,
    RACE_STATUS_DNF,
    RACE_STATUS_FIN,
)
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

        Finish times come only from official race-results
        (activityData.durationInMilliseconds). Segment-results are never used
        as a finish source.
        """
        del event_secret, route_segments, configured_sprints, subgroup_start_time, all_results_raw
        finishers: list[RiderResult] = []
        if fetch_mode == FETCH_MODE_FINISHERS:
            official_finishers = self._finishers_from_official_race_results(
                subgroup_id,
                registered_riders,
            )
            logger.info(
                "Using official race-results for %s finishers (subgroup %s)",
                len(official_finishers),
                subgroup_id,
            )
            return official_finishers

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
                    club = str(registered_profile.get('club') or registered_profile.get('team') or '').strip()
                    if club:
                        finisher['club'] = club
                    finishers.append(finisher)

            finishers.sort(key=lambda x: x['name'])

        return finishers

    def _finishers_from_official_race_results(
        self,
        subgroup_id: str,
        registered_riders: dict[str, Any],
    ) -> list[RiderResult]:
        """
        Build finishers from official race-results.

        Finish times always come from activityData.durationInMilliseconds.
        Returns an empty list if race-results are unavailable. There is no
        banner-crossing fallback. Sprint/KOM/FAL still come from segment-results.
        """
        if not self.zwift or not hasattr(self.zwift, "get_subgroup_race_results"):
            return []
        try:
            payload = self.zwift.get_subgroup_race_results(str(subgroup_id))
        except Exception as exc:
            logger.warning(
                "Could not fetch official race-results for subgroup %s: %s",
                subgroup_id,
                exc,
            )
            return []
        entries = payload.get("entries") if isinstance(payload, dict) else None
        if not isinstance(entries, list):
            return []

        finishers: list[RiderResult] = []
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            user_id = str(entry.get("userId") or "").strip()
            registered_profile = registered_riders.get(user_id) if user_id else None
            if not registered_profile:
                continue
            activity = entry.get("activityData") if isinstance(entry.get("activityData"), dict) else {}
            duration_ms = int(activity.get("durationInMilliseconds") or 0)
            activity_id = str(activity.get("activityId") or "").strip()
            canonical_zwift_id = str(registered_profile.get("zwiftId") or user_id)
            finisher: RiderResult = {
                "zwiftId": canonical_zwift_id,
                "finishTime": duration_ms if duration_ms > 0 else 0,
                "raceStatus": RACE_STATUS_FIN if duration_ms > 0 else RACE_STATUS_DNF,
                "flaggedCheating": bool(entry.get("flaggedCheating", False)),
                "flaggedSandbagging": bool(entry.get("flaggedSandbagging", False)),
                "criticalP": resolve_critical_power(entry.get("criticalP"), registered_profile),
                "name": registered_profile.get("name"),
            }
            club = str(registered_profile.get("club") or registered_profile.get("team") or "").strip()
            if club:
                finisher["club"] = club
            if activity_id:
                finisher["activityId"] = activity_id
            finishers.append(finisher)

        finishers.sort(key=lambda row: row.get("finishTime") or 10**15)
        return finishers

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

