"""How riders actually did in league races, as numbers the predictor and the division agent can use.

Each rider's result in a race is turned into a **performance vELO**: the median pre-race
vELO of the riders who finished right around them. It answers "which vELO does this ride
look like?" from results alone, so it works for riders whose own vELO is missing or built
on too few Zwift races.

Point in time: only the vELO each rider had *before* the race is used
(`veloChanges.riders[zid].before`). Today's ratings are never read here.

Limits worth knowing: a performance vELO can only be as high or low as the riders in the
same division, so a rider far too strong (or weak) for the division is under- (or over-)
rated; and DNFs have no performance vELO.

Pure functions over race dicts; nothing here reads Firestore.
"""
from __future__ import annotations

import statistics
from datetime import datetime
from typing import Any, Iterable

from services.category_transfer_logic import is_category_transfer, is_real_finish
from services.results.constants import RACE_STATUS_DNF, RESULTS_PHASE_FINALIZED

# A rider is rated by the finishers this many places ahead and behind.
NEIGHBOURS = 3
# Fewer finishers with a pre-race vELO than this: the race gives no performance vELO.
MIN_ANCHORS = 6
MIN_NEIGHBOUR_ANCHORS = 2
DEFAULT_MIN_RACES = 3
# Races with a smaller field say little about being "at the back".
MIN_FIELD = 5


def _positive(value: Any) -> float | None:
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def is_finalized(race: dict) -> bool:
    return str(race.get("resultsPhase") or "").lower() == RESULTS_PHASE_FINALIZED


def velo_before(race: dict, zwift_id: str) -> float | None:
    """The rider's vELO going into this race, or None when it was not recorded."""
    riders = (race.get("veloChanges") or {}).get("riders") or {}
    return _positive((riders.get(str(zwift_id)) or {}).get("before"))


def _id_set(race: dict, field: str) -> set[str]:
    return {str(v) for v in (race.get(field) or [])}


def _is_dnf(row: dict, race: dict) -> bool:
    if not isinstance(row, dict) or is_category_transfer(row):
        return False
    zid = str(row.get("zwiftId") or "").strip()
    if not zid or zid in _id_set(race, "manualExclusions") or zid in _id_set(race, "manualDQs"):
        return False
    return str(row.get("raceStatus") or "").upper() == RACE_STATUS_DNF


def _finish_time(row: dict) -> int:
    try:
        return int(row.get("finishTime") or 0)
    except (TypeError, ValueError):
        return 0


def race_performances(race: dict, start: datetime | None = None) -> list[dict]:
    """One entry per rider who started this race: finishers (by finish time) and DNFs.

    `{zwiftId, raceId, start, division, rank, fieldSize, percentile, dnf, veloBefore,
    performanceVelo}`. `percentile` is 0 for the winner and 1 for last place and for
    DNFs. `performanceVelo` is None for DNFs, declassified riders, and when too few
    riders around the rider had a pre-race vELO.
    """
    out: list[dict] = []
    declassified = _id_set(race, "manualDeclassifications")
    race_id = str(race.get("id") or "")
    for division, rows in (race.get("results") or {}).items():
        rows = [r for r in rows or [] if isinstance(r, dict)]
        finishers = sorted(
            (r for r in rows if is_real_finish(r, race)),
            key=lambda r: (str(r.get("zwiftId")) in declassified, _finish_time(r)),
        )
        dnfs = [r for r in rows if _is_dnf(r, race)]
        n = len(finishers)
        velos = [None if str(r.get("zwiftId")) in declassified else velo_before(race, r.get("zwiftId"))
                 for r in finishers]
        enough = sum(1 for v in velos if v) >= MIN_ANCHORS
        for i, row in enumerate(finishers):
            zid = str(row.get("zwiftId"))
            perf = None
            if enough and zid not in declassified:
                near = [velos[j] for j in range(max(0, i - NEIGHBOURS), min(n, i + NEIGHBOURS + 1))
                        if j != i and velos[j]]
                if len(near) >= MIN_NEIGHBOUR_ANCHORS:
                    perf = round(statistics.median(near), 1)
            out.append({
                "zwiftId": zid, "raceId": race_id, "start": start, "division": str(division),
                "rank": i + 1, "fieldSize": n + len(dnfs),
                "percentile": round(i / (n - 1), 3) if n > 1 else 0.0,
                "dnf": False, "veloBefore": velo_before(race, zid), "performanceVelo": perf,
            })
        for row in dnfs:
            zid = str(row.get("zwiftId"))
            out.append({
                "zwiftId": zid, "raceId": race_id, "start": start, "division": str(division),
                "rank": None, "fieldSize": n + len(dnfs), "percentile": 1.0,
                "dnf": True, "veloBefore": velo_before(race, zid), "performanceVelo": None,
            })
    return out


def all_performances(races: Iterable[tuple[dict, datetime | None]]) -> list[dict]:
    """Performances from every finalized race, oldest race first. `races` is `(race, start)` pairs."""
    out: list[dict] = []
    ordered = sorted(((r, s) for r, s in races if is_finalized(r)),
                     key=lambda rs: (rs[1] is None, rs[1].timestamp() if rs[1] else 0.0))
    for race, start in ordered:
        out.extend(race_performances(race, start))
    return out


def by_rider(performances: Iterable[dict]) -> dict[str, list[dict]]:
    out: dict[str, list[dict]] = {}
    for p in performances:
        out.setdefault(p["zwiftId"], []).append(p)
    return out


def rider_summary(performances: list[dict], *, division: str | None = None, recent: int = 6) -> dict:
    """A rider's league season in numbers. With `division`, only races ridden in that division."""
    rows = [p for p in performances if division is None or p["division"] == division]
    rated = [p["performanceVelo"] for p in rows if p["performanceVelo"] is not None]
    return {
        "races": len(rows),
        "finishes": sum(1 for p in rows if not p["dnf"]),
        "dnfs": sum(1 for p in rows if p["dnf"]),
        "ratedRaces": len(rated),
        "performanceVelo": round(statistics.median(rated)) if rated else None,
        "medianPercentile": round(statistics.median(p["percentile"] for p in rows), 3) if rows else None,
        "recent": [
            {"raceId": p["raceId"], "division": p["division"], "rank": p["rank"], "fieldSize": p["fieldSize"],
             "percentile": p["percentile"], "dnf": p["dnf"], "performanceVelo": p["performanceVelo"]}
            for p in rows[-recent:]
        ],
        "divisions": sorted({p["division"] for p in rows}),
    }


def performance_ratings(performances: Iterable[dict], min_races: int = DEFAULT_MIN_RACES) -> dict[str, dict]:
    """`zwiftId -> summary` for riders with a performance vELO from at least `min_races` races."""
    out = {}
    for zid, rows in by_rider(performances).items():
        summary = rider_summary(rows)
        if summary["ratedRaces"] >= min_races:
            out[zid] = summary
    return out


def is_struggling(summary: dict | None, *, min_races: int, percentile: float, share: float) -> bool:
    """At least `share` of the rider's races (at least `min_races` of them) ended at or behind
    `percentile` of the field. DNFs count as last place."""
    if not summary or summary.get("races", 0) < min_races:
        return False
    rows = [r for r in summary.get("recent") or [] if (r.get("fieldSize") or 0) >= MIN_FIELD]
    if len(rows) < min_races:
        return False
    back = sum(1 for r in rows if r["dnf"] or r["percentile"] >= percentile)
    return back / len(rows) >= share
