"""Fill the Strava power-curve cache a few riders at a time, for predictor tuning.

Tuning needs a cached Strava curve for riders whose vELO is reliable; those come
first. Every other rider with Strava (mostly the division agent's riders) is cached
after them, so their review rarely waits for Strava. Building one curve costs one
request per power ride, so each call warms at most
`WARM_BATCH` riders and stops at `BUDGET_FRACTION` of Strava's read limits. Google
Cloud Scheduler calls it every 15 minutes (set up by `deploy-backend.yml`); only one
call runs at a time.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services import predictor_tuning as pt
from services import velo_predictor as vp
from services import strava_efforts
from services import strava_rate
from services.strava_power_curve import StravaBudgetExceeded, cached_reader, get_strava_power_curve

logger = logging.getLogger(__name__)

WARM_BATCH = 10
# Before a rider's activity list is read, only the list page(s) need to fit; the real
# cost (one stream per power ride, no cap) is checked once the list is known.
LIST_REQUESTS = 2
# The cache never uses more than this share of Strava's 15-minute and daily read limits,
# so the rest of the app (predictor page, verification, rider features) always has room.
BUDGET_FRACTION = 0.75
LAST_WARM_COLLECTION = "strava_cache_warm"
LAST_WARM_DOC = "last"
# One warm-up at a time: Cloud Scheduler, a manual workflow run and "Fill now" may
# overlap, and two runs would each pass the budget check before either has spent
# anything. A lock older than the function timeout belongs to a killed run.
LOCK_COLLECTION = "strava_cache_warm_lock"
LOCK_DOC = "current"
LOCK_STALE_MINUTES = 16
# Weekly, so a curve always ends close to "now" like the 30-day vELO it is compared with.
REFRESH_AFTER_DAYS = 7
# A rider whose Strava has no power rides gets an empty curve. Count it as "no
# power data" (not cached, not usable for tuning) and retry only after a week.
RETRY_EMPTY_AFTER_DAYS = 7
# The history is "long enough" when it reaches within this many days of what is asked for
# (the asked-for start moves one day further back every day).
HISTORY_SLACK_DAYS = 14


def _is_fresh(entry: dict | None, now: datetime, max_age_days: int) -> bool:
    if not entry:
        return False
    raw = entry.get("computedAt")
    if not isinstance(raw, str):
        return False
    try:
        computed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return False
    if computed.tzinfo is None:
        computed = computed.replace(tzinfo=timezone.utc)
    return (now - computed).total_seconds() < max_age_days * 86400


def _complete(entry: dict) -> bool:
    """Split into indoor/outdoor, written with per-ride efforts and race tags (`version`),
    and every tuning window written by the same fetch."""
    return (bool(entry.get("split")) and int(entry.get("version") or 0) >= strava_efforts.VERSION
            and set(vp.STRAVA_WINDOWS) <= set(entry.get("windows") or ()))


def _empty_without_history(entry: dict) -> bool:
    """An empty curve written before per-ride efforts were stored. The rider has no stored
    ride history, so league races keep counting the rider as "waiting for Strava history"
    until the weekly retry. One fetch (the activity list only, there are no rides to
    download) settles it."""
    return int(entry.get("version") or 0) < strava_efforts.VERSION


def eligible_riders(participants: list[dict], min_rides: int) -> list[dict]:
    """Riders that would be in the tuning eval set if they had a Strava curve."""
    return [
        p for p in participants
        if p.get("hasStrava") and p.get("userDocId") and pt.reliable_velo(p, min_rides) is not None
    ]


def cache_status(
    db: Any,
    participants: list[dict],
    *,
    min_rides: int,
    days: int,
    max_age_days: int = REFRESH_AFTER_DAYS,
    history_days: int | None = None,
    league_ids: set[str] | None = None,
) -> dict:
    """Counts plus the riders still missing a usable curve (never-cached first, stale last).

    `cached` counts only curves with power data, i.e. riders tuning can actually use.
    Riders whose Strava has no power rides are counted in `noPowerData` and left alone
    for `RETRY_EMPTY_AFTER_DAYS`, so they neither inflate progress nor burn requests.
    """
    now = datetime.now(timezone.utc)
    eligible = eligible_riders(participants, min_rides)
    read_curve = cached_reader(db)
    missing: list[tuple[int, dict]] = []
    uncounted: set[str] = set()  # eligible riders not yet in `cached` / `noPowerData`
    cached = no_power = 0
    for p in eligible:
        entry = read_curve(p["userDocId"], days)
        has_power = bool(entry and entry.get("curve"))
        if has_power and _is_fresh(entry, now, max_age_days):
            cached += 1
            if not _complete(entry):
                # Usable meanwhile, but written before the indoor/outdoor split or without
                # every tuning window: re-fetch it after every never-cached and stale rider.
                missing.append((2, p))
        elif entry and not has_power and _is_fresh(entry, now, RETRY_EMPTY_AFTER_DAYS):
            no_power += 1
            if _empty_without_history(entry):
                missing.append((2, p))
        else:
            # 0 = never cached, 1 = stale or empty curve due for a retry (2 = incomplete, above)
            missing.append((0 if entry is None else 1, p))
            uncounted.add(p["userDocId"])

    # Every other rider with Strava (mostly the division agent's riders: no vELO or few
    # rides) is kept cached too, after the tuning riders: 3 = never cached, 4 = stale,
    # empty and due for a retry, or incomplete (before the split, or missing a window).
    eligible_ids = {p["userDocId"] for p in eligible}
    others = [p for p in participants
              if p.get("hasStrava") and p.get("userDocId") and p["userDocId"] not in eligible_ids]
    others_cached = 0
    for p in others:
        entry = read_curve(p["userDocId"], days)
        has_power = bool(entry and entry.get("curve"))
        if has_power and _complete(entry) and _is_fresh(entry, now, max_age_days):
            others_cached += 1
        elif entry and not has_power and _is_fresh(entry, now, RETRY_EMPTY_AFTER_DAYS):
            # No power rides; retried after a week (once right away if it has no stored history).
            if _empty_without_history(entry):
                missing.append((4, p))
        else:
            missing.append((3 if entry is None else 4, p))

    # Last of all: riders whose curve is fine but whose stored ride history does not reach
    # back to the season's first race yet (5). One fetch per rider fills it.
    if history_days:
        listed = {p["userDocId"] for _, p in missing}
        needed_from = now - timedelta(days=history_days - HISTORY_SLACK_DAYS)
        for p in eligible + others:
            entry = read_curve(p["userDocId"], days)
            if p["userDocId"] in listed or not (entry and entry.get("curve")):
                continue
            reached = strava_efforts.parse_iso(entry.get("historyFrom"))
            if reached is None or reached > needed_from:
                missing.append((5, p))

    # First of all (-1): riders who have ridden a league race but have no reliable vELO.
    # Their league results are the only ground truth for the riders the predictor is for,
    # and they only count once their Strava history reaches back before those races.
    if league_ids:
        missing = [(-1 if str(p.get("zwiftId")) in league_ids and p["userDocId"] not in eligible_ids else rank, p)
                   for rank, p in missing]

    missing.sort(key=lambda m: m[0])
    return {
        "days": days,
        "eligible": len(eligible),
        "cached": cached,
        "noPowerData": no_power,
        "others": len(others),
        "othersCached": others_cached,
        "uncounted": uncounted,
        "eligibleIds": eligible_ids,
        "missing": [p for _, p in missing],
    }


def _parse_iso(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _lock_is_held(snap: Any, now: datetime) -> bool:
    if not getattr(snap, "exists", False):
        return False
    held_at = _parse_iso((snap.to_dict() or {}).get("at"))
    return bool(held_at and held_at > now - timedelta(minutes=LOCK_STALE_MINUTES))


def _acquire_lock(db: Any, owner: str, now: datetime) -> bool:
    """Claim the warm-up slot: free or stale lock -> ours, in one Firestore transaction.

    Read-check-write inside a transaction means two callers that both find a stale
    lock cannot both take it: the second transaction retries and sees the new lock.
    """
    ref = db.collection(LOCK_COLLECTION).document(LOCK_DOC)
    record = {"owner": owner, "at": now.isoformat()}
    if hasattr(db, "transaction"):
        from firebase_admin import firestore

        @firestore.transactional
        def _claim(tx):
            if _lock_is_held(ref.get(transaction=tx), now):
                return False
            tx.set(ref, record)
            return True

        return bool(_claim(db.transaction()))
    if _lock_is_held(ref.get(), now):  # test fakes without transactions
        return False
    ref.set(record)
    return True


def _release_lock(db: Any, owner: str) -> None:
    ref = db.collection(LOCK_COLLECTION).document(LOCK_DOC)
    try:
        snap = ref.get()
        if getattr(snap, "exists", False) and (snap.to_dict() or {}).get("owner") == owner:
            ref.delete()
    except Exception as exc:
        logger.warning("could not release Strava warm-up lock: %s", exc)


def warm(
    db: Any,
    strava_service: Any,
    participants: list[dict],
    *,
    min_rides: int,
    days: int,
    compute_curve: Callable[[str, list], dict],
    limit: int = WARM_BATCH,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    history_days: int | None = None,
    league_ids: set[str] | None = None,
) -> dict:
    """Run one warm-up unless another is already running (then `busy` is true).

    With `history_days`, each rider's ride list (and stored per-ride efforts) reaches that
    far back, so curves can be rebuilt for past league races. Rides already stored are
    not downloaded again. `league_ids` (Zwift IDs of riders with a league result) puts
    those of them without a reliable vELO first."""
    owner = uuid.uuid4().hex
    if not _acquire_lock(db, owner, now()):
        return {"days": days, "busy": True, "warmed": [], "failed": [], "rateLimited": False}
    try:
        return {**_warm(db, strava_service, participants, min_rides=min_rides, days=days,
                        compute_curve=compute_curve, limit=limit, now=now, history_days=history_days,
                        league_ids=league_ids),
                "busy": False}
    finally:
        _release_lock(db, owner)


def _warm(
    db: Any,
    strava_service: Any,
    participants: list[dict],
    *,
    min_rides: int,
    days: int,
    compute_curve: Callable[[str, list], dict],
    limit: int = WARM_BATCH,
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
    history_days: int | None = None,
    league_ids: set[str] | None = None,
) -> dict:
    """Fetch Strava curves for up to `limit` eligible riders without a fresh cached curve.

    Stops early when the next rider would take Strava usage above `BUDGET_FRACTION` of
    either the 15-minute or the daily read limit (`rateLimited` is then true).
    """
    status = cache_status(db, participants, min_rides=min_rides, days=days, history_days=history_days,
                          league_ids=league_ids)
    try:
        stored = strava_rate.load(db)
    except Exception:
        stored = {}
    warmed, failed = [], []
    new_cached = new_empty = 0
    eligible_cached = eligible_empty = others_cached = 0
    rate_limited = False
    failed_downloads = 0

    def usage() -> dict:
        # Re-read the shared counters: each curve fetch adds its requests to them (and
        # other instances may have too), so a copy from the start of the run is stale.
        nonlocal stored
        try:
            stored = strava_rate.load(db)
        except Exception:
            pass
        return strava_rate.combined(stored)

    def fits(streams: int, window_used_before: int | None = None) -> bool:
        return strava_rate.within_budget(usage(), streams, BUDGET_FRACTION, now(),
                                         window_used_before=window_used_before)

    for p in status["missing"][: max(0, limit)]:
        if not fits(LIST_REQUESTS):
            rate_limited = True
            break
        # 15-minute usage before this rider: its own activity-list request must not stop
        # a rider with very many rides from using an otherwise empty quarter hour.
        before15 = strava_rate.current_usage(usage(), now())["usage15"]
        try:
            entry = get_strava_power_curve(
                db, strava_service, p["userDocId"], days, compute_curve=compute_curve, refresh=True,
                budget=lambda n, b=before15: fits(n, window_used_before=b), also_days=vp.STRAVA_WINDOWS,
                history_days=history_days,
            )
            warmed.append({"zwiftId": str(p.get("zwiftId")), "activityCount": entry["activityCount"]})
            failed_downloads += int(entry.get("failedDownloads") or 0)
            if entry.get("curve"):
                new_cached += 1
            else:
                new_empty += 1
            if p["userDocId"] in status["uncounted"]:  # newly usable tuning rider
                if entry.get("curve"):
                    eligible_cached += 1
                else:
                    eligible_empty += 1
            elif p["userDocId"] not in status["eligibleIds"] and entry.get("curve"):
                others_cached += 1
            if entry.get("failedDownloads"):
                # Strava refused ride downloads (or had errors): stop instead of asking for
                # more. The rides that failed are fetched again in a later run.
                rate_limited = True
                break
        except StravaBudgetExceeded as exc:
            rate_limited = True
            if exc.streams + LIST_REQUESTS > strava_rate.share15(usage(), BUDGET_FRACTION):
                # Too big for a quarter hour that is already in use: it runs at the start of
                # the next one (the scheduler calls at :00/:15/:30/:45). Keep going with the
                # riders after it so one heavy rider never blocks the rest.
                continue
            break  # a normal rider that does not fit: the budget is used up
        except Exception as exc:
            logger.warning("strava cache warm failed for %s: %s", p.get("zwiftId"), exc)
            failed.append(str(p.get("zwiftId")))
    if warmed or failed:  # only runs that called Strava have new usage to share
        try:
            strava_rate.persist(db)
        except Exception as exc:
            logger.warning("could not store Strava usage: %s", exc)
    remaining = max(0, len(status["missing"]) - len(warmed))
    try:
        db.collection(LAST_WARM_COLLECTION).document(LAST_WARM_DOC).set({
            "at": now().isoformat(),
            "warmed": new_cached,
            "noPowerData": new_empty,
            "failed": len(failed),
            "failedDownloads": failed_downloads,
            "rateLimited": rate_limited,
        })
    except Exception as exc:
        logger.warning("could not store last warm-up summary: %s", exc)
    return {
        "days": days,
        "eligible": status["eligible"],
        "cached": status["cached"] + eligible_cached,
        "noPowerData": status["noPowerData"] + eligible_empty,
        "others": status["others"],
        "othersCached": status["othersCached"] + others_cached,
        "warmed": warmed,
        "failed": failed,
        "remaining": remaining,
        "rateLimited": rate_limited,
        "stravaUsage": strava_rate.current_usage(strava_rate.combined(stored), now()),
    }


def strava_usage(db: Any) -> dict:
    """Current Strava read usage and limits, plus the share the cache may use."""
    try:
        stored = strava_rate.load(db)
    except Exception:
        stored = {}
    usage = strava_rate.current_usage(strava_rate.combined(stored))
    return {**usage, "cacheBudgetFraction": BUDGET_FRACTION}


def last_warm(db: Any) -> dict | None:
    """Counts from the most recent warm-up call (for the Tuning panel)."""
    try:
        snap = db.collection(LAST_WARM_COLLECTION).document(LAST_WARM_DOC).get()
    except Exception:
        return None
    return (snap.to_dict() or None) if getattr(snap, "exists", False) else None

