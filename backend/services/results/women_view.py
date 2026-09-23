"""Rescore stored results as if only women had raced.

Stored race documents and league/standings are left unchanged.
A rider is included only when her Zwift profile has male == False.
"""
from __future__ import annotations

import copy
from datetime import datetime
from typing import Any

from services.category_config import CategoryConfigResolver
from services.results.classification_standings import (
    apply_classification_standings,
    load_profile_catalogs,
)
from services.results.league_engine import LeagueEngine
from services.results.race_scorer import RaceScorer
from services.results.season_engine import SeasonEngine, season_mode_enabled
from services.results.stage_race_ops import (
    calculate_event_gc,
    load_races_by_id,
    load_stage_races,
    stages_for_event,
)


def women_ids_from_user_docs(docs: list[dict[str, Any]]) -> set[str]:
    """Zwift ids whose stored profile says male is false."""
    ids: set[str] = set()
    for data in docs:
        if not isinstance(data, dict):
            continue
        profile = data.get("zwiftProfile")
        if not isinstance(profile, dict) or profile.get("male") is not False:
            continue
        zwift_id = str(data.get("zwiftId") or "").strip()
        if zwift_id:
            ids.add(zwift_id)
    return ids


def rescore_race_for_women(
    race: dict[str, Any],
    women_ids: set[str],
    scorer: RaceScorer,
) -> dict[str, Any]:
    """Copy one race and award finish and banner points inside the women's field."""
    copied = copy.deepcopy(race)
    results = copied.get("results") or {}
    if not isinstance(results, dict):
        copied["results"] = {}
        return copied
    updated: dict[str, list] = {}
    for category, riders in results.items():
        if not isinstance(riders, list):
            updated[str(category)] = []
            continue
        women = [
            rider
            for rider in riders
            if isinstance(rider, dict) and str(rider.get("zwiftId") or "") in women_ids
        ]
        if not women:
            updated[str(category)] = []
            continue
        config = CategoryConfigResolver.get_race_config(copied, str(category))
        updated[str(category)] = scorer.calculate_results(women, config)
    copied["results"] = updated
    return copied


def build_women_view(
    races_by_id: dict[str, dict[str, Any]],
    stage_races: list[dict[str, Any]],
    settings: dict[str, Any] | None,
    women_ids: set[str],
    catalogs: list | None = None,
) -> dict[str, Any]:
    """Standings, per-race results, and event GC for the women's field."""
    settings = dict(settings or {})
    scorer = RaceScorer(
        finish_points_scheme=list(settings.get("finishPoints") or []),
        sprint_points_scheme=list(settings.get("sprintPoints") or []),
    )
    rescored = {
        race_id: rescore_race_for_women(race, women_ids, scorer)
        for race_id, race in races_by_id.items()
        if isinstance(race, dict)
    }
    events = [copy.deepcopy(event) for event in stage_races if isinstance(event, dict)]
    for event in events:
        event_id = str(event.get("id") or "")
        if not event_id:
            continue
        stages = stages_for_event(rescored, event_id)
        best = int(event.get("bestRacesCount") or 1)
        event["standings"] = calculate_event_gc(settings, stages, best)

    season_mode = season_mode_enabled(settings, len(events))
    if season_mode:
        standings = SeasonEngine(settings).calculate_standings(events, rescored)
    else:
        standings = LeagueEngine(settings).calculate_standings(list(rescored.values()))

    standings = apply_classification_standings(
        standings,
        rescored,
        season_mode=season_mode,
        stage_race_ids={str(event.get("id") or "") for event in events},
        catalogs=list(catalogs or []),
    )
    return {
        "standings": standings,
        "races": [
            {"id": race_id, "results": race.get("results") or {}}
            for race_id, race in rescored.items()
        ],
        "events": [
            {"id": str(event.get("id") or ""), "standings": event.get("standings") or {}}
            for event in events
            if event.get("id")
        ],
    }


def json_ready(value: Any) -> Any:
    """Make standings safe for jsonify (datetimes from the season engine)."""
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): json_ready(item) for key, item in value.items()}
    if isinstance(value, list):
        return [json_ready(item) for item in value]
    return value


def load_women_ids(db: Any) -> set[str]:
    docs = []
    for doc in db.collection("users").stream():
        data = doc.to_dict() or {}
        docs.append(data)
    return women_ids_from_user_docs(docs)


def load_women_view(db: Any) -> dict[str, Any]:
    settings_doc = db.collection("league").document("settings").get()
    settings = settings_doc.to_dict() if settings_doc.exists else {}
    races_by_id = load_races_by_id(db)
    stage_races = load_stage_races(db)
    try:
        catalogs = load_profile_catalogs(db)
    except Exception:
        catalogs = []
    return build_women_view(
        races_by_id,
        stage_races,
        settings,
        load_women_ids(db),
        catalogs,
    )
