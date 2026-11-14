"""Cached Strava peak-power curves.

Building a curve costs one Strava request per power ride in the window (every ride
is used, no cap) plus the activity-list page(s). Curves are cached
in `strava_power_curves/{userDocId}_{days}` so the admin page, the division
agent and predictor tuning reuse them instead of refetching.

The best efforts of each ride are also kept (`services/strava_efforts.py`), so a ride is
downloaded once, and a curve can be rebuilt as it was before any past league race.
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services import strava_efforts

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


merge_curves = strava_efforts.merge_curves


def _needs_download(stored_ride: dict | None) -> bool:
    if stored_ride is None:
        return True
    return not stored_ride.get("efforts") and not stored_ride.get("checked")


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
    history_days: int | None = None,
) -> dict | None:
    """Return `{curve, curveIndoor, curveOutdoor, curveOutdoorRace, activityCount, indoorCount,
    outdoorCount, outdoorRaceCount, days, computedAt, split, version, cached}` for one rider.

    Indoor rides (Zwift `VirtualRide` and trainer rides) and outdoor rides get separate
    curves so the outdoor→indoor correction is only applied to outdoor efforts; `curve` is
    the per-duration best of both. `curveOutdoorRace` holds the outdoor rides the rider
    marked as a race on Strava (they are also part of `curveOutdoor`). Entries written
    before the split (no `split`) are re-fetched instead of served from the cache when a
    fetch is allowed.

    Uses the cached curve when it is younger than `max_age_hours` (unless
    `refresh`). With `allow_fetch=False` only the cache is read, whatever its
    age, which is what tuning wants so it never spends Strava requests.

    Only rides whose best efforts are not stored yet are downloaded. A download that fails
    for now (`compute_curve` raises `StreamUnavailable`: Strava refused it, a server error)
    is not stored: the ride is tried again at the next fetch, `failedDownloads` says how
    many, and the stored history is not marked complete, so no past race is given a curve
    with rides missing. `budget(n)` is asked
    after the activity list is read, with the number of streams still needed; when it
    returns False, `StravaBudgetExceeded` is raised and no streams are downloaded.

    With `also_days`, one fetch writes an entry for every window in `days` + `also_days`.
    Every entry records `windows`, so the warm-up knows every window was written together,
    whichever one it checks.

    With `history_days`, the ride list (and the stored efforts) reach that far back even
    when the windows are shorter, so curves can later be rebuilt for past race dates.
    """
    windows = sorted({int(days), *(int(d) for d in also_days)})
    if any(w not in ALLOWED_DAYS for w in windows):
        raise ValueError(f"days must be one of {ALLOWED_DAYS}")
    now = _now()
    try:
        cached = read_cached_curve(db, user_doc_id, days)
    except Exception as exc:  # cache problems must never block a fetch
        logger.warning("strava curve cache read failed for %s: %s", user_doc_id, exc)
        cached = None
    if cached and not allow_fetch:
        return {**cached, "cached": True}
    if not allow_fetch:
        return None
    if cached and not refresh and cached.get("split"):  # legacy (unsplit) entries are re-fetched
        age = _age_hours(cached, now)
        if age is not None and age < max_age_hours:
            return {**cached, "cached": True}

    reach_days = max(max(windows), int(history_days or 0))
    reach_from = now - timedelta(days=reach_days)
    try:
        stored_doc = strava_efforts.read(db, user_doc_id)
    except Exception as exc:
        logger.warning("strava efforts read failed for %s: %s", user_doc_id, exc)
        stored_doc = {}
    stored = stored_doc.get("rides") or {}
    try:
        activities = strava_service.get_power_activities(
            str(user_doc_id), int(reach_from.timestamp()), max_activities=None) or []
        # A stored ride without efforts and without `checked` may be a download that was
        # refused before failures were told apart from rides without power: fetch it again.
        new = [a for a in activities if _needs_download(stored.get(str(a.get("id"))))]
        if new and budget is not None and not budget(len(new)):
            raise StravaBudgetExceeded(len(new))

        def efforts_of(activity: dict) -> dict | None:
            try:
                return _clean(compute_curve(str(user_doc_id), [activity]))
            except strava_efforts.StreamUnavailable:
                return None

        # One stream download and one best-efforts computation per new ride, in parallel.
        with ThreadPoolExecutor(max_workers=PER_ACTIVITY_WORKERS) as pool:
            fresh = list(pool.map(efforts_of, new))
    finally:
        _share_usage(db)

    computed = {str(a.get("id")): e for a, e in zip(new, fresh) if e is not None}
    failed = {str(a.get("id")) for a, e in zip(new, fresh) if e is None}
    rides: dict[str, dict] = {}
    for a in activities:
        aid = str(a.get("id"))
        if aid in failed:
            continue  # tried again at the next fetch
        rides[aid] = {
            "checked": True,
            # A ride without a start date (Strava always sends one) counts as the oldest
            # possible, so it is never used for a date it may not have existed on.
            "startDate": a.get("startDate") or reach_from.isoformat(),
            "indoor": bool(a.get("indoor")),
            "race": bool(a.get("race")),
            "efforts": computed[aid] if aid in computed else (stored[aid].get("efforts") or {}),
        }
    # Rides older than this listing stay; inside it, a ride no longer on Strava is dropped.
    for aid, ride in stored.items():
        began = strava_efforts.parse_iso((ride or {}).get("startDate"))
        if aid not in rides and began is not None and began < reach_from:
            rides[aid] = ride
    # The stored history stays continuous only when this listing overlaps the previous one.
    history_from = reach_from
    previous_from = strava_efforts.parse_iso(stored_doc.get("historyFrom"))
    previous_update = strava_efforts.parse_iso(stored_doc.get("updatedAt"))
    if previous_from and previous_update and previous_update >= reach_from:
        history_from = min(previous_from, reach_from)
    if failed:
        # Rides are missing: the history covers nothing until a fetch gets them all.
        history_from = now
    try:
        strava_efforts.write(db, user_doc_id, rides, history_from, now)
    except Exception as exc:
        logger.warning("strava efforts write failed for %s: %s", user_doc_id, exc)

    entries: dict[int, dict] = {}
    for w in windows:
        entry = strava_efforts.curve_as_of(rides, now, w)
        entry.pop("asOf", None)
        entry.update({"userDocId": str(user_doc_id), "computedAt": now.isoformat(),
                      "historyFrom": history_from.isoformat(), "failedDownloads": len(failed)})
        if len(windows) > 1:
            # On every window's doc, so the warm-up can check completeness from whichever
            # window the predictor uses.
            entry["windows"] = list(windows)
        entries[w] = entry
        try:
            db.collection(COLLECTION).document(cache_doc_id(user_doc_id, w)).set(entry)
        except Exception as exc:
            logger.warning("strava curve cache write failed for %s (%sd): %s", user_doc_id, w, exc)
    return {**entries[int(days)], "cached": False}
