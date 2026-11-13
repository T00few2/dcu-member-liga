"""Strava API usage tracking, so background jobs never use up the app's quota.

Strava reports the app-wide read limits and usage on every API response:
`X-ReadRateLimit-Limit: "<15min>,<daily>"` and `X-ReadRateLimit-Usage: "<15min>,<daily>"`
(older apps: `X-RateLimit-*`). Windows reset every quarter hour (UTC) and at UTC
midnight. `record()` keeps the latest values in memory; `persist()`/`load()` share
them through `strava_rate_usage/current` so a fresh Cloud Function instance knows
the usage before it makes its first request.

The budget follows Strava's own usage report: it is what Strava enforces. (Strava
reports far fewer reads than the app makes, e.g. 74 on a day with ~2,250 requests,
because activity-stream downloads evidently do not count the same way, and the app
was never refused at those volumes.) A 429 response carries usage at the limit, so
the budget stops background work as soon as Strava refuses anything.

Strava documents two limits per app, each with a 15-minute and a daily window: an
overall one (`X-RateLimit-*`, every request) and a "non-upload" one (`X-ReadRateLimit-*`,
every request except uploads). Both are kept, and the budget respects both, because the
documentation says ride-stream downloads count against both while the read header has
reported far fewer. Refused requests (HTTP 429) are counted too (`count_refused`), which
shows directly whether Strava is turning the app away.

The app still counts its own requests (`count_request()` for every Strava GET,
shared through `persist()`) for information: `current_usage()` reports them as
`appRequests15` / `appRequestsDay`.
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
# Requests made by this instance and not yet added to the shared counters:
# {"day": {"YYYY-MM-DD": n}, "quarter": {"YYYY-MM-DDTHH:q": n}}
# "refused": requests Strava answered with 429, per day.
_pending: dict[str, dict[str, int]] = {"day": {}, "quarter": {}, "refused": {}}


def _day_key(now: datetime) -> str:
    return now.astimezone(timezone.utc).strftime("%Y-%m-%d")


def _quarter_key(now: datetime) -> str:
    utc = now.astimezone(timezone.utc)
    return f"{utc.strftime('%Y-%m-%dT%H')}:{utc.minute // 15}"


def count_request(now: datetime | None = None) -> None:
    """Count one Strava API request made by this instance."""
    now = now or datetime.now(timezone.utc)
    with _lock:
        for kind, key in (("day", _day_key(now)), ("quarter", _quarter_key(now))):
            _pending[kind][key] = _pending[kind].get(key, 0) + 1


def count_refused(now: datetime | None = None) -> None:
    """Count one request Strava refused (HTTP 429: over a rate limit)."""
    key = _day_key(now or datetime.now(timezone.utc))
    with _lock:
        _pending["refused"][key] = _pending["refused"].get(key, 0) + 1


def pending() -> dict[str, dict[str, int]]:
    with _lock:
        return {k: dict(v) for k, v in _pending.items()}


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
        # The overall limit, kept separately only when Strava sends both kinds.
        has_read = bool(headers.get("X-ReadRateLimit-Limit"))
        overall_limit = _pair(headers.get("X-RateLimit-Limit")) if has_read else None
        overall_usage = _pair(headers.get("X-RateLimit-Usage")) if has_read else None
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
        if overall_limit and overall_usage:
            _state.update({
                "overallLimit15": overall_limit[0], "overallLimitDay": overall_limit[1],
                "overallUsage15": overall_usage[0], "overallUsageDay": overall_usage[1],
            })


def snapshot() -> dict:
    with _lock:
        return dict(_state)


def clear() -> None:
    with _lock:
        _state.clear()
        _pending["day"].clear()
        _pending["quarter"].clear()
        _pending["refused"].clear()


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


def _merged(stored: dict | None, current: dict, counts: dict[str, dict[str, int]], now: datetime) -> dict:
    """The doc to write: newer header values plus this instance's request counts added."""
    stored = dict(stored or {})
    out = dict(stored)
    if current and _is_newer(current, stored):
        out.update(current)
    day, quarter = _day_key(now), _quarter_key(now)
    own_day = int(stored.get("ownCountDay") or 0) if stored.get("ownDay") == day else 0
    own_q = int(stored.get("ownCount15") or 0) if stored.get("ownQuarter") == quarter else 0
    refused = int(stored.get("ownRefusedDay") or 0) if stored.get("ownDay") == day else 0
    out.update({
        "ownRefusedDay": refused + counts.get("refused", {}).get(day, 0),
        "ownDay": day,
        "ownCountDay": own_day + counts["day"].get(day, 0),
        "ownQuarter": quarter,
        "ownCount15": own_q + counts["quarter"].get(quarter, 0),
    })
    return out


def _forget(counts: dict[str, dict[str, int]]) -> None:
    """Drop the counts that were just written (new requests made meanwhile stay pending)."""
    with _lock:
        for kind, by_key in counts.items():
            for key, n in by_key.items():
                left = _pending[kind].get(key, 0) - n
                if left > 0:
                    _pending[kind][key] = left
                else:
                    _pending[kind].pop(key, None)


