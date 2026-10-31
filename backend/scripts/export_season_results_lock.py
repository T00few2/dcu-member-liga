"""Write the season-results fixture from the current Firestore standings.

Read-only. Drops rider names. The test loads the fixture and does not call Firestore.

    conda run -n py311 python backend/scripts/export_season_results_lock.py
"""
from __future__ import annotations

import copy
import json
import os
import sys

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

import firebase_admin
from firebase_admin import credentials, firestore

from services.category_config import CategoryConfigResolver
from services.results.classification_standings import (
    apply_classification_standings,
    load_profile_catalogs,
)
from services.results.race_scorer import RaceScorer
from services.results.season_engine import SeasonEngine, season_mode_enabled
from services.results.stage_race_ops import load_races_by_id, load_stage_races

OUT = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "tests", "fixtures", "season_results_lock.json")
)


def _init_firebase():
    if firebase_admin._apps:
        return
    gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    local_sa = os.path.join(os.path.dirname(__file__), "..", "serviceAccountKey.json")
    if gac and os.path.exists(gac):
        firebase_admin.initialize_app(credentials.Certificate(gac))
    elif os.path.exists(local_sa):
        firebase_admin.initialize_app(credentials.Certificate(local_sa))
    else:
        firebase_admin.initialize_app()


def _int(value) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


