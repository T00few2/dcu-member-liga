"""
Event (stage race) GC + finalize helpers.

Event GC reuses LeagueEngine with per-event bestRacesCount.
Season totals are owned by SeasonEngine / ResultsProcessor.
"""
from __future__ import annotations

import logging
from typing import Any

from firebase_admin import firestore

from models import LeagueStandings
from services.results.constants import RESULTS_PHASE_FINALIZED, RESULTS_PHASE_PROVISIONAL
from services.results.league_engine import LeagueEngine
from services.schema_validation import with_schema_version

logger = logging.getLogger(__name__)

ONE_DAY_CLASSES = frozenset({"monument", "wt_classic"})


def calculate_event_gc(
    settings: dict[str, Any] | None,
    stages: list[dict[str, Any]],
    best_races_count: int,
) -> LeagueStandings:
    """GC for one event: LeagueEngine over that event's stages only."""
    engine_settings = dict(settings or {})
    engine_settings["bestRacesCount"] = max(1, int(best_races_count or 1))
    engine = LeagueEngine(engine_settings)
    stages_with_results = [s for s in stages if s.get("results")]
    return engine.calculate_standings(stages_with_results)


def stages_for_event(
    races_by_id: dict[str, dict[str, Any]],
    event_id: str,
) -> list[dict[str, Any]]:
    stages = [
        race
        for race in races_by_id.values()
        if str(race.get("stageRaceId") or "") == str(event_id)
    ]
    stages.sort(
        key=lambda r: (
            int(r.get("stageIndex") or 0),
            str(r.get("date") or ""),
            str(r.get("id") or ""),
        )
    )
    return stages


def all_stages_finalized(stages: list[dict[str, Any]]) -> bool:
    if not stages:
        return False
    return all(
        str(s.get("resultsPhase") or "").lower() == RESULTS_PHASE_FINALIZED
        for s in stages
    )


def load_races_by_id(db: Any, override_race_id: str | None = None,
                     override_race_data: dict[str, Any] | None = None) -> dict[str, dict[str, Any]]:
    races_by_id: dict[str, dict[str, Any]] = {}
    for doc in db.collection("races").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        races_by_id[doc.id] = data
    if override_race_id and override_race_data is not None:
        merged = dict(override_race_data)
        merged["id"] = override_race_id
        races_by_id[override_race_id] = merged
    return races_by_id


def load_stage_races(db: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for doc in db.collection("stageRaces").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        events.append(data)
    return events


def recompute_and_save_event_gc(
    db: Any,
    event: dict[str, Any],
    races_by_id: dict[str, dict[str, Any]],
    settings: dict[str, Any] | None,
) -> LeagueStandings:
    event_id = str(event.get("id") or "")
    stages = stages_for_event(races_by_id, event_id)
    best = int(event.get("bestRacesCount") or 1)
    standings = calculate_event_gc(settings, stages, best)
    payload = with_schema_version({
        "standings": standings,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    })
    db.collection("stageRaces").document(event_id).set(payload, merge=True)
    event["standings"] = standings
    return standings


def maybe_auto_finalize_one_day(
    db: Any,
    event: dict[str, Any],
    stages: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Monument / WT classic: when the single stage is finalized, finalize the event.
    Returns the (possibly updated) event dict.
    """
    season_class = str(event.get("seasonClass") or "").strip().lower()
    if season_class not in ONE_DAY_CLASSES:
        return event
    if len(stages) != 1:
        return event
    if not all_stages_finalized(stages):
        return event
    if str(event.get("resultsPhase") or "").lower() == RESULTS_PHASE_FINALIZED:
        return event

    event_id = str(event.get("id") or "")
    update = {
        "resultsPhase": RESULTS_PHASE_FINALIZED,
        "finalizedAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    db.collection("stageRaces").document(event_id).set(update, merge=True)
    event = {**event, "resultsPhase": RESULTS_PHASE_FINALIZED}
    logger.info("Auto-finalized one-day event %s (%s)", event_id, season_class)
    return event


def finalize_event(
    db: Any,
    event: dict[str, Any],
    races_by_id: dict[str, dict[str, Any]],
    settings: dict[str, Any] | None,
) -> dict[str, Any]:
    event_id = str(event.get("id") or "")
    stages = stages_for_event(races_by_id, event_id)
    if not stages:
        raise ValueError("Event has no stages")
    if not all_stages_finalized(stages):
        raise ValueError("All stages must be finalized before finalizing the event")

    recompute_and_save_event_gc(db, event, races_by_id, settings)
    update = {
        "resultsPhase": RESULTS_PHASE_FINALIZED,
        "finalizedAt": firestore.SERVER_TIMESTAMP,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    db.collection("stageRaces").document(event_id).set(update, merge=True)
    event = {**event, "resultsPhase": RESULTS_PHASE_FINALIZED}
    return event


def unfinalize_event(db: Any, event: dict[str, Any]) -> dict[str, Any]:
    event_id = str(event.get("id") or "")
    update = {
        "resultsPhase": RESULTS_PHASE_PROVISIONAL,
        "finalizedAt": None,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    db.collection("stageRaces").document(event_id).set(update, merge=True)
    return {**event, "resultsPhase": RESULTS_PHASE_PROVISIONAL, "finalizedAt": None}


def unfinalize_stage(
    db: Any,
    race_id: str,
    race_data: dict[str, Any],
    event: dict[str, Any] | None,
) -> dict[str, Any]:
    """
    Set stage to provisional. Blocked if parent multi-stage event is finalized.
    One-day events cascade: un-finalize event together with the stage.
    """
    if event:
        season_class = str(event.get("seasonClass") or "").strip().lower()
        event_finalized = str(event.get("resultsPhase") or "").lower() == RESULTS_PHASE_FINALIZED
        if event_finalized and season_class not in ONE_DAY_CLASSES:
            raise ValueError(
                "Un-finalize the parent event before un-finalizing a stage"
            )
        if event_finalized and season_class in ONE_DAY_CLASSES:
            unfinalize_event(db, event)

    db.collection("races").document(race_id).set(
        {
            "resultsPhase": RESULTS_PHASE_PROVISIONAL,
            "finalizedAt": None,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )
    return {
        **race_data,
        "resultsPhase": RESULTS_PHASE_PROVISIONAL,
        "finalizedAt": None,
    }
