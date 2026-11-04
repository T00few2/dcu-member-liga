"""Riders waiting for the division agent: `division_agent_queue/{zwiftId}`.

Triggers (registration, Strava connected, nightly ZR refresh, "Scan riders now")
only enqueue; the predictor worker (Cloud Scheduler, every 5 minutes) does the work.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone
from typing import Any

logger = logging.getLogger(__name__)

COLLECTION = "division_agent_queue"
# A claimed entry older than this belongs to a worker that was killed.
STALE_CLAIM_MINUTES = 20


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def enqueue(db: Any, zwift_id: str, reason: str) -> None:
    """Queue a rider (idempotent: a rider already queued keeps one entry)."""
    if not zwift_id:
        return
    ref = db.collection(COLLECTION).document(str(zwift_id))
    snap = ref.get()
    existing = (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}
    reasons = sorted(set(existing.get("reasons") or []) | {reason})
    ref.set({
        "zwiftId": str(zwift_id),
        "reasons": reasons,
        "queuedAt": existing.get("queuedAt") or _now().isoformat(),
        "attempts": int(existing.get("attempts") or 0),
        "notBefore": existing.get("notBefore"),
        "claimedAt": existing.get("claimedAt"),
    })


def safe_enqueue(db: Any, zwift_id: str, reason: str) -> None:
    """Enqueue from a request handler: never let the agent break the caller."""
    try:
        enqueue(db, zwift_id, reason)
    except Exception as exc:
        logger.warning("division agent: could not queue %s (%s): %s", zwift_id, reason, exc)


def entries(db: Any) -> list[dict]:
    return [snap.to_dict() or {} for snap in db.collection(COLLECTION).stream()]


def _ready(entry: dict, now: datetime) -> bool:
    not_before = _parse(entry.get("notBefore"))
    if not_before and not_before > now:
        return False
    claimed = _parse(entry.get("claimedAt"))
    return not (claimed and claimed > now - timedelta(minutes=STALE_CLAIM_MINUTES))


def ready(db: Any, now: datetime | None = None) -> list[dict]:
    """Entries a worker may take now, oldest first."""
    now = now or _now()
    return sorted((e for e in entries(db) if _ready(e, now)), key=lambda e: e.get("queuedAt") or "")


def claim(db: Any, zwift_id: str, now: datetime | None = None) -> dict | None:
    """Mark an entry as being processed, exactly once (Firestore transaction when available)."""
    now = now or _now()
    ref = db.collection(COLLECTION).document(str(zwift_id))

    def check(snap: Any) -> dict | None:
        if not getattr(snap, "exists", False):
            return None
        entry = snap.to_dict() or {}
        return entry if _ready(entry, now) else None

    if hasattr(db, "transaction"):
        from firebase_admin import firestore

        @firestore.transactional
        def _take(tx):
            entry = check(ref.get(transaction=tx))
            if entry is not None:
                tx.update(ref, {"claimedAt": now.isoformat()})
            return entry

        return _take(db.transaction())
    entry = check(ref.get())
    if entry is not None:
        ref.set({"claimedAt": now.isoformat()}, merge=True)
    return entry


def done(db: Any, zwift_id: str) -> None:
    db.collection(COLLECTION).document(str(zwift_id)).delete()


def retry_later(db: Any, zwift_id: str, minutes: int, now: datetime | None = None) -> None:
    """Release a claimed entry so a later run picks it up (e.g. no Strava budget left)."""
    now = now or _now()
    ref = db.collection(COLLECTION).document(str(zwift_id))
    snap = ref.get()
    entry = (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}
    ref.set({
        **entry,
        "claimedAt": None,
        "notBefore": (now + timedelta(minutes=minutes)).isoformat(),
        "attempts": int(entry.get("attempts") or 0) + 1,
    })
