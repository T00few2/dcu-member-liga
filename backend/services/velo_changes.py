"""Per-race vELO change tracking from ZwiftRacing.app event results.

For each Zwift event linked to a race, ``GET /public/results/<eventId>`` returns
every rider's vELO before and after the race. We store the change per rider on
``races/{raceId}.veloChanges`` and flag riders whose score jumped by more than
``VELO_JUMP_THRESHOLD`` points AND who ended above the grace limit of the liga
category they raced in.

ZR results are rate limited to 1 call/minute, so events are fetched
least-recently-first and a rate-limit stops the run with partial data saved;
re-running continues with the remaining events.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Callable, Iterable

from services.category_engine import CategoryList, effective_liga_category_name, get_category_by_name
from services.zwiftracing import RateLimitError, _zr_numeric

logger = logging.getLogger(__name__)

VELO_JUMP_THRESHOLD = 50

_RIDER_ID_KEYS = ("riderId", "zwiftId", "zwid", "id")
_BEFORE_KEYS = ("ratingBefore", "veloBefore", "before")
_AFTER_KEYS = ("rating", "ratingAfter", "veloAfter", "after")
_DELTA_KEYS = ("ratingDelta", "veloDelta", "delta")


def collect_race_event_ids(race_data: dict[str, Any]) -> list[str]:
    """All Zwift event ids for a race (single, linked, multi and grouped modes), de-duplicated."""
    ids: list[str] = []

    def _add(value: Any) -> None:
        s = str(value or "").strip()
        if s and s not in ids:
            ids.append(s)

    _add(race_data.get("eventId"))
    for linked in race_data.get("linkedEventIds") or []:
        _add(linked)
    for cfg in race_data.get("eventConfiguration") or []:
        _add((cfg or {}).get("eventId"))
    for grp in race_data.get("raceGroups") or []:
        _add((grp or {}).get("eventId"))
    return ids


def _first_number(row: dict[str, Any], keys: Iterable[str]) -> float | None:
    for key in keys:
        n = _zr_numeric(row.get(key))
        if n is not None:
            return n
    return None


def _result_rows(payload: Any) -> list[dict[str, Any]]:
    if isinstance(payload, list):
        return [r for r in payload if isinstance(r, dict)]
    if isinstance(payload, dict):
        for key in ("results", "riders", "data"):
            inner = payload.get(key)
            if isinstance(inner, (list, dict)) and inner is not payload:
                rows = _result_rows(inner)
                if rows:
                    return rows
    return []


def parse_zr_velo_rows(payload: Any) -> dict[str, dict[str, Any]]:
    """Map zwiftId -> {before, after, delta} from a ZR event results payload."""
    out: dict[str, dict[str, Any]] = {}
    for row in _result_rows(payload):
        zwift_id = next((str(row[k]).strip() for k in _RIDER_ID_KEYS if row.get(k) not in (None, "")), "")
        if not zwift_id:
            continue
        # Newer payloads may nest vELO under ``velo``; fall back to it.
        velo = row.get("velo") if isinstance(row.get("velo"), dict) else {}
        before = _first_number(row, _BEFORE_KEYS)
        if before is None:
            before = _first_number(velo, _BEFORE_KEYS)
        after = _first_number(row, _AFTER_KEYS)
        if after is None:
            after = _first_number(velo, _AFTER_KEYS)
        delta = _first_number(row, _DELTA_KEYS)
        if delta is None:
            delta = _first_number(velo, _DELTA_KEYS)
        if delta is None and before is not None and after is not None:
            delta = after - before
        if before is None and after is not None and delta is not None:
            before = after - delta
        if after is None and before is not None and delta is not None:
            after = before + delta
        if before is None and after is None and delta is None:
            continue
        out[zwift_id] = {
            "before": round(before, 1) if before is not None else None,
            "after": round(after, 1) if after is not None else None,
            "delta": round(delta, 1) if delta is not None else None,
        }
    return out


def grace_limit_for_category(
    category: str,
    grace_period: int,
    categories: CategoryList | None,
) -> int | None:
    """Upper boundary + grace for a liga category; None for the top category / unknown names."""
    found = get_category_by_name(category, categories) if category else None
    if not found or found[2] is None:
        return None
    return int(found[2]) + int(grace_period)


def is_velo_flagged(delta: float | None, after: float | None, grace_limit: int | None) -> bool:
    """Flag when the score rose more than the threshold and ended above the grace zone."""
    if delta is None or after is None or grace_limit is None:
        return False
    return delta > VELO_JUMP_THRESHOLD and after > grace_limit


def _race_result_categories(race_data: dict[str, Any]) -> dict[str, str]:
    """zwiftId -> liga category the rider was scored in."""
    out: dict[str, str] = {}
    for cat, rows in (race_data.get("results") or {}).items():
        for row in rows or []:
            zid = str((row or {}).get("zwiftId") or "").strip()
            if zid and zid not in out:
                out[zid] = str(cat)
    return out


def build_rider_entry(
    zwift_id: str,
    velo: dict[str, Any],
    event_id: str,
    race_category: str | None,
    user_liga_category: dict[str, Any] | None,
    grace_period: int,
    categories: CategoryList | None,
) -> dict[str, Any]:
    category = race_category or effective_liga_category_name(user_liga_category or {}, categories) or None
    grace_limit = grace_limit_for_category(category or "", grace_period, categories)
    return {
        **velo,
        "eventId": event_id,
        "category": category,
        "graceLimit": grace_limit,
        "flagged": is_velo_flagged(velo.get("delta"), velo.get("after"), grace_limit),
    }


def refresh_race_velo_changes(
    race_data: dict[str, Any],
    fetch_results: Callable[[str], Any],
    load_users_by_zwift_id: Callable[[Iterable[str]], dict[str, dict[str, Any]]],
    grace_period: int,
    categories: CategoryList | None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Fetch ZR results for the race's events and return the updated ``veloChanges`` doc.

    Returns a dict with keys ``veloChanges`` (to store), ``fetchedEvents``,
    ``pendingEvents`` and ``rateLimited``.
    """
    now_iso = (now or datetime.now(timezone.utc)).isoformat()
    existing = race_data.get("veloChanges") or {}
    events_meta: dict[str, Any] = dict(existing.get("events") or {})
    riders: dict[str, Any] = dict(existing.get("riders") or {})

    event_ids = collect_race_event_ids(race_data)
    # Never-fetched events first, then the stalest.
    event_ids.sort(key=lambda eid: str((events_meta.get(eid) or {}).get("fetchedAt") or ""))

    result_cats = _race_result_categories(race_data)
    fetched: list[str] = []
    rate_limited = False

    for event_id in event_ids:
        try:
            payload = fetch_results(event_id)
        except RateLimitError:
            rate_limited = True
            break
        velo_rows = parse_zr_velo_rows(payload)
        if result_cats:
            velo_rows = {zid: v for zid, v in velo_rows.items() if zid in result_cats}
        users = load_users_by_zwift_id([zid for zid in velo_rows if zid not in result_cats]) if velo_rows else {}
        if not result_cats:
            # No scored results yet: keep league members only, not the whole Zwift field.
            velo_rows = {zid: v for zid, v in velo_rows.items() if zid in users}
        for zid, velo in velo_rows.items():
            riders[zid] = build_rider_entry(
                zid,
                velo,
                event_id,
                result_cats.get(zid),
                (users.get(zid) or {}).get("ligaCategory"),
                grace_period,
                categories,
            )
        events_meta[event_id] = {
            "fetchedAt": now_iso,
            "riderCount": len(velo_rows),
            "available": payload is not None,
        }
        fetched.append(event_id)

    # Riders may have moved category since the last fetch (e.g. after a recalculation).
    for zid, entry in riders.items():
        cat = result_cats.get(zid)
        if cat and cat != entry.get("category"):
            riders[zid] = build_rider_entry(
                zid, entry, entry.get("eventId") or "", cat, None, grace_period, categories
            )

    pending = [eid for eid in event_ids if eid not in fetched]
    return {
        "veloChanges": {
            "updatedAt": now_iso,
            "threshold": VELO_JUMP_THRESHOLD,
            "flaggedCount": sum(1 for r in riders.values() if r.get("flagged")),
            "events": events_meta,
            "riders": riders,
        },
        "fetchedEvents": fetched,
        "pendingEvents": pending,
        "rateLimited": rate_limited,
    }