def _slim_sprint_data(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key, entry in raw.items():
        if not isinstance(entry, dict):
            continue
        out[str(key)] = {
            "time": _int(entry.get("time")),
            "worldTime": _int(entry.get("worldTime")),
        }
    return out


def _slim_details(raw) -> dict:
    if not isinstance(raw, dict):
        return {}
    return {str(key): _int(value) for key, value in raw.items()}


def _slim_rider(rider: dict) -> dict:
    return {
        "zwiftId": str(rider.get("zwiftId") or ""),
        "finishTime": _int(rider.get("finishTime")),
        "finishPoints": _int(rider.get("finishPoints")),
        "sprintPoints": _int(rider.get("sprintPoints")),
        "raceStatus": rider.get("raceStatus") or "",
        "categoryTransfer": rider.get("categoryTransfer") is True,
        "sprintData": _slim_sprint_data(rider.get("sprintData")),
        "sprintDetails": _slim_details(rider.get("sprintDetails")),
    }


def _slim_sprints(raw) -> list:
    rows = []
    for sprint in raw or []:
        if not isinstance(sprint, dict):
            continue
        row = {
            "id": sprint.get("id"),
            "count": sprint.get("count"),
            "key": sprint.get("key"),
            "name": sprint.get("name"),
            "direction": sprint.get("direction"),
            "lap": sprint.get("lap"),
        }
        if sprint.get("type") in {"sprint", "split"}:
            row["type"] = sprint.get("type")
        if sprint.get("marker") in {"sprint", "climb", "segment"}:
            row["marker"] = sprint.get("marker")
        rows.append(row)
    return rows


def _slim_race(race: dict) -> dict:
    results = {}
    for category, riders in (race.get("results") or {}).items():
        if not isinstance(riders, list):
            continue
        results[str(category)] = [
            _slim_rider(rider) for rider in riders if isinstance(rider, dict)
        ]
    groups = []
    for group in race.get("raceGroups") or []:
        if not isinstance(group, dict):
            continue
        groups.append({
            "sprints": _slim_sprints(group.get("sprints")),
            "segmentType": group.get("segmentType"),
            "categories": [
                {
                    "category": cat.get("category"),
                    "sprints": _slim_sprints(cat.get("sprints")),
                    "segmentType": cat.get("segmentType"),
                }
                for cat in (group.get("categories") or [])
                if isinstance(cat, dict)
            ],
        })
    return {
        "id": race.get("id"),
        "resultsPhase": race.get("resultsPhase"),
        "stageRaceId": race.get("stageRaceId"),
        "eventMode": race.get("eventMode"),
        "segmentType": race.get("segmentType"),
        "sprints": _slim_sprints(race.get("sprints")),
        "manualDQs": [str(value) for value in (race.get("manualDQs") or [])],
        "manualDeclassifications": [str(value) for value in (race.get("manualDeclassifications") or [])],
        "manualExclusions": [str(value) for value in (race.get("manualExclusions") or [])],
        "singleModeCategories": [
            {
                "category": cat.get("category"),
                "sprints": _slim_sprints(cat.get("sprints")),
                "segmentType": cat.get("segmentType"),
            }
            for cat in (race.get("singleModeCategories") or [])
            if isinstance(cat, dict)
        ],
        "eventConfiguration": [
            {
                "customCategory": cfg.get("customCategory"),
                "sprints": _slim_sprints(cfg.get("sprints")),
                "segmentType": cfg.get("segmentType"),
            }
            for cfg in (race.get("eventConfiguration") or [])
            if isinstance(cfg, dict)
        ],
        "raceGroups": groups,
        "results": results,
    }


def _slim_event(event: dict) -> dict:
    standings = {}
    for category, entries in (event.get("standings") or {}).items():
        if not isinstance(entries, list):
            continue
        standings[str(category)] = [
            {
                "zwiftId": str(entry.get("zwiftId") or ""),
                "totalPoints": _int(entry.get("totalPoints")),
            }
            for entry in entries
            if isinstance(entry, dict)
        ]
    return {
        "id": event.get("id"),
        "seasonClass": event.get("seasonClass"),
        "resultsPhase": event.get("resultsPhase"),
        "bestRacesCount": event.get("bestRacesCount"),
        "standings": standings,
    }


def _slim_catalog(segments: list) -> list:
    rows = []
    for seg in segments:
        if not isinstance(seg, dict):
            continue
        rows.append({
            "name": seg.get("name"),
            "type": seg.get("type"),
            "direction": seg.get("direction"),
        })
    return rows


def _points_map(standings: dict) -> dict:
    out = {}
    for category, riders in (standings or {}).items():
        if not isinstance(riders, list):
            continue
        out[str(category)] = {
            str(rider.get("zwiftId")): {
                "totalPoints": _int(rider.get("totalPoints")),
                "sprintPoints": _int(rider.get("sprintPoints")),
                "komPoints": _int(rider.get("komPoints")),
            }
            for rider in riders
            if isinstance(rider, dict) and rider.get("zwiftId")
        }
    return out


def _score_races(races: list, finish_points: list, sprint_points: list) -> list:
    scorer = RaceScorer(finish_points, sprint_points)
    checked = []
    for race in races:
        if not race.get("results"):
            continue
        categories = {}
        for category, riders in race["results"].items():
            config = CategoryConfigResolver.get_race_config(race, category)
            updated = scorer.calculate_results(copy.deepcopy(riders), config, segment_efforts_map=None)
            categories[category] = {
                str(rider.get("zwiftId")): {
                    "finishPoints": _int(rider.get("finishPoints")),
                    "sprintPoints": _int(rider.get("sprintPoints")),
                }
                for rider in updated
            }
        checked.append({"id": race.get("id"), "categories": categories})
    return checked


def main() -> None:
    _init_firebase()
    db = firestore.client()
    settings_doc = db.collection("league").document("settings").get()
    settings = settings_doc.to_dict() if settings_doc.exists else {}
    stored_doc = db.collection("league").document("standings").get()
    stored = (stored_doc.to_dict() or {}).get("standings") if stored_doc.exists else {}
    races_by_id = load_races_by_id(db)
    stage_races = load_stage_races(db)
    catalogs = [_slim_catalog(rows) for rows in load_profile_catalogs(db)]
    races = [_slim_race(race) for race in races_by_id.values()]
    events = [_slim_event(event) for event in stage_races]
    kept_settings = {
        "finishPoints": list(settings.get("finishPoints") or []),
        "sprintPoints": list(settings.get("sprintPoints") or []),
        "seasonRankPoints": settings.get("seasonRankPoints") or {},
        "seasonBestResultsCount": settings.get("seasonBestResultsCount"),
    }
    races_for_engine = {race["id"]: race for race in races}
    if season_mode_enabled(kept_settings, len(events)):
        computed = SeasonEngine(kept_settings).calculate_standings(events, races_for_engine)
        season_mode = True
    else:
        computed = {}
        season_mode = False
    computed = apply_classification_standings(
        computed,
        races_for_engine,
        season_mode=season_mode,
        stage_race_ids={str(event.get("id") or "") for event in events},
        catalogs=catalogs,
    )
    expected = _points_map(stored)
    fresh = _points_map(computed)
    mismatches = []
    for category in sorted(set(expected) | set(fresh)):
        left = expected.get(category) or {}
        right = fresh.get(category) or {}
        for zwift_id in sorted(set(left) | set(right)):
            if left.get(zwift_id) != right.get(zwift_id):
                mismatches.append({
                    "category": category,
                    "zwiftId": zwift_id,
                    "stored": left.get(zwift_id),
                    "recomputed": right.get(zwift_id),
                })
    race_points = _score_races(races, kept_settings["finishPoints"], kept_settings["sprintPoints"])
    race_mismatches = []
    scored_by_id = {row["id"]: row["categories"] for row in race_points}
    for race in races:
        scored = scored_by_id.get(race.get("id")) or {}
        for category, riders in race["results"].items():
            got = scored.get(category) or {}
            for rider in riders:
                zid = str(rider.get("zwiftId") or "")
                stored_points = {
                    "finishPoints": _int(rider.get("finishPoints")),
                    "sprintPoints": _int(rider.get("sprintPoints")),
                }
                if got.get(zid) != stored_points:
                    race_mismatches.append({
                        "race": race.get("id"),
                        "category": category,
                        "zwiftId": zid,
                        "stored": stored_points,
                        "recomputed": got.get(zid),
                    })
    payload = {
        "settings": kept_settings,
        "events": events,
        "races": races,
        "catalogs": catalogs,
        "standings": expected,
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, separators=(",", ":"))
    print(f"wrote {OUT}")
    print(f"races {len(races)} events {len(events)} catalogs {len(catalogs)}")
    print(f"standings mismatches {len(mismatches)} race mismatches {len(race_mismatches)}")
    for row in mismatches[:12]:
        print("standings", row)
    for row in race_mismatches[:12]:
        print("race", row)


if __name__ == "__main__":
    main()
