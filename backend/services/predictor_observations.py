"""Point-in-time training data from league races.

One observation per rider per finalized race: how the rider did (the performance vELO
from `league_performance`) next to **what was known about the rider before the race
started**. Stored per race in `predictor_observations/{raceId}`.

The rule, checked by tests: nothing in an observation may come from after the race start.
- Strava power: rides that started before the race (`strava_efforts.curve_as_of`), and only
  when the stored ride list is complete for the whole window. A rider with Strava whose
  history does not reach back far enough yet is `stravaPending`; the race is rebuilt later.
- Weight and Zwift power: the latest `predictor_snapshots` entry taken before the race.
  Without one (races ridden before snapshots existed) the weight is today's value, marked
  `weightSource: "current"`, and Zwift power is left out. Today's Zwift power is never used.
- vELO: the rider's vELO going into the race, as recorded with the race results.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services import league_performance as lp
from services import predictor_snapshots as snapshots_mod
from services import strava_efforts
from services import velo_predictor as vp

logger = logging.getLogger(__name__)

COLLECTION = "predictor_observations"
# A race with riders still waiting for Strava history is rebuilt at most this often.
REBUILD_AFTER_HOURS = 24
CURVE_KEYS = ("curve", "curveIndoor", "curveOutdoor", "curveOutdoorRace")
COUNT_KEYS = ("activityCount", "indoorCount", "outdoorCount", "outdoorRaceCount")


def _compact(entry: dict) -> dict:
    """Only the durations the predictor uses, to keep a race document small."""
    wanted = set(vp.STRAVA_CURVE_KEYS.values())
    out: dict = {k: {d: w for d, w in (entry.get(k) or {}).items() if d in wanted} for k in CURVE_KEYS}
    out.update({k: entry.get(k, 0) for k in COUNT_KEYS})
    out["split"] = True
    return out


def build_rider(
    performance: dict,
    row: dict | None,
    efforts_doc: dict | None,
    snapshot: dict | None,
) -> dict:
    """The observation for one rider in one race. `snapshot` must be from before the race."""
    start: datetime = performance["start"]
    out = {
        "zwiftId": performance["zwiftId"],
        "division": performance["division"],
        "rank": performance["rank"],
        "fieldSize": performance["fieldSize"],
        "percentile": performance["percentile"],
        "performanceVelo": performance["performanceVelo"],
        "veloBefore": performance["veloBefore"],
        "weightKg": None,
        "weightSource": None,
        "zwift": None,
        "strava": {},
        "stravaPending": False,
    }
    snap_kg = (vp.to_float((snapshot or {}).get("weightInGrams")) or 0.0) / 1000
    now_kg = (vp.to_float((row or {}).get("weightInGrams")) or 0.0) / 1000
    if snap_kg > 0:
        out["weightKg"], out["weightSource"] = round(snap_kg, 2), "snapshot"
        out["zwift"] = {**vp.inputs_from_participant(snapshot), "racingScore": 0.0}
    elif now_kg > 0:
        out["weightKg"], out["weightSource"] = round(now_kg, 2), "current"
    for days in vp.STRAVA_WINDOWS:
        if strava_efforts.covers(efforts_doc, start, days):
            entry = strava_efforts.curve_as_of((efforts_doc or {}).get("rides"), start, days)
            if entry["curve"]:
                out["strava"][str(days)] = _compact(entry)
        elif (row or {}).get("hasStrava"):
            out["stravaPending"] = True
    return out


def build_race(
    race: dict,
    start: datetime,
    participants_by_id: dict[str, dict],
    read_efforts: Callable[[str], dict | None],
    snapshots: list[dict],
    now: datetime,
) -> dict:
    """The stored document for one finalized race."""
    riders = {}
    for perf in lp.race_performances(race, start):
        if perf["performanceVelo"] is None:
            continue
        row = participants_by_id.get(perf["zwiftId"])
        doc_id = (row or {}).get("userDocId")
        riders[perf["zwiftId"]] = build_rider(
            perf, row, read_efforts(str(doc_id)) if doc_id else None,
            snapshots_mod.latest_before(snapshots, perf["zwiftId"], start),
        )
    return {
        "raceId": str(race.get("id") or ""),
        "raceStart": start.isoformat(),
        "builtAt": now.isoformat(),
        "pending": sum(1 for r in riders.values() if r["stravaPending"]),
        "riders": riders,
    }


def read_all(db: Any) -> list[dict]:
    """Every stored observation as a flat list, oldest race first, each with `raceId` and `start`."""
    docs = [snap.to_dict() or {} for snap in db.collection(COLLECTION).stream()]
    out: list[dict] = []
    for doc in sorted(docs, key=lambda d: str(d.get("raceStart") or "")):
        for rider in (doc.get("riders") or {}).values():
            if isinstance(rider, dict):
                out.append({**rider, "raceId": doc.get("raceId"), "start": doc.get("raceStart")})
    return out


def progress(db: Any, races: list[tuple[dict, datetime | None]], now: datetime | None = None) -> dict:
    """How far the league data has come, for the admin page: finalized races, races with
    observations, observations stored, those with Strava power known before the race, and
    riders with Strava still waiting for their ride history."""
    now = now or datetime.now(timezone.utc)
    docs = [snap.to_dict() or {} for snap in db.collection(COLLECTION).stream()]
    riders = [r for d in docs for r in (d.get("riders") or {}).values() if isinstance(r, dict)]
    waiting = {r.get("zwiftId") for r in riders if r.get("stravaPending")}
    return {
        "racesFinalized": sum(1 for race, start in races
                              if start is not None and start < now and lp.is_finalized(race)),
        "racesBuilt": len(docs),
        "observations": len(riders),
        "withStrava": sum(1 for r in riders if r.get("strava")),
        "weightBeforeRace": sum(1 for r in riders if r.get("strava") and r.get("weightSource") == "snapshot"),
        "ridersWaitingForStrava": len(waiting),
    }


def next_race(
    db: Any, races: list[tuple[dict, datetime | None]], now: datetime,
) -> tuple[dict, datetime] | None:
    """The next race to build: a finalized one without observations, else one whose riders
    were still waiting for Strava history a day ago. None when all are done."""
    collection = db.collection(COLLECTION)
    # Only the two small fields are needed here; the rider maps are large.
    query = collection.select(["builtAt", "pending"]) if hasattr(collection, "select") else collection
    existing = {str(snap.id): (snap.to_dict() or {}) for snap in query.stream()}
    todo = None
    for race, start in races:
        if start is None or start >= now or not lp.is_finalized(race):
            continue
        have = existing.get(str(race.get("id")))
        if have is None:
            todo = (race, start)
            break
        built = strava_efforts.parse_iso(have.get("builtAt"))
        if have.get("pending") and (built is None or now - built >= timedelta(hours=REBUILD_AFTER_HOURS)):
            todo = todo or (race, start)
    return todo


def refresh_next(
    db: Any,
    races: list[tuple[dict, datetime | None]],
    participants: list[dict] | Callable[[], list[dict]],
    *,
    now: datetime | None = None,
) -> str | None:
    """Build and store the observations of one race (see `next_race`). Returns the race id,
    or None when nothing is due. `participants` may be a function, called only when a race
    is built, so an idle call reads no rider documents."""
    now = now or datetime.now(timezone.utc)
    todo = next_race(db, races, now)
    if todo is None:
        return None
    race, start = todo
    if callable(participants):
        participants = participants()
    cache: dict[str, dict] = {}

    def read_efforts(doc_id: str) -> dict:
        if doc_id not in cache:
            cache[doc_id] = strava_efforts.read(db, doc_id)
        return cache[doc_id]

    by_id = {str(p.get("zwiftId")): p for p in participants if p.get("zwiftId")}
    doc = build_race(race, start, by_id, read_efforts, snapshots_mod.read_all(db), now)
    db.collection(COLLECTION).document(str(race.get("id"))).set(doc)
    return str(race.get("id"))
