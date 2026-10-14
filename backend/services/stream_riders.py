"""Zwift-only stream dummy riders (not liga users or race signups).

The roster is league-wide: one signup is registered on every current and upcoming race.
"""
from __future__ import annotations

import logging
import re
from datetime import datetime, timedelta, timezone
from typing import Any

from extensions import db, get_zwift_service
from services.category_engine import ZR_CATEGORIES
from services.liga_categories_core import _load_liga_settings
from services.race_signups import (
    SignupError,
    _batch_register,
    _batch_unregister,
    parse_race_date,
    resolve_target,
)
from services.results.constants import MAX_LIVE_RACE_WINDOW_MINUTES

logger = logging.getLogger(__name__)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

STREAM_REGISTERED = "registered"
STREAM_FAILED = "failed"
STREAM_PARTIAL = "partial"
STREAM_PENDING = "pending"
STREAM_SKIPPED = "skipped"

_NO_EVENT = "No event/subgroup configuration found for rider category"


class StreamRiderError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _roster_col():
    return db.collection("streamRiders")


def _legacy_col(race_id: str):
    return db.collection("races").document(str(race_id)).collection("streamRiders")


def is_public_uuid(value: str) -> bool:
    return bool(_UUID_RE.match((value or "").strip()))


def default_stream_category(db_client=None) -> str:
    settings = _load_liga_settings(db_client or db)
    cats = settings.get("categories")
    if isinstance(cats, list) and cats:
        name = str((cats[0] or {}).get("name") or "").strip()
        if name:
            return name
    return ZR_CATEGORIES[0][0]


def resolve_public_id(zwift_id: str, public_id: str | None) -> str:
    zid = str(zwift_id or "").strip()
    pid = str(public_id or "").strip()
    if is_public_uuid(pid):
        return pid
    if is_public_uuid(zid):
        return zid
    raise StreamRiderError(
        "Zwift public UUID is required (batch-register does not accept numeric profile ids).",
        400,
    )


def _race_still_open(race_data: dict[str, Any]) -> bool:
    """Finished races are left alone. Missing dates are treated as still open."""
    start = parse_race_date(race_data.get("date"))
    if start is None:
        return True
    if start.tzinfo is None:
        start = start.replace(tzinfo=timezone.utc)
    deadline = start + timedelta(minutes=MAX_LIVE_RACE_WINDOW_MINUTES)
    return deadline >= datetime.now(timezone.utc)


def _load_races() -> list[tuple[str, dict[str, Any]]]:
    rows: list[tuple[str, dict[str, Any]]] = []
    if not db:
        return rows
    for doc in db.collection("races").stream():
        if hasattr(doc, "exists") and not doc.exists:
            continue
        data = doc.to_dict() or {}
        rows.append((str(doc.id), data))
    return rows


def _summarize(registrations: dict[str, dict[str, Any]]) -> tuple[str, str, int, int]:
    registered = 0
    attempted = 0
    failed_msgs: list[str] = []
    for row in registrations.values():
        status = str(row.get("status") or "")
        if status == STREAM_SKIPPED:
            continue
        attempted += 1
        if status == STREAM_REGISTERED:
            registered += 1
        elif status == STREAM_FAILED:
            name = str(row.get("raceName") or "race")
            err = str(row.get("lastError") or "failed")
            failed_msgs.append(f"{name}: {err}")
    if attempted == 0:
        status = STREAM_PENDING
    elif registered == attempted:
        status = STREAM_REGISTERED
    elif registered == 0:
        status = STREAM_FAILED
    else:
        status = STREAM_PARTIAL
    return status, "; ".join(failed_msgs), registered, attempted


