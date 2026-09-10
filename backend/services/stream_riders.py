"""Zwift-only stream dummy riders (not liga users or race signups)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any

from extensions import db, get_zwift_service
from services.category_engine import ZR_CATEGORIES
from services.liga_categories_core import _load_liga_settings
from services.race_signups import (
    SignupError,
    _batch_register,
    _batch_unregister,
    resolve_target,
)

_UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.IGNORECASE,
)

STREAM_REGISTERED = "registered"
STREAM_FAILED = "failed"


class StreamRiderError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _col(race_id: str):
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


def stream_rider_hide_ids(race_id: str) -> set[str]:
    """Ids to drop from live-riders: public UUID and numeric zwiftId."""
    hidden: set[str] = set()
    if not db:
        return hidden
    for doc in _col(race_id).stream():
        data = doc.to_dict() or {}
        for raw in (data.get("publicId"), data.get("zwiftId"), doc.id):
            value = str(raw or "").strip()
            if value:
                hidden.add(value.lower())
    return hidden


def list_stream_riders(race_id: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for doc in _col(race_id).stream():
        data = doc.to_dict() or {}
        data["zwiftId"] = str(data.get("zwiftId") or doc.id)
        rows.append(data)
    rows.sort(key=lambda r: (str(r.get("category") or ""), str(r.get("zwiftId") or "")))
    return rows


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


def add_stream_rider(
    race_id: str,
    *,
    zwift_id: str,
    public_id: str | None = None,
    category: str | None = None,
    zwift_service=None,
) -> dict[str, Any]:
    if not db:
        raise StreamRiderError("DB not available", 500)

    zid = str(zwift_id or "").strip()
    if not zid:
        raise StreamRiderError("zwiftId is required", 400)

    _refuse_complete_liga_user(zid)
    pid = resolve_public_id(zid, public_id)

    race_doc = db.collection("races").document(str(race_id)).get()
    if not race_doc.exists:
        raise StreamRiderError("Race not found", 404)
    race_data = race_doc.to_dict() or {}

    cat = str(category or "").strip() or default_stream_category(db)
    svc = zwift_service or get_zwift_service()

    existing_doc = _col(race_id).document(zid).get()
    existing = existing_doc.to_dict() if existing_doc.exists else None

    try:
        subgroup_id, event_id, err = resolve_target(race_data, cat, svc)
    except SignupError as e:
        raise StreamRiderError(e.message, e.status_code) from e

    now = _iso_now()
    base = {
        "zwiftId": zid,
        "raceId": str(race_id),
        "publicId": pid,
        "category": cat,
        "addedAt": (existing or {}).get("addedAt") or now,
        "subgroupId": str(subgroup_id or ""),
        "eventId": str(event_id or ""),
    }

    if not subgroup_id:
        payload = {
            **base,
            "status": STREAM_FAILED,
            "lastError": err or "No event/subgroup configuration found for rider category",
        }
        _col(race_id).document(zid).set(payload, merge=True)
        raise StreamRiderError(payload["lastError"], 400)

    status_code, zwift_payload = _batch_register(svc, str(subgroup_id), [pid])
    unknown = zwift_payload.get("unknownPublicIds") if isinstance(zwift_payload, dict) else None
    if status_code != 200:
        payload = {
            **base,
            "status": STREAM_FAILED,
            "lastError": f"Zwift register failed ({status_code})",
        }
        _col(race_id).document(zid).set(payload, merge=True)
        raise StreamRiderError(payload["lastError"], 502)

    if isinstance(unknown, list) and any(str(x).strip().lower() == pid.lower() for x in unknown):
        payload = {
            **base,
            "status": STREAM_FAILED,
            "lastError": "Zwift did not recognize this public UUID (unknownPublicIds)",
        }
        _col(race_id).document(zid).set(payload, merge=True)
        raise StreamRiderError(payload["lastError"], 400)

    payload = {
        **base,
        "status": STREAM_REGISTERED,
        "zwiftRegisteredAt": now,
        "lastError": "",
    }
    _col(race_id).document(zid).set(payload, merge=True)
    return payload


def remove_stream_rider(
    race_id: str,
    zwift_id: str,
    *,
    zwift_service=None,
) -> dict[str, Any]:
    if not db:
        raise StreamRiderError("DB not available", 500)

    zid = str(zwift_id or "").strip()
    ref = _col(race_id).document(zid)
    doc = ref.get()
    if not doc.exists:
        return {"status": "absent", "zwiftId": zid}

    data = doc.to_dict() or {}
    pid = str(data.get("publicId") or "").strip()
    subgroup_id = str(data.get("subgroupId") or "").strip()
    status = str(data.get("status") or "")

    if status == STREAM_REGISTERED and subgroup_id and pid:
        svc = zwift_service or get_zwift_service()
        status_code, _payload = _batch_unregister(svc, subgroup_id, [pid])
        if status_code != 200:
            ref.set(
                {
                    "status": STREAM_FAILED,
                    "lastError": f"Zwift unregister failed ({status_code})",
                },
                merge=True,
            )
            raise StreamRiderError(f"Zwift unregister failed ({status_code})", 502)

    ref.delete()
    return {"status": "removed", "zwiftId": zid}
