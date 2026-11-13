"""Dated copies of the numbers that otherwise only exist as "today's value".

A rider's weight, Zwift power and vELO on the participant row are current values. To
pair a league race with what was known **before** it, the predictor worker stores a
snapshot of those numbers (`predictor_snapshots/{YYYY-MM-DD}`): weekly, and daily when
a race starts within two days. A race then uses the latest snapshot taken before its
start; a snapshot taken after the start is never used for that race.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Iterable

from services import velo_predictor as vp

logger = logging.getLogger(__name__)

COLLECTION = "predictor_snapshots"
WEEKLY_DAYS = 7
RACE_LEAD_HOURS = 48
FIELDS = ("weightInGrams", "cp5s", "cp1min", "cp5min", "cp20min", "rating", "max30Rating", "zwiftActivityCount")


def _parse(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def rider_values(row: dict) -> dict:
    out = {}
    for k in FIELDS:
        v = vp.to_float(row.get(k))
        if v is not None and v > 0:
            out[k] = v
    return out


def build(participants: list[dict], now: datetime) -> dict:
    riders = {}
    for p in participants:
        zid = str(p.get("zwiftId") or "")
        values = rider_values(p)
        if zid and values:
            riders[zid] = values
    return {"capturedAt": now.isoformat(), "riders": riders}


def is_due(latest: datetime | None, race_starts: Iterable[datetime | None], now: datetime) -> bool:
    """Weekly, or daily while a race starts within the next two days."""
    if latest is None or now - latest >= timedelta(days=WEEKLY_DAYS):
        return True
    race_soon = any(s is not None and now <= s <= now + timedelta(hours=RACE_LEAD_HOURS) for s in race_starts)
    return race_soon and now - latest >= timedelta(hours=24)


def latest_captured_at(db: Any) -> datetime | None:
    query = db.collection(COLLECTION).order_by("capturedAt", direction="DESCENDING").limit(1)
    for snap in query.stream():
        return _parse((snap.to_dict() or {}).get("capturedAt"))
    return None


def take_if_due(db: Any, participants: list[dict], race_starts: Iterable[datetime | None],
                now: datetime | None = None) -> bool:
    now = now or datetime.now(timezone.utc)
    if not is_due(latest_captured_at(db), race_starts, now):
        return False
    db.collection(COLLECTION).document(now.strftime("%Y-%m-%d")).set(build(participants, now))
    return True


def read_all(db: Any) -> list[dict]:
    """Every snapshot, oldest first."""
    out = []
    for snap in db.collection(COLLECTION).stream():
        data = snap.to_dict() or {}
        when = _parse(data.get("capturedAt"))
        if when is not None and isinstance(data.get("riders"), dict):
            out.append({"at": when, "riders": data["riders"]})
    return sorted(out, key=lambda s: s["at"])


def latest_before(snapshots: list[dict], zwift_id: str, when: datetime) -> dict | None:
    """The rider's values from the newest snapshot taken strictly before `when`."""
    for snap in reversed(snapshots):
        if snap["at"] < when and str(zwift_id) in snap["riders"]:
            return snap["riders"][str(zwift_id)]
    return None
