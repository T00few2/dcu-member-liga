"""Cached Strava peak-power curves.

Building a curve costs one Strava request per power ride in the window (every ride
is used, no cap) plus the activity-list page(s). Curves are cached
in `strava_power_curves/{userDocId}_{days}` so the admin page, the division
agent and predictor tuning reuse them instead of refetching.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

logger = logging.getLogger(__name__)

COLLECTION = "strava_power_curves"
ALLOWED_DAYS = (30, 60, 90, 180, 360)
# Parallel per-activity work when one fetch builds several windows.
PER_ACTIVITY_WORKERS = 10
DEFAULT_MAX_AGE_HOURS = 24


class StravaBudgetExceeded(Exception):
    """Raised before downloading streams when the caller's Strava budget says no."""

    def __init__(self, streams: int):
        super().__init__(f"{streams} activity streams do not fit in the Strava budget right now")
        self.streams = streams


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


def _share_usage(db: Any) -> None:
    """Add this instance's Strava request count to the shared counters (best effort)."""
    try:
        from services import strava_rate

        strava_rate.persist(db)
    except Exception as exc:
        logger.warning("could not store Strava usage: %s", exc)


def _clean(curve: dict | None) -> dict[str, float]:
    return {str(k): float(v) for k, v in (curve or {}).items() if v is not None}


def merge_curves(*curves: dict) -> dict[str, float]:
    """Per-duration best of several curves (the rider's overall Strava best efforts)."""
    out: dict[str, float] = {}
    for c in curves:
        for k, v in (c or {}).items():
            if v is not None and float(v) > out.get(k, 0.0):
                out[k] = float(v)
    return out


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
    budget: Callable[[int], bool] | None = None,
    also_days: tuple[int, ...] | list[int] = (),
) -> dict | None:
    """Return `{curve, curveIndoor, curveOutdoor, activityCount, indoorCount, outdoorCount,
    days, computedAt, split, cached}` for one rider.

    Indoor rides (Zwift `VirtualRide` and trainer rides) and outdoor rides get separate
    curves so the outdoor→indoor correction is only applied to outdoor efforts; `curve` is
    the per-duration best of both. Entries written before the split (no `split`) are
    re-fetched instead of served from the cache when a fetch is allowed.

    Uses the cached curve when it is younger than `max_age_hours` (unless
    `refresh`). With `allow_fetch=False` only the cache is read, whatever its
    age, which is what tuning wants so it never spends Strava requests.

    `budget(n)` is asked after the activity list is read, with the number of streams
    the curve needs; when it returns False, `StravaBudgetExceeded` is raised and no
    streams are downloaded.

    With `also_days`, one fetch (activity list and one stream per ride, for the longest
    window) writes an entry for every window in `days` + `also_days`: each ride's best
    efforts are computed once and merged per window. That entry for the longest window
    records `windows`, so the warm-up knows every window was written together.
    """
    windows = sorted({int(days), *(int(d) for d in also_days)})
    if any(w not in ALLOWED_DAYS for w in windows):
        raise ValueError(f"days must be one of {ALLOWED_DAYS}")
    if len(windows) > 1:
        return _fetch_windows(db, strava_service, user_doc_id, days, windows, compute_curve=compute_curve,
                              max_age_hours=max_age_hours, refresh=refresh, allow_fetch=allow_fetch,
                              budget=budget)
    now = _now()
    cached = None
    try:
        cached = read_cached_curve(db, user_doc_id, days)
    except Exception as exc:  # cache problems must never block a fetch
        logger.warning("strava curve cache read failed for %s: %s", user_doc_id, exc)

    if cached and not allow_fetch:
        return {**cached, "cached": True}
    if cached and not refresh and cached.get("split"):  # legacy (unsplit) entries are re-fetched
        age = _age_hours(cached, now)
        if age is not None and age < max_age_hours:
            return {**cached, "cached": True}
    if not allow_fetch:
        return None

    after_ts = int((now - timedelta(days=days)).timestamp())
    try:
        activities = strava_service.get_power_activities(str(user_doc_id), after_ts, max_activities=None)
        if activities and budget is not None and not budget(len(activities)):
            raise StravaBudgetExceeded(len(activities))
        activities = activities or []
        indoor = [a for a in activities if a.get("indoor")]
        outdoor = [a for a in activities if not a.get("indoor")]
        curve_indoor = _clean(compute_curve(str(user_doc_id), indoor)) if indoor else {}
        curve_outdoor = _clean(compute_curve(str(user_doc_id), outdoor)) if outdoor else {}
    finally:
        _share_usage(db)
    entry = {
        "userDocId": str(user_doc_id),
        "days": int(days),
        "curve": merge_curves(curve_indoor, curve_outdoor),
        "curveIndoor": curve_indoor,
        "curveOutdoor": curve_outdoor,
        "activityCount": len(activities),
        "indoorCount": len(indoor),
        "outdoorCount": len(outdoor),
        "split": True,
        "computedAt": now.isoformat(),
    }
    try:
        db.collection(COLLECTION).document(cache_doc_id(user_doc_id, days)).set(entry)
    except Exception as exc:
        logger.warning("strava curve cache write failed for %s: %s", user_doc_id, exc)
    return {**entry, "cached": False}


