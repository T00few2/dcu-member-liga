"""Cached Strava peak-power curves.

Building a curve costs one Strava request per ride (up to 50 per rider), and
Strava allows about 100 read requests per 15 minutes per app. Curves are cached
in `strava_power_curves/{userDocId}_{days}` so the admin page, the division
agent and predictor tuning reuse them instead of refetching.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

logger = logging.getLogger(__name__)

COLLECTION = "strava_power_curves"
ALLOWED_DAYS = (30, 90, 180, 360)
DEFAULT_MAX_AGE_HOURS = 24


def cache_doc_id(user_doc_id: str, days: int) -> str:
    return f"{user_doc_id}_{int(days)}"


def _now() -> datetime:
    return datetime.now(timezone.utc)


def read_cached_curve(db: Any, user_doc_id: str, days: int) -> dict | None:
    snap = db.collection(COLLECTION).document(cache_doc_id(user_doc_id, days)).get()
    if not getattr(snap, "exists", False):
        return None
    data = snap.to_dict() or {}
    if not isinstance(data.get("curve"), dict):
        return None
    return data


def read_all_cached(db: Any) -> dict[tuple[str, int], dict]:
    """Every cached curve in one query, keyed by (userDocId, days).

    Much faster than one read per rider and window: tuning, research and the cache
    status line read hundreds of riders at a time.
    """
    out: dict[tuple[str, int], dict] = {}
    for snap in db.collection(COLLECTION).stream():
        data = snap.to_dict() or {}
        if not isinstance(data.get("curve"), dict):
            continue
        user_doc_id, days = data.get("userDocId"), data.get("days")
        if (not user_doc_id or not isinstance(days, int)) and isinstance(getattr(snap, "id", None), str):
            # Doc id is "{userDocId}_{days}" (see cache_doc_id).
            head, _, tail = snap.id.rpartition("_")
            if head and tail.isdigit():
                user_doc_id, days = head, int(tail)
        if not user_doc_id or not isinstance(days, int):
            continue
        out[(str(user_doc_id), int(days))] = data
    return out


def cached_reader(db: Any) -> Callable[[str, int], dict | None]:
    """A `read_curve(user_doc_id, days)` function backed by one `read_all_cached` query.

    A failed query raises instead of looking like an empty cache: otherwise the
    warm-up would refetch (and overwrite) every rider's curve and tuning would
    report "insufficient data" instead of failing.
    """
    cache = read_all_cached(db)
    return lambda user_doc_id, days: cache.get((str(user_doc_id), int(days)))


def _age_hours(entry: dict, now: datetime) -> float | None:
    raw = entry.get("computedAt")
    if not isinstance(raw, str):
        return None
    try:
        computed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    if computed.tzinfo is None:
        computed = computed.replace(tzinfo=timezone.utc)
    return (now - computed).total_seconds() / 3600


def get_strava_power_curve(
    db: Any,
    strava_service: Any,
    user_doc_id: str,
    days: int,
    *,
    compute_curve: Callable[[str, list], dict],
    max_age_hours: float = DEFAULT_MAX_AGE_HOURS,
    refresh: bool = False,
    allow_fetch: bool = True,
) -> dict | None:
    """Return `{curve, activityCount, days, computedAt, cached}` for one rider.

    Uses the cached curve when it is younger than `max_age_hours` (unless
    `refresh`). With `allow_fetch=False` only the cache is read, whatever its
    age, which is what tuning wants so it never spends Strava requests.
    """
    if days not in ALLOWED_DAYS:
        raise ValueError(f"days must be one of {ALLOWED_DAYS}")
    now = _now()
    cached = None
    try:
        cached = read_cached_curve(db, user_doc_id, days)
    except Exception as exc:  # cache problems must never block a fetch
        logger.warning("strava curve cache read failed for %s: %s", user_doc_id, exc)

    if cached and not allow_fetch:
        return {**cached, "cached": True}
    if cached and not refresh:
        age = _age_hours(cached, now)
        if age is not None and age < max_age_hours:
            return {**cached, "cached": True}
    if not allow_fetch:
        return None

    after_ts = int((now - timedelta(days=days)).timestamp())
    activities = strava_service.get_power_activities(str(user_doc_id), after_ts)
    curve = compute_curve(str(user_doc_id), activities) if activities else {}
    entry = {
        "userDocId": str(user_doc_id),
        "days": int(days),
        "curve": {str(k): float(v) for k, v in (curve or {}).items()},
        "activityCount": len(activities or []),
        "computedAt": now.isoformat(),
    }
    try:
        db.collection(COLLECTION).document(cache_doc_id(user_doc_id, days)).set(entry)
    except Exception as exc:
        logger.warning("strava curve cache write failed for %s: %s", user_doc_id, exc)
    return {**entry, "cached": False}
