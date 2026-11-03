"""Strava API usage tracking, so background jobs never use up the app's quota.

Strava reports the app-wide read limits and usage on every API response:
`X-ReadRateLimit-Limit: "<15min>,<daily>"` and `X-ReadRateLimit-Usage: "<15min>,<daily>"`
(older apps: `X-RateLimit-*`). Windows reset every quarter hour (UTC) and at UTC
midnight. `record()` keeps the latest values in memory; `persist()`/`load()` share
them through `strava_rate_usage/current` so a fresh Cloud Function instance knows
the usage before it makes its first request.
"""
from __future__ import annotations

import threading
from datetime import datetime, timezone
from typing import Any, Mapping

COLLECTION = "strava_rate_usage"
DOC = "current"
# Strava's defaults, used until a response tells us the real limits.
DEFAULT_LIMIT_15MIN = 100
DEFAULT_LIMIT_DAILY = 1000

_lock = threading.Lock()
_state: dict[str, Any] = {}


def _pair(value: str | None) -> tuple[int, int] | None:
    if not value:
        return None
    try:
        a, b = (int(x.strip()) for x in str(value).split(",")[:2])
        return a, b
    except (TypeError, ValueError):
        return None


def record(headers: Mapping[str, str] | None, now: datetime | None = None) -> None:
    """Remember the usage reported by one Strava response (missing headers are ignored)."""
    if not headers:
        return
    try:
        limit = _pair(headers.get("X-ReadRateLimit-Limit") or headers.get("X-RateLimit-Limit"))
        usage = _pair(headers.get("X-ReadRateLimit-Usage") or headers.get("X-RateLimit-Usage"))
    except AttributeError:
        return
    if not limit or not usage:
        return
    with _lock:
        _state.update({
            "limit15": limit[0], "limitDay": limit[1],
            "usage15": usage[0], "usageDay": usage[1],
            "at": (now or datetime.now(timezone.utc)).isoformat(),
        })


def snapshot() -> dict:
    with _lock:
        return dict(_state)


def clear() -> None:
    with _lock:
        _state.clear()


def _parse(at: Any) -> datetime | None:
    if not isinstance(at, str):
        return None
    try:
        dt = datetime.fromisoformat(at.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def load(db: Any) -> dict:
    snap = db.collection(COLLECTION).document(DOC).get()
    return (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}


def _is_newer(candidate: dict, stored: dict | None) -> bool:
    cand_at = _parse(candidate.get("at"))
    stored_at = _parse((stored or {}).get("at"))
    return cand_at is not None and (stored_at is None or cand_at > stored_at)


def persist(db: Any) -> bool:
    """Store this instance's latest usage, but never over newer usage from another instance.

    Uses a Firestore transaction when available so two instances writing at the same
    time cannot leave the older value behind. Returns True when something was written.
    """
    current = snapshot()
    if not current:
        return False
    ref = db.collection(COLLECTION).document(DOC)
    if hasattr(db, "transaction"):
        from firebase_admin import firestore

        @firestore.transactional
        def _write(tx):
            snap = ref.get(transaction=tx)
            stored = (snap.to_dict() or {}) if getattr(snap, "exists", False) else None
            if not _is_newer(current, stored):
                return False
            tx.set(ref, current)
            return True

        return bool(_write(db.transaction()))
    snap = ref.get()
    stored = (snap.to_dict() or {}) if getattr(snap, "exists", False) else None
    if not _is_newer(current, stored):
        return False
    ref.set(current)
    return True


def latest(*snapshots: dict) -> dict:
    """The most recent of several snapshots (by `at`)."""
    best: dict = {}
    for s in snapshots:
        if s and (_parse(s.get("at")) or datetime.min.replace(tzinfo=timezone.utc)) > (
                _parse(best.get("at")) or datetime.min.replace(tzinfo=timezone.utc)):
            best = s
    return best


def current_usage(snap: dict, now: datetime | None = None) -> dict:
    """Usage in the *current* windows (counters from an earlier window count as 0)."""
    now = now or datetime.now(timezone.utc)
    at = _parse(snap.get("at"))
    same_day = bool(at and at.date() == now.date())
    same_quarter = bool(same_day and at.hour == now.hour and at.minute // 15 == now.minute // 15)
    return {
        "limit15": int(snap.get("limit15") or DEFAULT_LIMIT_15MIN),
        "limitDay": int(snap.get("limitDay") or DEFAULT_LIMIT_DAILY),
        "usage15": int(snap.get("usage15") or 0) if same_quarter else 0,
        "usageDay": int(snap.get("usageDay") or 0) if same_day else 0,
        "known": bool(snap.get("limitDay")),
    }


def within_budget(snap: dict, cost: int, fraction: float, now: datetime | None = None) -> bool:
    """True when spending `cost` more requests keeps both windows under `fraction` of the limit.

    With no information yet (no response seen), one unit of work is allowed so the
    real limits can be learned from Strava's headers.
    """
    u = current_usage(snap, now)
    if not u["known"]:
        return True
    return (u["usage15"] + cost <= u["limit15"] * fraction
            and u["usageDay"] + cost <= u["limitDay"] * fraction)
