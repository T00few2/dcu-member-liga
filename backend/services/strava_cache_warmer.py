"""Fill the Strava power-curve cache a few riders at a time, for predictor tuning.

Tuning needs a cached Strava curve for riders whose vELO is reliable. Building
one curve costs about 50 Strava requests and Strava allows roughly 100 read
requests per 15 minutes, so a scheduled job warms at most `WARM_BATCH` riders
per call (called every 20 minutes by `.github/workflows/strava-cache-warm.yml`).
"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable

from services import predictor_tuning as pt
from services.strava_power_curve import get_strava_power_curve, read_cached_curve

logger = logging.getLogger(__name__)

WARM_BATCH = 2
REFRESH_AFTER_DAYS = 30


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
    """Counts plus the riders still missing a fresh curve (oldest first: none cached before stale)."""
    now = datetime.now(timezone.utc)
    eligible = eligible_riders(participants, min_rides)
    missing: list[dict] = []
    cached = 0
    for p in eligible:
        try:
            entry = read_cached_curve(db, p["userDocId"], days)
        except Exception:
            entry = None
        if _is_fresh(entry, now, max_age_days):
            cached += 1
        else:
            missing.append({"rider": p, "hasStale": entry is not None})
    missing.sort(key=lambda m: m["hasStale"])  # never-cached riders first
    return {
        "days": days,
        "eligible": len(eligible),
        "cached": cached,
        "missing": [m["rider"] for m in missing],
    }


def warm(
    db: Any,
    strava_service: Any,
    participants: list[dict],
    *,
    min_rides: int,
    days: int,
    compute_curve: Callable[[str, list], dict],
    limit: int = WARM_BATCH,
) -> dict:
    """Fetch Strava curves for up to `limit` eligible riders without a fresh cached curve."""
    status = cache_status(db, participants, min_rides=min_rides, days=days)
    warmed, failed = [], []
    for p in status["missing"][: max(0, limit)]:
        try:
            entry = get_strava_power_curve(
                db, strava_service, p["userDocId"], days, compute_curve=compute_curve, refresh=True,
            )
            warmed.append({"zwiftId": str(p.get("zwiftId")), "activityCount": entry["activityCount"]})
        except Exception as exc:
            logger.warning("strava cache warm failed for %s: %s", p.get("zwiftId"), exc)
            failed.append(str(p.get("zwiftId")))
    remaining = max(0, len(status["missing"]) - len(warmed))
    return {
        "days": days,
        "eligible": status["eligible"],
        "cached": status["cached"] + len(warmed),
        "warmed": warmed,
        "failed": failed,
        "remaining": remaining,
    }
