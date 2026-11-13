"""Best efforts per Strava ride, kept so a power curve can be rebuilt for any past date.

`strava_power_curves` only holds curves that end "now". To pair a league race with the
power a rider had shown **before that race**, the best efforts of every ride are kept
here, one document per rider (`strava_activity_efforts/{userDocId}`):

    {userDocId, historyFrom, updatedAt,
     rides: {activityId: {startDate, indoor, race, efforts: {w5, ..., w1200}}}}

`curve_as_of(rides, end, days)` then merges the rides that started in
`[end - days, end)`. A ride that started at or after `end` is never used.

`historyFrom` is the earliest date the ride list is complete from; `covers` says whether
a window lies fully inside it, so a half-filled window is never mistaken for a weak rider.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

COLLECTION = "strava_activity_efforts"
# Bumped when the stored shape changes; curve entries carry it so older ones are refetched.
VERSION = 2


def parse_iso(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if not isinstance(value, str) or not value:
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def read(db: Any, user_doc_id: str) -> dict:
    """The rider's stored document (`{}` when there is none)."""
    snap = db.collection(COLLECTION).document(str(user_doc_id)).get()
    if not getattr(snap, "exists", False):
        return {}
    data = snap.to_dict() or {}
    return data if isinstance(data.get("rides"), dict) else {}


def read_all(db: Any) -> dict[str, dict]:
    """Every rider's document in one query, keyed by userDocId."""
    out: dict[str, dict] = {}
    for snap in db.collection(COLLECTION).stream():
        data = snap.to_dict() or {}
        if isinstance(data.get("rides"), dict):
            out[str(data.get("userDocId") or getattr(snap, "id", ""))] = data
    return out


def write(db: Any, user_doc_id: str, rides: dict[str, dict], history_from: datetime, now: datetime) -> None:
    db.collection(COLLECTION).document(str(user_doc_id)).set({
        "userDocId": str(user_doc_id),
        "rides": rides,
        "historyFrom": history_from.isoformat(),
        "updatedAt": now.isoformat(),
        "version": VERSION,
    })


def merge_curves(*curves: dict) -> dict[str, float]:
    """Per-duration best of several curves."""
    out: dict[str, float] = {}
    for c in curves:
        for k, v in (c or {}).items():
            if v is not None and float(v) > out.get(k, 0.0):
                out[k] = float(v)
    return out


def covers(doc: dict | None, end: datetime, days: int) -> bool:
    """True when the stored ride list is complete for the whole window `[end - days, end)`."""
    history_from = parse_iso((doc or {}).get("historyFrom"))
    updated = parse_iso((doc or {}).get("updatedAt"))
    if history_from is None or updated is None:
        return False
    return history_from <= end - timedelta(days=days) and updated >= end


def curve_as_of(rides: dict[str, dict] | None, end: datetime, days: int) -> dict:
    """The curve entry the rider would have had at `end`: rides started in `[end - days, end)`.

    Same shape as a `strava_power_curves` entry (without `computedAt`), with `asOf`.
    """
    start = end - timedelta(days=days)
    inside = []
    for ride in (rides or {}).values():
        began = parse_iso((ride or {}).get("startDate"))
        if began is not None and start <= began < end:
            inside.append(ride)
    indoor = [r for r in inside if r.get("indoor")]
    outdoor = [r for r in inside if not r.get("indoor")]
    races = [r for r in outdoor if r.get("race")]
    curve_indoor = merge_curves(*(r.get("efforts") for r in indoor))
    curve_outdoor = merge_curves(*(r.get("efforts") for r in outdoor))
    return {
        "days": int(days),
        "curve": merge_curves(curve_indoor, curve_outdoor),
        "curveIndoor": curve_indoor,
        "curveOutdoor": curve_outdoor,
        "curveOutdoorRace": merge_curves(*(r.get("efforts") for r in races)),
        "activityCount": len(inside),
        "indoorCount": len(indoor),
        "outdoorCount": len(outdoor),
        "outdoorRaceCount": len(races),
        "split": True,
        "version": VERSION,
        "asOf": end.isoformat(),
    }