def persist(db: Any, now: datetime | None = None) -> bool:
    """Share this instance's usage: newer header values and its own request counts.

    Header values never overwrite newer ones from another instance; request counts are
    added to the shared per-day / per-quarter-hour counters. Runs in a Firestore
    transaction when available so concurrent instances never lose each other's counts.
    Returns True when something was written.
    """
    now = now or datetime.now(timezone.utc)
    current = snapshot()
    counts = pending()
    has_counts = any(any(by_key.values()) for by_key in counts.values())
    if not current and not has_counts:
        return False
    ref = db.collection(COLLECTION).document(DOC)

    def build(stored: dict | None) -> dict | None:
        if not has_counts and not _is_newer(current, stored):
            return None
        return _merged(stored, current, counts, now)

    if hasattr(db, "transaction"):
        from firebase_admin import firestore

        @firestore.transactional
        def _write(tx):
            snap = ref.get(transaction=tx)
            doc = build((snap.to_dict() or {}) if getattr(snap, "exists", False) else None)
            if doc is None:
                return False
            tx.set(ref, doc)
            return True

        wrote = bool(_write(db.transaction()))
    else:
        snap = ref.get()
        doc = build((snap.to_dict() or {}) if getattr(snap, "exists", False) else None)
        wrote = doc is not None
        if wrote:
            ref.set(doc)
    if wrote:
        _forget(counts)
    return wrote


def latest(*snapshots: dict) -> dict:
    """The most recent of several snapshots (by `at`)."""
    best: dict = {}
    for s in snapshots:
        if s and (_parse(s.get("at")) or datetime.min.replace(tzinfo=timezone.utc)) > (
                _parse(best.get("at")) or datetime.min.replace(tzinfo=timezone.utc)):
            best = s
    return best


def current_usage(snap: dict, now: datetime | None = None) -> dict:
    """Usage in the *current* windows (counters from an earlier window count as 0).

    `usage15` / `usageDay` are Strava's own report (what the budget uses).
    `appRequests15` / `appRequestsDay` are the app's own request counts (shared counters
    in `snap` plus this instance's requests not yet persisted), for information only.
    """
    now = now or datetime.now(timezone.utc)
    at = _parse(snap.get("at"))
    same_day = bool(at and at.date() == now.date())
    same_quarter = bool(same_day and at.hour == now.hour and at.minute // 15 == now.minute // 15)
    day, quarter = _day_key(now), _quarter_key(now)
    local = pending()
    own_day = (int(snap.get("ownCountDay") or 0) if snap.get("ownDay") == day else 0) + local["day"].get(day, 0)
    own_15 = (int(snap.get("ownCount15") or 0) if snap.get("ownQuarter") == quarter else 0) \
        + local["quarter"].get(quarter, 0)
    return {
        "limit15": int(snap.get("limit15") or DEFAULT_LIMIT_15MIN),
        "limitDay": int(snap.get("limitDay") or DEFAULT_LIMIT_DAILY),
        "usage15": int(snap.get("usage15") or 0) if same_quarter else 0,
        "usageDay": int(snap.get("usageDay") or 0) if same_day else 0,
        "appRequests15": own_15,
        "appRequestsDay": own_day,
        # Strava's overall limit (every request); None until a response carried both kinds.
        "overallLimit15": int(snap["overallLimit15"]) if snap.get("overallLimit15") else None,
        "overallLimitDay": int(snap["overallLimitDay"]) if snap.get("overallLimitDay") else None,
        "overallUsage15": int(snap.get("overallUsage15") or 0) if same_quarter else 0,
        "overallUsageDay": int(snap.get("overallUsageDay") or 0) if same_day else 0,
        # Requests Strava refused today (HTTP 429).
        "refusedDay": (int(snap.get("ownRefusedDay") or 0) if snap.get("ownDay") == day else 0)
        + local["refused"].get(day, 0),
        "known": bool(snap.get("limitDay")),
    }


def combined(stored: dict | None) -> dict:
    """The newest header values (stored or this instance's) plus the shared own counts."""
    stored = stored or {}
    best = dict(latest(stored, snapshot()))
    for key in ("ownDay", "ownCountDay", "ownQuarter", "ownCount15", "ownRefusedDay"):
        if key in stored:
            best[key] = stored[key]
    return best


def within_budget(
    snap: dict,
    cost: int,
    fraction: float,
    now: datetime | None = None,
    *,
    window_used_before: int | None = None,
) -> bool:
    """True when spending `cost` more requests keeps both windows under `fraction` of the limit.

    With no information yet (no response seen), one unit of work is allowed so the
    real limits can be learned from Strava's headers. A single job bigger than the whole
    15-minute share is allowed in an otherwise unused quarter hour (if the day has room),
    so a rider with many rides is never stuck forever. `window_used_before` is the
    15-minute usage before that job started; its own earlier requests (the activity
    list) do not make the window "used".
    """
    u = current_usage(snap, now)
    if not u["known"]:
        return True
    day_ok = u["usageDay"] + cost <= u["limitDay"] * fraction
    # The overall limit (every request) holds as well, when Strava reports it.
    if u.get("overallLimitDay"):
        day_ok = day_ok and u["overallUsageDay"] + cost <= u["overallLimitDay"] * fraction
    share15 = u["limit15"] * fraction
    used_before = u["usage15"] if window_used_before is None else window_used_before
    if u["usage15"] + cost > share15 and used_before == 0:
        return day_ok  # too big for the share, but alone in an empty quarter hour
    overall15_ok = (not u.get("overallLimit15")
                    or u["overallUsage15"] + cost <= u["overallLimit15"] * fraction)
    return u["usage15"] + cost <= share15 and overall15_ok and day_ok


def share15(snap: dict, fraction: float) -> float:
    """The 15-minute share a background job may use."""
    return current_usage(snap)["limit15"] * fraction
