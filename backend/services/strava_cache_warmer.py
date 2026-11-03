"""Fill the Strava power-curve cache a few riders at a time, for predictor tuning.

Tuning needs a cached Strava curve for riders whose vELO is reliable. Building
one curve costs up to about 60 Strava requests, so each call warms at most
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
from services import strava_rate
from services.strava_power_curve import cached_reader, get_strava_power_curve

logger = logging.getLogger(__name__)

WARM_BATCH = 10
# A curve costs about 1 activity page plus one stream request per ride (max 50).
REQUESTS_PER_RIDER = 60
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
REFRESH_AFTER_DAYS = 30
# A rider whose Strava has no power rides gets an empty curve. Count it as "no
# power data" (not cached, not usable for tuning) and retry only after a week.
RETRY_EMPTY_AFTER_DAYS = 7


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
    cached = no_power = 0
    for p in eligible:
        entry = read_curve(p["userDocId"], days)
        has_power = bool(entry and entry.get("curve"))
        if has_power and _is_fresh(entry, now, max_age_days):
            cached += 1
        elif entry and not has_power and _is_fresh(entry, now, RETRY_EMPTY_AFTER_DAYS):
            no_power += 1
        else:
            # 0 = never cached, 1 = stale or empty curve due for a retry
            missing.append((0 if entry is None else 1, p))
    missing.sort(key=lambda m: m[0])
    return {
        "days": days,
        "eligible": len(eligible),
        "cached": cached,
        "noPowerData": no_power,
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
) -> dict:
    """Run one warm-up unless another is already running (then `busy` is true)."""
    owner = uuid.uuid4().hex
    if not _acquire_lock(db, owner, now()):
        return {"days": days, "busy": True, "warmed": [], "failed": [], "rateLimited": False}
    try:
        return {**_warm(db, strava_service, participants, min_rides=min_rides, days=days,
                        compute_curve=compute_curve, limit=limit, now=now), "busy": False}
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
) -> dict:
    """Fetch Strava curves for up to `limit` eligible riders without a fresh cached curve.

    Stops early when the next rider would take Strava usage above `BUDGET_FRACTION` of
    either the 15-minute or the daily read limit (`rateLimited` is then true).
    """
    status = cache_status(db, participants, min_rides=min_rides, days=days)
    try:
        stored = strava_rate.load(db)
    except Exception:
        stored = {}
    warmed, failed = [], []
    new_cached = new_empty = 0
    rate_limited = False
    for p in status["missing"][: max(0, limit)]:
        usage = strava_rate.latest(stored, strava_rate.snapshot())
        if not strava_rate.within_budget(usage, REQUESTS_PER_RIDER, BUDGET_FRACTION, now()):
            rate_limited = True
            break
        try:
            entry = get_strava_power_curve(
                db, strava_service, p["userDocId"], days, compute_curve=compute_curve, refresh=True,
            )
            warmed.append({"zwiftId": str(p.get("zwiftId")), "activityCount": entry["activityCount"]})
            if entry.get("curve"):
                new_cached += 1
            else:
                new_empty += 1
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
            "rateLimited": rate_limited,
        })
    except Exception as exc:
        logger.warning("could not store last warm-up summary: %s", exc)
    return {
        "days": days,
        "eligible": status["eligible"],
        "cached": status["cached"] + new_cached,
        "noPowerData": status["noPowerData"] + new_empty,
        "warmed": warmed,
        "failed": failed,
        "remaining": remaining,
        "rateLimited": rate_limited,
        "stravaUsage": strava_rate.current_usage(strava_rate.latest(stored, strava_rate.snapshot()), now()),
    }


def strava_usage(db: Any) -> dict:
    """Current Strava read usage and limits, plus the share the cache may use."""
    try:
        stored = strava_rate.load(db)
    except Exception:
        stored = {}
    usage = strava_rate.current_usage(strava_rate.latest(stored, strava_rate.snapshot()))
    return {**usage, "cacheBudgetFraction": BUDGET_FRACTION}


def last_warm(db: Any) -> dict | None:
    """Counts from the most recent warm-up call (for the Tuning panel)."""
    try:
        snap = db.collection(LAST_WARM_COLLECTION).document(LAST_WARM_DOC).get()
    except Exception:
        return None
    return (snap.to_dict() or None) if getattr(snap, "exists", False) else None

