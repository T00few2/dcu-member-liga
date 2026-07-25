"""
Season prestige standings: map finalized stage/event places to season points.
"""
from __future__ import annotations

import logging
from datetime import datetime
from typing import Any

from models import LeagueStandings
from services.results.constants import RESULTS_PHASE_FINALIZED
from services.results.league_engine import LeagueEngine
from services.results.season_points_defaults import (
    DEFAULT_SEASON_RANK_POINTS,
    points_for_place,
)
from utils.datetime_utils import normalize_dt

logger = logging.getLogger(__name__)

SEASON_CLASS_TOUR = "tour"
SEASON_CLASS_MONUMENT = "monument"
SEASON_CLASS_WT_CLASSIC = "wt_classic"


class SeasonEngine:
    def __init__(self, settings: dict[str, Any] | None) -> None:
        self.settings: dict[str, Any] = dict(settings or {})
        season_tables = self.settings.get("seasonRankPoints") or DEFAULT_SEASON_RANK_POINTS
        self.season_rank_points: dict[str, Any] = {
            key: (season_tables.get(key) or DEFAULT_SEASON_RANK_POINTS.get(key) or {})
            for key in ("tour_overall", "tour_stage", "monument", "wt_classic")
        }
        # 0 / missing => count all season lines
        raw_best = self.settings.get("seasonBestResultsCount")
        try:
            self.season_best_count: int | None = int(raw_best) if raw_best not in (None, "", 0) else None
        except (TypeError, ValueError):
            self.season_best_count = None
        if self.season_best_count is not None and self.season_best_count < 1:
            self.season_best_count = None

        # LeagueEngine used only for place ranking on stages (shared rank basis).
        self._league_engine = LeagueEngine(self.settings)

    def calculate_standings(
        self,
        stage_races: list[dict[str, Any]],
        races_by_id: dict[str, dict[str, Any]],
    ) -> LeagueStandings:
        """
        stage_races: event docs including id, seasonClass, resultsPhase, standings, bestRacesCount
        races_by_id: race docs keyed by id (must include id, stageRaceId, stageIndex, results, ...)
        """
        logger.info(
            "Calculating season standings (best %s lines)",
            self.season_best_count if self.season_best_count is not None else "all",
        )

        table: dict[str, dict[str, Any]] = {}  # category -> zwiftId -> entry

        for event in stage_races:
            event_id = str(event.get("id") or "")
            if not event_id:
                continue
            season_class = str(event.get("seasonClass") or "").strip().lower()
            event_finalized = str(event.get("resultsPhase") or "").lower() == RESULTS_PHASE_FINALIZED

            stages = [
                races_by_id[rid]
                for rid in sorted(
                    (
                        rid
                        for rid, race in races_by_id.items()
                        if str(race.get("stageRaceId") or "") == event_id
                    ),
                    key=lambda rid: (
                        int(races_by_id[rid].get("stageIndex") or 0),
                        str(races_by_id[rid].get("date") or ""),
                        rid,
                    ),
                )
            ]

            if season_class == SEASON_CLASS_TOUR:
                for stage in stages:
                    if str(stage.get("resultsPhase") or "").lower() != RESULTS_PHASE_FINALIZED:
                        continue
                    self._add_stage_tour_points(table, stage, event_id)

            if event_finalized:
                scheme_key = {
                    SEASON_CLASS_TOUR: "tour_overall",
                    SEASON_CLASS_MONUMENT: "monument",
                    SEASON_CLASS_WT_CLASSIC: "wt_classic",
                }.get(season_class)
                if scheme_key:
                    self._add_event_gc_points(table, event, event_id, scheme_key)

        return self._finalize_table(table)

    def _add_stage_tour_points(
        self,
        table: dict[str, dict[str, Any]],
        stage: dict[str, Any],
        event_id: str,
    ) -> None:
        race_id = str(stage.get("id") or "")
        race_type = str(stage.get("type") or "scratch")
        race_date = self._race_dt(stage)
        manual_dqs = set(str(x) for x in (stage.get("manualDQs") or []))
        manual_declass = set(str(x) for x in (stage.get("manualDeclassifications") or []))
        manual_excl = set(str(x) for x in (stage.get("manualExclusions") or []))
        scheme = self.season_rank_points.get("tour_stage") or {}

        for category, riders in (stage.get("results") or {}).items():
            if not isinstance(riders, list):
                continue
            places = self._league_engine.get_race_places(
                riders,
                stage,
                category,
                race_type,
                manual_dqs,
                manual_declass,
                manual_excl,
            )
            name_by_id = {str(r.get("zwiftId")): str(r.get("name") or "") for r in riders}
            for zid, place in places.items():
                pts = points_for_place(scheme, place)
                if pts <= 0:
                    continue
                self._credit(
                    table,
                    category=category,
                    zwift_id=zid,
                    name=name_by_id.get(zid, ""),
                    points=pts,
                    race_id=race_id,
                    stage_race_id=event_id,
                    source="stage",
                    race_date=race_date,
                )

    def _add_event_gc_points(
        self,
        table: dict[str, dict[str, Any]],
        event: dict[str, Any],
        event_id: str,
        scheme_key: str,
    ) -> None:
        scheme = self.season_rank_points.get(scheme_key) or {}
        standings = event.get("standings") or {}
        if not isinstance(standings, dict):
            return
        event_date = self._race_dt(event)

        for category, entries in standings.items():
            if not isinstance(entries, list):
                continue
            for place_idx, entry in enumerate(entries):
                if not isinstance(entry, dict):
                    continue
                zid = str(entry.get("zwiftId") or "").strip()
                if not zid:
                    continue
                place = place_idx + 1
                pts = points_for_place(scheme, place)
                if pts <= 0:
                    continue
                self._credit(
                    table,
                    category=category,
                    zwift_id=zid,
                    name=str(entry.get("name") or ""),
                    points=pts,
                    race_id=None,
                    stage_race_id=event_id,
                    source="gc",
                    race_date=event_date,
                )

    def _credit(
        self,
        table: dict[str, dict[str, Any]],
        *,
        category: str,
        zwift_id: str,
        name: str,
        points: int,
        race_id: str | None,
        stage_race_id: str,
        source: str,
        race_date: datetime | None,
    ) -> None:
        if category not in table:
            table[category] = {}
        if zwift_id not in table[category]:
            table[category][zwift_id] = {
                "zwiftId": zwift_id,
                "name": name,
                "totalPoints": 0,
                "raceCount": 0,
                "results": [],
                "lastRacePoints": 0,
                "lastRaceDate": None,
            }
        entry = table[category][zwift_id]
        if name and not entry.get("name"):
            entry["name"] = name
        entry["results"].append(
            {
                "raceId": race_id,
                "stageRaceId": stage_race_id,
                "source": source,
                "points": points,
            }
        )
        entry["raceCount"] = len(entry["results"])
        if race_date:
            last = entry.get("lastRaceDate")
            if not last or race_date >= last:
                entry["lastRaceDate"] = race_date
                entry["lastRacePoints"] = points

    def _finalize_table(self, table: dict[str, dict[str, Any]]) -> LeagueStandings:
        final: LeagueStandings = {}
        for category, riders_dict in table.items():
            riders = list(riders_dict.values())
            for rider in riders:
                results_list = list(rider.get("results") or [])
                results_list.sort(key=lambda x: int(x.get("points") or 0), reverse=True)
                if self.season_best_count is not None:
                    best = results_list[: self.season_best_count]
                else:
                    best = results_list
                rider["totalPoints"] = sum(int(r.get("points") or 0) for r in best)
                rider["results"] = results_list
            riders.sort(
                key=lambda x: (int(x.get("totalPoints") or 0), int(x.get("lastRacePoints") or 0)),
                reverse=True,
            )
            final[category] = riders  # type: ignore[assignment]
        return final

    @staticmethod
    def _race_dt(data: dict[str, Any]) -> datetime | None:
        raw = data.get("date") or data.get("startTime") or data.get("finalizedAt")
        if not raw:
            return None
        try:
            return normalize_dt(raw)
        except Exception:
            return None


def season_mode_enabled(settings: dict[str, Any] | None, stage_race_count: int) -> bool:
    """Season path when prestige tables are configured or events exist."""
    settings = settings or {}
    if stage_race_count > 0:
        return True
    srp = settings.get("seasonRankPoints")
    return isinstance(srp, dict) and bool(srp)