def _persist_rider(
    zid: str,
    *,
    public_id: str,
    category: str,
    added_at: str,
    registrations: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    status, last_error, registered_count, race_count = _summarize(registrations)
    payload = {
        "zwiftId": zid,
        "publicId": public_id,
        "category": category,
        "addedAt": added_at,
        "status": status,
        "lastError": last_error,
        "registeredCount": registered_count,
        "raceCount": race_count,
        "registrations": registrations,
    }
    _roster_col().document(zid).set(payload)
    return payload


def _delete_legacy(zid: str) -> None:
    for race_id, _data in _load_races():
        ref = _legacy_col(race_id).document(zid)
        snap = ref.get()
        if getattr(snap, "exists", False):
            ref.delete()


def import_legacy_stream_riders() -> int:
    """Copy per-race streamRiders docs into the league roster and delete them."""
    if not db:
        return 0
    imported = 0
    for race_id, race_data in _load_races():
        race_name = str(race_data.get("name") or race_id)
        for rider_doc in _legacy_col(race_id).stream():
            if hasattr(rider_doc, "exists") and not rider_doc.exists:
                continue
            data = rider_doc.to_dict() or {}
            zid = str(data.get("zwiftId") or rider_doc.id or "").strip()
            if not zid:
                continue
            ref = _roster_col().document(zid)
            existing_snap = ref.get()
            existing = existing_snap.to_dict() if getattr(existing_snap, "exists", False) else {}
            regs = dict((existing or {}).get("registrations") or {})
            if race_id not in regs and data.get("status"):
                regs[race_id] = {
                    "status": str(data.get("status") or ""),
                    "subgroupId": str(data.get("subgroupId") or ""),
                    "eventId": str(data.get("eventId") or ""),
                    "publicId": str(data.get("publicId") or ""),
                    "lastError": str(data.get("lastError") or ""),
                    "zwiftRegisteredAt": str(data.get("zwiftRegisteredAt") or ""),
                    "raceName": race_name,
                }
            _persist_rider(
                zid,
                public_id=str((existing or {}).get("publicId") or data.get("publicId") or ""),
                category=str((existing or {}).get("category") or data.get("category") or ""),
                added_at=str((existing or {}).get("addedAt") or data.get("addedAt") or _iso_now()),
                registrations=regs,
            )
            legacy_ref = _legacy_col(race_id).document(str(rider_doc.id))
            legacy_snap = legacy_ref.get()
            if getattr(legacy_snap, "exists", False):
                legacy_ref.delete()
            imported += 1
    return imported


def _ids_from_rider(data: dict[str, Any], doc_id: str) -> set[str]:
    hidden: set[str] = set()
    for raw in (data.get("publicId"), data.get("zwiftId"), doc_id):
        value = str(raw or "").strip()
        if value:
            hidden.add(value.lower())
    return hidden


def stream_rider_hide_ids(race_id: str | None = None) -> set[str]:
    """Ids to drop from live-riders on every race."""
    hidden: set[str] = set()
    if not db:
        return hidden
    try:
        for doc in _roster_col().stream():
            if hasattr(doc, "exists") and not doc.exists:
                continue
            hidden |= _ids_from_rider(doc.to_dict() or {}, str(doc.id))
    except Exception:
        logger.debug("Could not read stream rider roster", exc_info=True)
    if race_id:
        try:
            for doc in _legacy_col(race_id).stream():
                if hasattr(doc, "exists") and not doc.exists:
                    continue
                hidden |= _ids_from_rider(doc.to_dict() or {}, str(doc.id))
        except Exception:
            logger.debug("Could not read legacy stream riders for %s", race_id, exc_info=True)
    return hidden


def _read_rows() -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for doc in _roster_col().stream():
        if hasattr(doc, "exists") and not doc.exists:
            continue
        data = doc.to_dict() or {}
        data["zwiftId"] = str(data.get("zwiftId") or doc.id)
        rows.append(data)
    rows.sort(key=lambda r: (str(r.get("category") or ""), str(r.get("zwiftId") or "")))
    return rows


def list_stream_riders(zwift_service=None) -> list[dict[str, Any]]:
    if not db:
        return []
    import_legacy_stream_riders()
    races = _load_races()
    pending: list[tuple[dict[str, Any], list[tuple[str, dict[str, Any]]]]] = []
    for row in _read_rows():
        regs = row.get("registrations") if isinstance(row.get("registrations"), dict) else {}
        missing = [(race_id, data) for race_id, data in races if race_id not in regs]
        if missing and str(row.get("publicId") or "").strip():
            pending.append((row, missing))
    if pending:
        try:
            svc = zwift_service or get_zwift_service()
        except Exception:
            logger.warning("Stream rider sync skipped; Zwift service unavailable", exc_info=True)
            return _read_rows()
        for row, missing in pending:
            try:
                _sync_rider(
                    zwift_id=str(row.get("zwiftId") or ""),
                    public_id=str(row.get("publicId") or ""),
                    category=str(row.get("category") or "") or default_stream_category(db),
                    added_at=str(row.get("addedAt") or "") or _iso_now(),
                    races=missing,
                    previous=dict(row.get("registrations") or {}),
                    zwift_service=svc,
                    strict=False,
                )
            except StreamRiderError:
                logger.info("Stream rider %s was not fully registered", row.get("zwiftId"))
            except Exception:
                logger.exception("Stream rider sync failed for %s", row.get("zwiftId"))
    return _read_rows()


def _refuse_complete_liga_user(zwift_id: str) -> None:
    if not db:
        return
    doc = db.collection("users").document(str(zwift_id)).get()
    if not doc.exists:
        return
    status = str(((doc.to_dict() or {}).get("registration") or {}).get("status") or "")
    if status == "complete":
        raise StreamRiderError(
            "This Zwift ID is a registered liga member. Use Tilmeld, not stream riders.",
            403,
        )


def _reg_row(
    *,
    status: str,
    race_name: str,
    subgroup_id: str = "",
    event_id: str = "",
    public_id: str = "",
    last_error: str = "",
    zwift_registered_at: str = "",
) -> dict[str, Any]:
    return {
        "status": status,
        "raceName": race_name,
        "subgroupId": str(subgroup_id or ""),
        "eventId": str(event_id or ""),
        "publicId": public_id,
        "lastError": last_error,
        "zwiftRegisteredAt": zwift_registered_at,
    }


def _safe_unregister(svc, subgroup_id: str, public_id: str) -> int:
    if not subgroup_id or not public_id:
        return 200
    status_code, _payload = _batch_unregister(svc, subgroup_id, [public_id])
    return status_code


def _apply_one_race(
    svc,
    *,
    public_id: str,
    category: str,
    race_id: str,
    race_data: dict[str, Any],
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    """Register this rider on one race. May include ``unknown=True``."""
    race_name = str(race_data.get("name") or race_id)
    prev = dict(previous or {})
    if not _race_still_open(race_data):
        if str(prev.get("status") or "") == STREAM_REGISTERED and str(prev.get("subgroupId") or ""):
            kept = dict(prev)
            kept.setdefault("raceName", race_name)
            return kept
        return _reg_row(status=STREAM_SKIPPED, race_name=race_name)
    try:
        subgroup_id, event_id, err = resolve_target(race_data, category, svc)
    except SignupError as exc:
        return _reg_row(status=STREAM_FAILED, race_name=race_name, last_error=exc.message)

    event_id_s = str(event_id or "")
    if not subgroup_id:
        old_sg = str(prev.get("subgroupId") or "")
        if str(prev.get("status") or "") == STREAM_REGISTERED and old_sg:
            _safe_unregister(svc, old_sg, str(prev.get("publicId") or public_id))
        if not err or _NO_EVENT in str(err):
            return _reg_row(status=STREAM_SKIPPED, race_name=race_name, last_error=str(err or ""))
        return _reg_row(status=STREAM_FAILED, race_name=race_name, event_id=event_id_s, last_error=str(err))

    subgroup_id = str(subgroup_id)
    old_sg = str(prev.get("subgroupId") or "")
    old_pid = str(prev.get("publicId") or "")
    same_pen = (
        str(prev.get("status") or "") == STREAM_REGISTERED
        and old_sg == subgroup_id
        and (not old_pid or old_pid.lower() == public_id.lower())
    )
    if same_pen:
        kept = _reg_row(
            status=STREAM_REGISTERED,
            race_name=race_name,
            subgroup_id=subgroup_id,
            event_id=event_id_s or str(prev.get("eventId") or ""),
            public_id=public_id,
            zwift_registered_at=str(prev.get("zwiftRegisteredAt") or ""),
        )
        return kept

    if str(prev.get("status") or "") == STREAM_REGISTERED and old_sg and old_sg != subgroup_id:
        code = _safe_unregister(svc, old_sg, old_pid or public_id)
        if code != 200:
            return _reg_row(
                status=STREAM_FAILED,
                race_name=race_name,
                subgroup_id=old_sg,
                event_id=str(prev.get("eventId") or event_id_s),
                public_id=old_pid or public_id,
                last_error=f"Zwift unregister failed ({code})",
                zwift_registered_at=str(prev.get("zwiftRegisteredAt") or ""),
            )

    status_code, zwift_payload = _batch_register(svc, subgroup_id, [public_id])
    unknown = zwift_payload.get("unknownPublicIds") if isinstance(zwift_payload, dict) else None
    now = _iso_now()
    if status_code != 200:
        return _reg_row(
            status=STREAM_FAILED,
            race_name=race_name,
            subgroup_id=subgroup_id,
            event_id=event_id_s,
            public_id=public_id,
            last_error=f"Zwift register failed ({status_code})",
        )
    if isinstance(unknown, list) and any(str(x).strip().lower() == public_id.lower() for x in unknown):
        _safe_unregister(svc, subgroup_id, public_id)
        row = _reg_row(
            status=STREAM_FAILED,
            race_name=race_name,
            subgroup_id=subgroup_id,
            event_id=event_id_s,
            public_id=public_id,
            last_error="Zwift did not recognize this public UUID (unknownPublicIds)",
        )
        row["unknown"] = True
        return row
    row = _reg_row(
        status=STREAM_REGISTERED,
        race_name=race_name,
        subgroup_id=subgroup_id,
        event_id=event_id_s,
        public_id=public_id,
        zwift_registered_at=now,
    )
    row["fresh"] = True
    return row


def _failure_status_code(last_error: str) -> int:
    text = last_error or ""
    if "unknownPublicIds" in text or "public UUID" in text:
        return 400
    if "Zwift register failed" in text or "Zwift unregister failed" in text:
        return 502
    return 400


def _sync_rider(
    *,
    zwift_id: str,
    public_id: str,
    category: str,
    added_at: str,
    races: list[tuple[str, dict[str, Any]]],
    previous: dict[str, dict[str, Any]],
    zwift_service,
    strict: bool,
) -> dict[str, Any]:
    registrations = dict(previous)
    fresh: list[tuple[str, str, str]] = []
    unknown_error = ""
    for race_id, race_data in races:
        row = _apply_one_race(
            zwift_service,
            public_id=public_id,
            category=category,
            race_id=race_id,
            race_data=race_data,
            previous=registrations.get(race_id),
        )
        unknown = bool(row.pop("unknown", False))
        fresh_now = bool(row.pop("fresh", False))
        registrations[race_id] = row
        if unknown:
            unknown_error = str(row.get("lastError") or "unknown public UUID")
            for prev_race_id, subgroup_id, pid in fresh:
                _safe_unregister(zwift_service, subgroup_id, pid)
                prev_row = dict(registrations.get(prev_race_id) or {})
                prev_row["status"] = STREAM_FAILED
                prev_row["lastError"] = unknown_error
                prev_row["zwiftRegisteredAt"] = ""
                registrations[prev_race_id] = prev_row
            break
        if fresh_now and row.get("status") == STREAM_REGISTERED:
            fresh.append((race_id, str(row.get("subgroupId") or ""), public_id))

    payload = _persist_rider(
        zwift_id,
        public_id=public_id,
        category=category,
        added_at=added_at,
        registrations=registrations,
    )
    _delete_legacy(zwift_id)
    if strict and unknown_error:
        raise StreamRiderError(unknown_error, 400)
    if strict and payload.get("status") == STREAM_FAILED:
        raise StreamRiderError(
            str(payload.get("lastError") or "Sign up failed"),
            _failure_status_code(str(payload.get("lastError") or "")),
        )
    return payload


def add_stream_rider(
    *,
    zwift_id: str,
    public_id: str | None = None,
    category: str | None = None,
    zwift_service=None,
    race_id: str | None = None,
) -> dict[str, Any]:
    """Register the rider on every current race. ``race_id`` is ignored."""
    del race_id
    if not db:
        raise StreamRiderError("DB not available", 500)

    zid = str(zwift_id or "").strip()
    if not zid:
        raise StreamRiderError("zwiftId is required", 400)

    _refuse_complete_liga_user(zid)
    pid = resolve_public_id(zid, public_id)
    cat = str(category or "").strip() or default_stream_category(db)
    import_legacy_stream_riders()

    existing_snap = _roster_col().document(zid).get()
    existing = existing_snap.to_dict() if getattr(existing_snap, "exists", False) else {}
    added_at = str((existing or {}).get("addedAt") or "") or _iso_now()
    previous = dict((existing or {}).get("registrations") or {})
    svc = zwift_service or get_zwift_service()
    return _sync_rider(
        zwift_id=zid,
        public_id=pid,
        category=cat,
        added_at=added_at,
        races=_load_races(),
        previous=previous,
        zwift_service=svc,
        strict=True,
    )


def apply_stream_riders_to_race(
    race_id: str,
    race_data: dict[str, Any],
    zwift_service=None,
) -> dict[str, Any]:
    """Register the current roster on one race. Never raises."""
    summary = {"registered": 0, "failed": 0, "skipped": 0, "errors": []}
    if not db:
        return summary
    try:
        import_legacy_stream_riders()
        riders = [
            doc for doc in _roster_col().stream()
            if not (hasattr(doc, "exists") and not doc.exists)
        ]
        if not riders:
            return summary
        svc = zwift_service or get_zwift_service()
    except Exception as exc:
        logger.warning("Stream rider apply skipped race=%s: %s", race_id, exc)
        summary["errors"].append(str(exc))
        return summary

    for doc in riders:
        data = doc.to_dict() or {}
        zid = str(data.get("zwiftId") or doc.id or "").strip()
        if not zid:
            continue
        try:
            payload = _sync_rider(
                zwift_id=zid,
                public_id=str(data.get("publicId") or ""),
                category=str(data.get("category") or "") or default_stream_category(db),
                added_at=str(data.get("addedAt") or "") or _iso_now(),
                races=[(str(race_id), race_data)],
                previous=dict(data.get("registrations") or {}),
                zwift_service=svc,
                strict=False,
            )
        except Exception as exc:
            summary["failed"] += 1
            summary["errors"].append(f"{zid}: {exc}")
            continue
        reg = (payload.get("registrations") or {}).get(str(race_id)) or {}
        status = str(reg.get("status") or "")
        if status == STREAM_REGISTERED:
            summary["registered"] += 1
        elif status == STREAM_FAILED:
            summary["failed"] += 1
            summary["errors"].append(f"{zid}: {reg.get('lastError') or 'failed'}")
        else:
            summary["skipped"] += 1
    return summary


def remove_stream_rider(
    zwift_id: str,
    *,
    zwift_service=None,
    race_id: str | None = None,
) -> dict[str, Any]:
    """Unregister the rider from every race pen. ``race_id`` is ignored."""
    del race_id
    if not db:
        raise StreamRiderError("DB not available", 500)

    zid = str(zwift_id or "").strip()
    import_legacy_stream_riders()
    ref = _roster_col().document(zid)
    doc = ref.get()
    if not getattr(doc, "exists", False):
        _delete_legacy(zid)
        return {"status": "absent", "zwiftId": zid}

    data = doc.to_dict() or {}
    registrations = data.get("registrations") if isinstance(data.get("registrations"), dict) else {}
    pid_default = str(data.get("publicId") or "").strip()
    svc = None
    failures: list[str] = []
    for race_key, reg in registrations.items():
        if not isinstance(reg, dict):
            continue
        if str(reg.get("status") or "") != STREAM_REGISTERED:
            continue
        subgroup_id = str(reg.get("subgroupId") or "").strip()
        pid = str(reg.get("publicId") or pid_default).strip()
        if not subgroup_id or not pid:
            continue
        if svc is None:
            svc = zwift_service or get_zwift_service()
        status_code = _safe_unregister(svc, subgroup_id, pid)
        if status_code != 200:
            name = str(reg.get("raceName") or race_key)
            failures.append(f"{name}: Zwift unregister failed ({status_code})")

    if failures:
        message = "; ".join(failures)
        ref.set({"status": STREAM_FAILED, "lastError": message}, merge=True)
        raise StreamRiderError(message, 502)

    ref.delete()
    _delete_legacy(zid)
    return {"status": "removed", "zwiftId": zid}
