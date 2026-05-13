from __future__ import annotations

import logging
from datetime import datetime, timezone
from collections import defaultdict
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
        route_segments: list[dict[str, Any]] | None = None,
        configured_sprints: list[dict[str, Any]] | None = None,
        subgroup_start_time: datetime | None = None,
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
                all_results_raw,
                sprint_segment_ids,
                route_segment_ids_ordered,
                route_segments,
                configured_sprints,
            )

            for entry in finish_results_raw:
                profile = entry.get('profileData', {})
                zid = str(profile.get('id') or entry.get('profileId'))
                registered_profile = registered_riders.get(zid)
                canonical_zwift_id = str(registered_profile.get('zwiftId')) if registered_profile and registered_profile.get('zwiftId') else zid

                # Helper to build finisher object
                finish_time_ms = self._resolve_finish_time_ms(entry, subgroup_start_time)
                finisher: RiderResult = {
                    'zwiftId': canonical_zwift_id,
                    'finishTime': finish_time_ms,
                    'raceStatus': 'FIN' if finish_time_ms > 0 else 'DNF',
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
                    'raceStatus': 'DNF',
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
        route_segments: list[dict[str, Any]] | None = None,
        configured_sprints: list[dict[str, Any]] | None = None,
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

        selected_from_route = self._select_finish_entries_from_route_instances(
            segmented=segmented,
            route_segments=route_segments,
            configured_sprints=configured_sprints,
        )
        if selected_from_route:
            return selected_from_route

        if sprint_segment_ids:
            sprint_ids_str = {str(s) for s in sprint_segment_ids}
            non_sprint = {sid: ents for sid, ents in segmented.items() if sid not in sprint_ids_str}
        else:
            non_sprint = dict(segmented)

        if not non_sprint:
            logger.warning(
                "segment-results: all entries are sprint segments; cannot identify finish. "
                "Using latest segment crossing per rider."
            )
            inferred_finish = self._infer_finish_entries_from_all_sprints(segmented)
            if inferred_finish:
                return inferred_finish
            non_sprint = dict(segmented)

        # Select finish result per rider by latest segment crossing among candidate segments.
        # This is robust for grouped/event routes where finish may not map to a single
        # stable segmentId across all riders.
        latest_by_rider: dict[str, dict[str, Any]] = {}
        for seg_entries in non_sprint.values():
            for e in seg_entries:
                profile = e.get('profileData', {}) if isinstance(e, dict) else {}
                rider_id = str(profile.get('id') or e.get('profileId') or "")
                if not rider_id:
                    continue
                existing = latest_by_rider.get(rider_id)
                if existing is None:
                    latest_by_rider[rider_id] = e
                    continue
                if self._entry_sort_key(e) > self._entry_sort_key(existing):
                    latest_by_rider[rider_id] = e
        if latest_by_rider:
            return list(latest_by_rider.values())

        if len(non_sprint) == 1:
            return next(iter(non_sprint.values()))
        if route_segment_ids_ordered:
            for seg_id in reversed([str(s) for s in route_segment_ids_ordered]):
                if seg_id in non_sprint:
                    return non_sprint[seg_id]
        return next(iter(non_sprint.values()))

    def _select_finish_entries_from_route_instances(
        self,
        segmented: dict[str, list[dict[str, Any]]],
        route_segments: list[dict[str, Any]] | None,
        configured_sprints: list[dict[str, Any]] | None,
    ) -> list[dict[str, Any]]:
        """
        Deterministically pick finish entries from route segment instances.

        Reuses the same id+count(+direction) concept used by the race-card logic:
        - route_segments is the full ordered route manifest occurrences
        - configured_sprints lists explicit sprint instances
        - finish instance is the last race-lap route segment not configured as sprint
        """
        if not segmented or not route_segments:
            return []
        if not configured_sprints:
            return []

        def _norm_direction(value: Any) -> str:
            raw = str(value or "").strip().lower()
            if raw in {"reverse", "rev", "r"}:
                return "reverse"
            return "forward"

        sprint_instances: set[tuple[str, int, str]] = set()
        sprint_instances_wild_dir: set[tuple[str, int]] = set()
        sprint_instances_by_lap: set[tuple[str, int, str]] = set()
        sprint_instances_by_lap_wild_dir: set[tuple[str, int]] = set()
        for sprint in configured_sprints or []:
            sid = str(sprint.get("id") or "").strip()
            if not sid:
                continue
            try:
                count = int(sprint.get("count") or 1)
            except (TypeError, ValueError):
                count = 1
            if count < 1:
                count = 1
            direction_raw = sprint.get("direction")
            if direction_raw is None or str(direction_raw).strip() == "":
                sprint_instances_wild_dir.add((sid, count))
            else:
                sprint_instances.add((sid, count, _norm_direction(direction_raw)))
            lap_raw = sprint.get("lap")
            try:
                lap = int(lap_raw) if lap_raw is not None else 0
            except (TypeError, ValueError):
                lap = 0
            if lap > 0:
                if direction_raw is None or str(direction_raw).strip() == "":
                    sprint_instances_by_lap_wild_dir.add((sid, lap))
                else:
                    sprint_instances_by_lap.add((sid, lap, _norm_direction(direction_raw)))

        # Prefer candidates that keep the most riders (coverage), then latest in route.
        # This avoids selecting rare post-finish or connector segments.
        all_riders: set[str] = set()
        for seg_entries in segmented.values():
            for e in seg_entries:
                profile = e.get('profileData', {}) if isinstance(e, dict) else {}
                rider_id = str(profile.get('id') or e.get('profileId') or "")
                if rider_id:
                    all_riders.add(rider_id)

        best_score = -1
        finish_seg_id: str | None = None
        finish_seg_count: int | None = None
        for seg in reversed(route_segments):
            sid = str(seg.get("id") or "").strip()
            if not sid or sid not in segmented:
                continue
            lap = int(seg.get("lap") or 0)
            if lap < 1:
                continue
            try:
                seg_count = int(seg.get("count") or 1)
            except (TypeError, ValueError):
                seg_count = 1
            if seg_count < 1:
                seg_count = 1
            seg_direction = _norm_direction(seg.get("direction"))
            if (sid, seg_count) in sprint_instances_wild_dir:
                continue
            if (sid, seg_count, seg_direction) in sprint_instances:
                continue
            if lap > 0 and (sid, lap) in sprint_instances_by_lap_wild_dir:
                continue
            if lap > 0 and (sid, lap, seg_direction) in sprint_instances_by_lap:
                continue

            by_rider_counts: dict[str, int] = defaultdict(int)
            for e in segmented.get(sid, []):
                profile = e.get('profileData', {}) if isinstance(e, dict) else {}
                rider_id = str(profile.get('id') or e.get('profileId') or "")
                if rider_id:
                    by_rider_counts[rider_id] += 1
            coverage = sum(1 for cnt in by_rider_counts.values() if cnt >= seg_count)

            if coverage > best_score:
                best_score = coverage
                finish_seg_id = sid
                finish_seg_count = seg_count

        if not finish_seg_id or not finish_seg_count:
            return []
        if all_riders and best_score <= 0:
            return []

        by_rider: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for e in segmented.get(finish_seg_id, []):
            profile = e.get('profileData', {}) if isinstance(e, dict) else {}
            rider_id = str(profile.get('id') or e.get('profileId') or "")
            if rider_id:
                by_rider[rider_id].append(e)

        selected: list[dict[str, Any]] = []
        for rider_entries in by_rider.values():
            rider_entries.sort(key=self._entry_sort_key)
            if len(rider_entries) >= finish_seg_count:
                selected.append(rider_entries[finish_seg_count - 1])

        return selected

    def _infer_finish_entries_from_all_sprints(
        self,
        segmented: dict[str, list[dict[str, Any]]],
    ) -> list[dict[str, Any]]:
        """
        Fallback for routes where all observed segments are configured as sprints.
        Infer a finish segment by latest subgroup crossing and require riders to have
        the modal pass-count on that segment to be considered finishers.
        """
        if not segmented:
            return []

        def _max_end_world(entries: list[dict[str, Any]]) -> int:
            return max((int((e.get("_officialSegmentResult") or {}).get("endWorldTime", 0) or 0) for e in entries), default=0)

        finish_seg_id = max(segmented.keys(), key=lambda sid: _max_end_world(segmented[sid]))
        finish_entries = segmented.get(finish_seg_id, [])
        if not finish_entries:
            return []

        by_rider: dict[str, list[dict[str, Any]]] = defaultdict(list)
        for e in finish_entries:
            profile = e.get('profileData', {}) if isinstance(e, dict) else {}
            rider_id = str(profile.get('id') or e.get('profileId') or "")
            if rider_id:
                by_rider[rider_id].append(e)

        if not by_rider:
            return []

        # Determine the target pass count per rider. In ties, prefer the lower pass
        # count to avoid turning valid single-pass finishers into DNF.
        pass_count_freq: dict[int, int] = defaultdict(int)
        for rider_entries in by_rider.values():
            pass_count_freq[len(rider_entries)] += 1
        expected_pass_count = 1
        if pass_count_freq:
            max_freq = max(pass_count_freq.values())
            expected_pass_count = min(
                pass_count
                for pass_count, freq in pass_count_freq.items()
                if freq == max_freq
            )

        selected: list[dict[str, Any]] = []
        for rider_entries in by_rider.values():
            rider_entries.sort(key=self._entry_sort_key)
            if len(rider_entries) >= expected_pass_count:
                # Select the inferred lap crossing instead of always taking the last
                # crossing, which can inflate finish times when duplicate passes exist.
                selected.append(rider_entries[expected_pass_count - 1])

        return selected

    def _entry_sort_key(self, entry: dict[str, Any]) -> tuple[int, int]:
        raw = entry.get("_officialSegmentResult") or {}
        end_world_time = int(raw.get("endWorldTime", 0) or 0)
        duration_ms = int(entry.get("activityData", {}).get("durationInMilliseconds", 0) or 0)
        return (end_world_time, duration_ms)

    def _resolve_finish_time_ms(self, entry: dict[str, Any], subgroup_start_time: datetime | None) -> int:
        raw = entry.get("_officialSegmentResult") or {}
        duration_ms = int(entry.get("activityData", {}).get("durationInMilliseconds", 0) or 0)
        if not subgroup_start_time:
            return duration_ms

        start_dt = subgroup_start_time
        if start_dt.tzinfo is None:
            start_dt = start_dt.replace(tzinfo=timezone.utc)

        end_date_raw = str(raw.get("endDate") or "").strip()
        if end_date_raw:
            try:
                end_dt = datetime.fromisoformat(end_date_raw.replace("Z", "+00:00"))
            except ValueError:
                try:
                    end_dt = datetime.strptime(end_date_raw, "%Y-%m-%dT%H:%M:%S.%f%z")
                except ValueError:
                    end_dt = None
            if end_dt is not None:
                if end_dt.tzinfo is None:
                    end_dt = end_dt.replace(tzinfo=timezone.utc)
                elapsed = int((end_dt - start_dt).total_seconds() * 1000)
                if elapsed > 0:
                    return elapsed
        return duration_ms

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