def _start_epoch(activity: dict) -> float | None:
    raw = activity.get("startDate")
    if not isinstance(raw, str):
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)).timestamp()


def _fetch_windows(
    db: Any,
    strava_service: Any,
    user_doc_id: str,
    days: int,
    windows: list[int],
    *,
    compute_curve: Callable[[str, list], dict],
    max_age_hours: float,
    refresh: bool,
    allow_fetch: bool,
    budget: Callable[[int], bool] | None,
) -> dict | None:
    """Several windows from one fetch; returns the entry for `days`."""
    now = _now()
    longest = max(windows)
    try:
        cached = read_cached_curve(db, user_doc_id, days)
    except Exception as exc:  # cache problems must never block a fetch
        logger.warning("strava curve cache read failed for %s: %s", user_doc_id, exc)
        cached = None
    if cached and not allow_fetch:
        return {**cached, "cached": True}
    if not allow_fetch:
        return None
    if cached and not refresh and cached.get("split"):
        age = _age_hours(cached, now)
        if age is not None and age < max_age_hours:
            return {**cached, "cached": True}

    after_ts = int((now - timedelta(days=longest)).timestamp())
    try:
        activities = strava_service.get_power_activities(str(user_doc_id), after_ts, max_activities=None) or []
        if activities and budget is not None and not budget(len(activities)):
            raise StravaBudgetExceeded(len(activities))
        # One stream download and one best-efforts computation per ride, in parallel.
        with ThreadPoolExecutor(max_workers=PER_ACTIVITY_WORKERS) as pool:
            efforts = list(pool.map(lambda a: _clean(compute_curve(str(user_doc_id), [a])), activities))
    finally:
        _share_usage(db)

    entries: dict[int, dict] = {}
    for w in windows:
        cutoff = (now - timedelta(days=w)).timestamp()
        inside = [(a, e) for a, e in zip(activities, efforts)
                  if w == longest or (_start_epoch(a) or 0) > cutoff]
        indoor = [e for a, e in inside if a.get("indoor")]
        outdoor = [e for a, e in inside if not a.get("indoor")]
        curve_indoor, curve_outdoor = merge_curves(*indoor), merge_curves(*outdoor)
        entry = {
            "userDocId": str(user_doc_id),
            "days": int(w),
            "curve": merge_curves(curve_indoor, curve_outdoor),
            "curveIndoor": curve_indoor,
            "curveOutdoor": curve_outdoor,
            "activityCount": len(inside),
            "indoorCount": len(indoor),
            "outdoorCount": len(outdoor),
            "split": True,
            "computedAt": now.isoformat(),
        }
        if w == longest:
            entry["windows"] = list(windows)
        entries[w] = entry
        try:
            db.collection(COLLECTION).document(cache_doc_id(user_doc_id, w)).set(entry)
        except Exception as exc:
            logger.warning("strava curve cache write failed for %s (%sd): %s", user_doc_id, w, exc)
    return {**entries[int(days)], "cached": False}
