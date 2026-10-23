"""League race signup persistence and Zwift sync.

Firestore is the roster. Zwift batch-register/unregister is write-only.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import pytz

from extensions import db, get_zwift_service

import logging

logger = logging.getLogger(__name__)

_COPENHAGEN_TZ = pytz.timezone("Europe/Copenhagen")
_BATCH_SIZE = 250
SIGNUP_PENDING = "pending"
SIGNUP_REGISTERED = "registered"
SIGNUP_FAILED = "failed"


class SignupError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_race_date(date_val: Any) -> datetime | None:
    """Parse race.date; naive strings are Europe/Copenhagen local time."""
    if date_val is None:
        return None
    if isinstance(date_val, datetime):
        return date_val if date_val.tzinfo else date_val.replace(tzinfo=timezone.utc)
    if hasattr(date_val, "seconds") and not isinstance(date_val, str):
        return datetime.fromtimestamp(date_val.seconds, tz=timezone.utc)
    if isinstance(date_val, dict) and "seconds" in date_val:
        try:
            return datetime.fromtimestamp(float(date_val["seconds"]), tz=timezone.utc)
        except (TypeError, ValueError):
            return None
    if isinstance(date_val, str):
        try:
            dt = datetime.fromisoformat(date_val.replace("Z", "+00:00"))
            if dt.tzinfo is None:
                dt = _COPENHAGEN_TZ.localize(dt)
            return dt.astimezone(timezone.utc)
        except (ValueError, AttributeError):
            return None
    return None


def is_race_past(race_data: dict[str, Any], now: datetime | None = None) -> bool:
    race_date = parse_race_date(race_data.get("date"))
    if race_date is None:
        return False
    now_utc = now or datetime.now(timezone.utc)
    if now_utc.tzinfo is None:
        now_utc = now_utc.replace(tzinfo=timezone.utc)
    return race_date < now_utc


def event_mode(race_data: dict[str, Any]) -> str:
    return str(race_data.get("eventMode") or "single").strip().lower()


def pre_register_allowed(race_data: dict[str, Any]) -> bool:
    return bool(race_data.get("preRegisterAllowed"))


def race_has_event_id(race_data: dict[str, Any]) -> bool:
    if str(race_data.get("eventId") or "").strip():
        return True
    for cfg in race_data.get("eventConfiguration") or []:
        if isinstance(cfg, dict) and str(cfg.get("eventId") or "").strip():
            return True
    for group in race_data.get("raceGroups") or []:
        if isinstance(group, dict) and str(group.get("eventId") or "").strip():
            return True
    return False


def _signups_col(race_id: str):
    return db.collection("races").document(str(race_id)).collection("signups")


def _zwift_user_id(user_data: dict[str, Any]) -> str:
    return str(
        user_data.get("zwiftUserId")
        or ((user_data.get("connections") or {}).get("zwift") or {}).get("userId")
        or ""
    ).strip()


def _zwift_id(user_data: dict[str, Any], user_doc_id: str) -> str:
    return str(user_data.get("zwiftId") or user_doc_id or "").strip()


def _extract_zwift_message(payload: Any) -> str | None:
    if not isinstance(payload, dict):
        return None
    for key in ("message", "error", "detail", "description"):
        value = payload.get(key)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


def _routing():
    from routes import races as races_mod

    return races_mod


def resolve_target(
    race_data: dict[str, Any],
    user_category: str,
    zwift_service,
) -> tuple[str | None, str | None, str | None]:
    """Return (subgroup_id, event_id, error_message)."""
    races_mod = _routing()
    _sg, event_id, _secret = races_mod._pick_mode_config_for_user(race_data, user_category)
    subgroup_id, error = races_mod._resolve_signup_subgroup_id(race_data, user_category, zwift_service)
    return subgroup_id, (str(event_id).strip() or None) if event_id else None, error


def _needs_category_for_event(race_data: dict[str, Any]) -> bool:
    return event_mode(race_data) in {"multi", "grouped"}


def _batch_register(zwift_service, subgroup_id: str, public_ids: list[str]) -> tuple[int, dict[str, Any]]:
    unknown: list[str] = []
    last_status = 200
    last_payload: dict[str, Any] = {}
    for i in range(0, len(public_ids), _BATCH_SIZE):
        chunk = public_ids[i:i + _BATCH_SIZE]
        last_status, last_payload = zwift_service.batch_register_participants(
            event_subgroup_id=subgroup_id,
            public_ids=chunk,
        )
        if last_status != 200:
            return last_status, last_payload if isinstance(last_payload, dict) else {}
        ids = last_payload.get("unknownPublicIds") if isinstance(last_payload, dict) else None
        if isinstance(ids, list):
            unknown.extend(str(x) for x in ids)
    return 200, {"unknownPublicIds": unknown}


def _batch_unregister(zwift_service, subgroup_id: str, public_ids: list[str]) -> tuple[int, dict[str, Any]]:
    last_status = 200
    last_payload: dict[str, Any] = {}
    for i in range(0, len(public_ids), _BATCH_SIZE):
        chunk = public_ids[i:i + _BATCH_SIZE]
        last_status, last_payload = zwift_service.batch_unregister_participants(
            event_subgroup_id=subgroup_id,
            public_ids=chunk,
        )
        if last_status != 200:
            return last_status, last_payload if isinstance(last_payload, dict) else {}
    return last_status, last_payload if isinstance(last_payload, dict) else {}


def _write_signup(race_id: str, zwift_id: str, payload: dict[str, Any]) -> None:
    _signups_col(race_id).document(str(zwift_id)).set(payload, merge=True)


def _register_one(
    *,
    race_id: str,
    race_data: dict[str, Any],
    user_data: dict[str, Any],
    user_doc_id: str,
    zwift_service,
    existing: dict[str, Any] | None,
) -> dict[str, Any]:
    races_mod = _routing()
    user_category = races_mod._resolve_effective_user_category(user_data.get("ligaCategory"))
    zwift_id = _zwift_id(user_data, user_doc_id)
    zwift_user_id = _zwift_user_id(user_data)
    name = str(user_data.get("name") or "").strip()
    club = str(user_data.get("club") or "").strip()
    now = _iso_now()

    base = {
        "zwiftId": zwift_id,
        "raceId": str(race_id),
        "zwiftUserId": zwift_user_id,
        "name": name,
        "club": club,
        "ligaCategory": user_category,
        "signedUpAt": (existing or {}).get("signedUpAt") or now,
    }

    current_status = str((existing or {}).get("status") or "")
    stored_sg = str((existing or {}).get("subgroupId") or "").strip()

    subgroup_id, event_id, subgroup_error = resolve_target(race_data, user_category, zwift_service)
    event_ready = bool(subgroup_id)

    if not event_ready:
        if pre_register_allowed(race_data):
            if _needs_category_for_event(race_data) and race_has_event_id(race_data) and not user_category:
                payload = {
                    **base,
                    "status": SIGNUP_FAILED,
                    "lastError": "No liga category assigned yet — cannot pick a Zwift pen.",
                    "subgroupId": stored_sg,
                    "eventId": str((existing or {}).get("eventId") or ""),
                }
                _write_signup(race_id, zwift_id, payload)
                raise SignupError(payload["lastError"], 400)
            payload = {
                **base,
                "status": SIGNUP_PENDING,
                "lastError": "",
                "subgroupId": stored_sg,
                "eventId": str((existing or {}).get("eventId") or event_id or ""),
            }
            _write_signup(race_id, zwift_id, payload)
            return {
                "status": SIGNUP_PENDING,
                "message": "Tilmeldt — du tilmeldes på Zwift når løbet er oprettet.",
                "subgroupId": None,
            }
        raise SignupError(subgroup_error or "No event/subgroup configuration found for rider category", 400)

    if current_status == SIGNUP_REGISTERED and stored_sg and stored_sg == str(subgroup_id):
        return {
            "status": SIGNUP_REGISTERED,
            "message": "Allerede tilmeldt.",
            "subgroupId": stored_sg,
        }

    if _needs_category_for_event(race_data) and not user_category:
        payload = {
            **base,
            "status": SIGNUP_FAILED,
            "lastError": "No liga category assigned yet — cannot pick a Zwift pen.",
            "subgroupId": stored_sg,
            "eventId": str(event_id or ""),
        }
        _write_signup(race_id, zwift_id, payload)
        raise SignupError(payload["lastError"], 400)

    status_code, zwift_payload = _batch_register(zwift_service, str(subgroup_id), [zwift_user_id])
    unknown_ids = zwift_payload.get("unknownPublicIds") if isinstance(zwift_payload, dict) else None
    unknown_ids = unknown_ids if isinstance(unknown_ids, list) else []

    if status_code != 200:
        err = _extract_zwift_message(zwift_payload) or f"Zwift signup failed ({status_code})"
        payload = {
            **base,
            "status": SIGNUP_FAILED,
            "lastError": err,
            "subgroupId": stored_sg,
            "eventId": str(event_id or ""),
        }
        _write_signup(race_id, zwift_id, payload)
        http = status_code if status_code in {400, 401, 403, 404, 409, 422, 500} else 502
        raise SignupError(err, http)

    if zwift_user_id in unknown_ids:
        payload = {
            **base,
            "status": SIGNUP_FAILED,
            "lastError": "Zwift did not recognize your public ID.",
            "subgroupId": str(subgroup_id),
            "eventId": str(event_id or ""),
        }
        _write_signup(race_id, zwift_id, payload)
        return {
            "status": SIGNUP_FAILED,
            "message": payload["lastError"],
            "subgroupId": str(subgroup_id),
            "unknownPublicIds": unknown_ids,
        }

    payload = {
        **base,
        "status": SIGNUP_REGISTERED,
        "lastError": "",
        "subgroupId": str(subgroup_id),
        "eventId": str(event_id or ""),
        "zwiftRegisteredAt": now,
    }
    _write_signup(race_id, zwift_id, payload)
    return {
        "status": SIGNUP_REGISTERED,
        "message": "Signup completed in Zwift.",
        "subgroupId": str(subgroup_id),
        "unknownPublicIds": unknown_ids,
    }


def signup_rider(race_id: str, user_doc_id: str, user_data: dict[str, Any]) -> dict[str, Any]:
    if not db:
        raise SignupError("DB not available", 500)
    race_doc = db.collection("races").document(str(race_id)).get()
    if not race_doc.exists:
        raise SignupError("Race not found", 404)
    race_data = race_doc.to_dict() or {}

    if is_race_past(race_data):
        raise SignupError("Cannot sign up for a past race", 400)

    if str(((user_data.get("registration") or {}).get("status") or "")).strip().lower() != "complete":
        raise SignupError("User is not fully registered", 403)

    zwift_user_id = _zwift_user_id(user_data)
    if not zwift_user_id:
        raise SignupError("Missing zwiftUserId. Reconnect Zwift first.", 400)

    zwift_id = _zwift_id(user_data, user_doc_id)
    if not zwift_id:
        raise SignupError("Missing zwiftId", 400)

    existing_doc = _signups_col(race_id).document(zwift_id).get()
    existing = existing_doc.to_dict() if existing_doc.exists else None

    zwift_service = get_zwift_service()
    return _register_one(
        race_id=str(race_id),
        race_data=race_data,
        user_data=user_data,
        user_doc_id=str(user_doc_id),
        zwift_service=zwift_service,
        existing=existing,
    )


def unsignup_rider(race_id: str, user_doc_id: str, user_data: dict[str, Any]) -> dict[str, Any]:
    if not db:
        raise SignupError("DB not available", 500)
    race_doc = db.collection("races").document(str(race_id)).get()
    if not race_doc.exists:
        raise SignupError("Race not found", 404)

    zwift_id = _zwift_id(user_data, user_doc_id)
    if not zwift_id:
        raise SignupError("Missing zwiftId", 400)

    signup_ref = _signups_col(race_id).document(zwift_id)
    signup_doc = signup_ref.get()
    if not signup_doc.exists:
        return {"message": "Not signed up", "status": "absent"}

    data = signup_doc.to_dict() or {}
    status = str(data.get("status") or "")
    subgroup_id = str(data.get("subgroupId") or "").strip()
    zwift_user_id = str(data.get("zwiftUserId") or _zwift_user_id(user_data) or "").strip()

    if status == SIGNUP_REGISTERED and subgroup_id and zwift_user_id:
        zwift_service = get_zwift_service()
        status_code, payload = _batch_unregister(zwift_service, subgroup_id, [zwift_user_id])
        if status_code != 200:
            err = _extract_zwift_message(payload) or f"Zwift unregister failed ({status_code})"
            signup_ref.set({"lastError": err, "status": SIGNUP_FAILED}, merge=True)
            http = status_code if status_code in {400, 401, 403, 404, 409, 422, 500} else 502
            raise SignupError(err, http)

    signup_ref.delete()
    return {"message": "Afmeldt", "status": "removed"}


def list_race_signups(race_id: str) -> list[dict[str, Any]]:
    if not db:
        raise SignupError("DB not available", 500)
    race_doc = db.collection("races").document(str(race_id)).get()
    if not race_doc.exists:
        raise SignupError("Race not found", 404)
    out: list[dict[str, Any]] = []
    for doc in _signups_col(race_id).stream():
        data = doc.to_dict() or {}
        out.append(
            {
                "zwiftId": str(data.get("zwiftId") or doc.id),
                "name": str(data.get("name") or ""),
                "club": str(data.get("club") or ""),
                "ligaCategory": str(data.get("ligaCategory") or ""),
                "status": str(data.get("status") or ""),
            }
        )
    return out


def list_my_signups(zwift_id: str) -> dict[str, dict[str, str]]:
    if not db:
        raise SignupError("DB not available", 500)
    if not zwift_id:
        return {}
    result: dict[str, dict[str, str]] = {}
    docs = db.collection_group("signups").where("zwiftId", "==", str(zwift_id)).stream()
    for doc in docs:
        data = doc.to_dict() or {}
        race_id = str(data.get("raceId") or "").strip()
        if not race_id:
            try:
                race_id = str(doc.reference.parent.parent.id)
            except Exception:
                continue
        result[race_id] = {"status": str(data.get("status") or "")}
    return result


def _signup_race_id(doc, data: dict[str, Any]) -> str:
    race_id = str(data.get("raceId") or "").strip()
    if race_id:
        return race_id
    try:
        return str(doc.reference.parent.parent.id)
    except Exception:
        return ""


def count_signups_by_race() -> dict[str, int]:
    """Active (pending + registered) signup counts keyed by race id."""
    if not db:
        raise SignupError("DB not available", 500)
    counts: dict[str, int] = {}
    for doc in db.collection_group("signups").stream():
        data = doc.to_dict() or {}
        if str(data.get("status") or "") not in {SIGNUP_PENDING, SIGNUP_REGISTERED}:
            continue
        race_id = _signup_race_id(doc, data)
        if not race_id:
            continue
        counts[race_id] = counts.get(race_id, 0) + 1
    return counts


def _has_pending_or_failed(race_id: str) -> bool:
    for doc in _signups_col(race_id).stream():
        status = str((doc.to_dict() or {}).get("status") or "")
        if status in {SIGNUP_PENDING, SIGNUP_FAILED}:
            return True
    return False


def sync_race_signups(race_id: str, *, include_reroutes: bool = True) -> dict[str, Any]:
    """Register pending/failed (and optionally re-route registered) riders on Zwift."""
    if not db:
        raise SignupError("DB not available", 500)
    race_doc = db.collection("races").document(str(race_id)).get()
    if not race_doc.exists:
        raise SignupError("Race not found", 404)
    race_data = race_doc.to_dict() or {}
    if not race_has_event_id(race_data):
        raise SignupError("No Zwift event configured for this race", 400)

    zwift_service = get_zwift_service()
    races_mod = _routing()

    registered = 0
    failed = 0
    skipped = 0
    moved = 0
    errors: list[str] = []

    signup_docs = list(_signups_col(race_id).stream())
    if not signup_docs:
        return {
            "registered": 0,
            "failed": 0,
            "skipped": 0,
            "moved": 0,
            "errors": [],
        }

    user_ids = [str((d.to_dict() or {}).get("zwiftId") or d.id) for d in signup_docs]
    users_by_id: dict[str, dict[str, Any]] = {}
    for uid in user_ids:
        udoc = db.collection("users").document(uid).get()
        if udoc.exists:
            users_by_id[uid] = udoc.to_dict() or {}

    unregister_by_sg: dict[str, list[tuple[str, str, dict[str, Any]]]] = {}
    register_by_sg: dict[str, list[tuple[str, str, dict[str, Any], str]]] = {}

    for doc in signup_docs:
        data = doc.to_dict() or {}
        zwift_id = str(data.get("zwiftId") or doc.id)
        user_data = users_by_id.get(zwift_id) or {}
        status = str(data.get("status") or "")
        stored_sg = str(data.get("subgroupId") or "").strip()
        public_id = str(data.get("zwiftUserId") or _zwift_user_id(user_data) or "").strip()
        category = races_mod._resolve_effective_user_category(user_data.get("ligaCategory")) if user_data else str(data.get("ligaCategory") or "")

        if status == SIGNUP_REGISTERED and not include_reroutes:
            skipped += 1
            continue

        subgroup_id, event_id, subgroup_error = resolve_target(race_data, category, zwift_service)

        if _needs_category_for_event(race_data) and not category:
            err = "No liga category assigned yet — cannot pick a Zwift pen."
            _write_signup(
                race_id,
                zwift_id,
                {
                    **data,
                    "status": SIGNUP_FAILED,
                    "lastError": err,
                    "ligaCategory": category,
                },
            )
            failed += 1
            errors.append(f"{zwift_id}: {err}")
            continue

        if not subgroup_id:
            err = subgroup_error or "Could not determine event subgroup for signup"
            _write_signup(
                race_id,
                zwift_id,
                {
                    **data,
                    "status": SIGNUP_FAILED,
                    "lastError": err,
                    "ligaCategory": category,
                },
            )
            failed += 1
            errors.append(f"{zwift_id}: {err}")
            continue

        if not public_id:
            err = "Missing zwiftUserId"
            _write_signup(race_id, zwift_id, {**data, "status": SIGNUP_FAILED, "lastError": err})
            failed += 1
            errors.append(f"{zwift_id}: {err}")
            continue

        if status == SIGNUP_REGISTERED and stored_sg == str(subgroup_id):
            skipped += 1
            continue

        meta = {
            "data": data,
            "event_id": str(event_id or ""),
            "category": category,
            "user_data": user_data,
        }
        if status == SIGNUP_REGISTERED and stored_sg and stored_sg != str(subgroup_id):
            unregister_by_sg.setdefault(stored_sg, []).append((zwift_id, public_id, meta))
        register_by_sg.setdefault(str(subgroup_id), []).append((zwift_id, public_id, meta, str(subgroup_id)))

    for old_sg, riders in unregister_by_sg.items():
        ids = [public_id for _zid, public_id, _meta in riders]
        status_code, payload = _batch_unregister(zwift_service, old_sg, ids)
        if status_code != 200:
            err = _extract_zwift_message(payload) or f"Zwift unregister failed ({status_code})"
            for zwift_id, _pid, meta in riders:
                _write_signup(
                    race_id,
                    zwift_id,
                    {
                        **meta["data"],
                        "status": SIGNUP_FAILED,
                        "lastError": err,
                    },
                )
                failed += 1
                errors.append(f"{zwift_id}: {err}")
            # Drop them from the register queue
            drop = {zid for zid, _pid, _meta in riders}
            for sg, items in list(register_by_sg.items()):
                register_by_sg[sg] = [row for row in items if row[0] not in drop]

    for new_sg, riders in register_by_sg.items():
        ids = [public_id for _zid, public_id, _meta, _sg in riders]
        status_code, payload = _batch_register(zwift_service, new_sg, ids)
        unknown = payload.get("unknownPublicIds") if isinstance(payload, dict) else None
        unknown_set = {str(x) for x in unknown} if isinstance(unknown, list) else set()
        now = _iso_now()
        if status_code != 200:
            err = _extract_zwift_message(payload) or f"Zwift signup failed ({status_code})"
            for zwift_id, _pid, meta, _sg in riders:
                _write_signup(
                    race_id,
                    zwift_id,
                    {
                        **meta["data"],
                        "status": SIGNUP_FAILED,
                        "lastError": err,
                        "ligaCategory": meta["category"],
                    },
                )
                failed += 1
                errors.append(f"{zwift_id}: {err}")
            continue
        for zwift_id, public_id, meta, _sg in riders:
            if public_id in unknown_set:
                err = "Zwift did not recognize public ID"
                _write_signup(
                    race_id,
                    zwift_id,
                    {
                        **meta["data"],
                        "status": SIGNUP_FAILED,
                        "lastError": err,
                        "ligaCategory": meta["category"],
                    },
                )
                failed += 1
                errors.append(f"{zwift_id}: {err}")
                continue
            prev_status = str(meta["data"].get("status") or "")
            prev_sg = str(meta["data"].get("subgroupId") or "").strip()
            was_move = prev_status == SIGNUP_REGISTERED and prev_sg and prev_sg != new_sg
            _write_signup(
                race_id,
                zwift_id,
                {
                    **meta["data"],
                    "status": SIGNUP_REGISTERED,
                    "lastError": "",
                    "subgroupId": new_sg,
                    "eventId": meta["event_id"],
                    "ligaCategory": meta["category"],
                    "zwiftRegisteredAt": now,
                    "zwiftId": zwift_id,
                    "raceId": str(race_id),
                    "zwiftUserId": public_id,
                    "name": str((meta["user_data"] or {}).get("name") or meta["data"].get("name") or ""),
                    "club": str((meta["user_data"] or {}).get("club") or meta["data"].get("club") or ""),
                    "signedUpAt": meta["data"].get("signedUpAt") or now,
                },
            )
            if was_move:
                moved += 1
            else:
                registered += 1

    return {
        "registered": registered,
        "failed": failed,
        "skipped": skipped,
        "moved": moved,
        "errors": errors,
    }


def maybe_sync_after_race_save(race_id: str, race_data: dict[str, Any]) -> dict[str, Any] | None:
    """Inline sync after admin save. Never raises — returns summary or None."""
    try:
        if not race_has_event_id(race_data):
            return None
        if not _has_pending_or_failed(race_id):
            return None
        return sync_race_signups(race_id, include_reroutes=False)
    except SignupError as e:
        logger.warning("Signup sync after save skipped race=%s: %s", race_id, e.message)
        return {"registered": 0, "failed": 0, "skipped": 0, "moved": 0, "errors": [e.message]}
    except Exception as e:
        logger.warning("Signup sync after save failed race=%s: %s", race_id, e)
        return {"registered": 0, "failed": 0, "skipped": 0, "moved": 0, "errors": [str(e)]}


def _race_id_from_signup(doc: Any, data: dict[str, Any]) -> str:
    race_id = str(data.get("raceId") or "").strip()
    if race_id:
        return race_id
    try:
        return str(doc.reference.parent.parent.id)
    except Exception:
        return ""


def _join_race_names(rows: list[dict[str, Any]]) -> str:
    names = [str(row.get("raceName") or "løbet") for row in rows]
    if len(names) <= 1:
        return names[0] if names else "løbet"
    if len(names) == 2:
        return f"{names[0]} og {names[1]}"
    return ", ".join(names[:-1]) + f" og {names[-1]}"


def category_change_message(category: str, summary: dict[str, Any]) -> str:
    """Danish confirmation after a rider changes division."""
    parts = [f"Kategori opdateret til {category}."]
    moved = [row for row in (summary.get("moved") or []) if row.get("penChanged")]
    kept = list(summary.get("kept") or [])
    failed = list(summary.get("failed") or [])
    if moved:
        parts.append(f"Zwift-starten er flyttet for {_join_race_names(moved)}.")
    if len(kept) == 1:
        parts.append(
            f"{_join_race_names(kept)} er allerede startet, så du bliver i den start, og løbet tæller der."
        )
    elif kept:
        parts.append(
            f"{_join_race_names(kept)} er allerede startet, så du bliver i de starter, og løbene tæller der."
        )
    if len(failed) == 1:
        parts.append(
            f"Zwift afviste flytningen for {_join_race_names(failed)}, så du bliver i den start, og løbet tæller der."
        )
    elif failed:
        parts.append(
            f"Zwift afviste flytningen for {_join_race_names(failed)}, så du bliver i de starter, og løbene tæller der."
        )
    return " ".join(parts)


def reroute_open_signups(
    zwift_id: str,
    category: str,
    *,
    zwift_service: Any | None = None,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Move Zwift pens for races that have not started.

    A race that has started, or a Zwift register that fails, keeps its current
    pen and signup division. Results follow that signup.
    """
    summary: dict[str, list[dict[str, Any]]] = {"moved": [], "kept": [], "failed": []}
    if not db or not str(zwift_id or "").strip() or not str(category or "").strip():
        return summary

    service = zwift_service
    if service is None:
        try:
            service = get_zwift_service()
        except Exception as exc:
            logger.warning("Zwift unavailable for pen reroute: %s", exc)
            service = None

    try:
        docs = list(db.collection_group("signups").where("zwiftId", "==", str(zwift_id)).stream())
    except Exception as exc:
        logger.warning("Could not list signups for %s: %s", zwift_id, exc)
        summary["failed"].append({"raceId": "", "raceName": "kommende løb", "reason": str(exc)})
        return summary

    for doc in docs:
        data = doc.to_dict() or {}
        if str(data.get("zwiftId") or doc.id) != str(zwift_id):
            continue
        status = str(data.get("status") or "")
        if status not in {SIGNUP_PENDING, SIGNUP_REGISTERED, SIGNUP_FAILED}:
            continue
        race_id = _race_id_from_signup(doc, data)
        if not race_id:
            continue
        race_doc = db.collection("races").document(race_id).get()
        if not getattr(race_doc, "exists", False):
            continue
        race_data = race_doc.to_dict() or {}
        race_name = str(race_data.get("name") or race_id)
        entry = {"raceId": race_id, "raceName": race_name}
        if is_race_past(race_data, now):
            summary["kept"].append({**entry, "reason": "started"})
            continue

        current_sg = str(data.get("subgroupId") or "").strip()
        public_id = str(data.get("zwiftUserId") or "").strip()
        if status == SIGNUP_REGISTERED and service is None:
            summary["failed"].append({**entry, "reason": "Zwift er ikke tilgængelig"})
            continue

        try:
            subgroup_id, event_id, error = resolve_target(race_data, category, service)
        except Exception as exc:
            logger.warning("Could not resolve pen for %s on %s: %s", zwift_id, race_id, exc)
            if status == SIGNUP_REGISTERED:
                summary["failed"].append({**entry, "reason": str(exc)})
                continue
            subgroup_id, event_id, error = None, None, str(exc)

        target_sg = str(subgroup_id or "").strip()
        if status == SIGNUP_REGISTERED and target_sg and target_sg != current_sg:
            if not public_id:
                summary["failed"].append({**entry, "reason": "Mangler Zwift-bruger"})
                continue
            status_code, payload = _batch_register(service, target_sg, [public_id])
            if status_code != 200:
                reason = _extract_zwift_message(payload) or f"Zwift signup failed ({status_code})"
                summary["failed"].append({**entry, "reason": reason})
                continue
            warning = ""
            if current_sg:
                old_code, old_payload = _batch_unregister(service, current_sg, [public_id])
                if old_code != 200:
                    warning = _extract_zwift_message(old_payload) or f"Zwift unregister failed ({old_code})"
                    logger.warning(
                        "Moved %s onto %s but old pen %s stayed: %s",
                        zwift_id,
                        target_sg,
                        current_sg,
                        warning,
                    )
            _write_signup(
                race_id,
                str(zwift_id),
                {
                    "ligaCategory": category,
                    "subgroupId": target_sg,
                    "eventId": str(event_id or data.get("eventId") or ""),
                    "status": SIGNUP_REGISTERED,
                    "lastError": warning,
                    "zwiftRegisteredAt": _iso_now(),
                },
            )
            summary["moved"].append({**entry, "penChanged": True, "subgroupId": target_sg})
            continue

        if status == SIGNUP_REGISTERED and current_sg and not target_sg:
            summary["failed"].append({**entry, "reason": error or "Kunne ikke finde Zwift-starten"})
            continue

        pen_changed = bool(target_sg and current_sg and target_sg != current_sg and status == SIGNUP_REGISTERED)
        update: dict[str, Any] = {"ligaCategory": category}
        if target_sg:
            update["subgroupId"] = target_sg
        if event_id:
            update["eventId"] = str(event_id)
        _write_signup(race_id, str(zwift_id), update)
        summary["moved"].append({**entry, "penChanged": pen_changed, "subgroupId": target_sg or current_sg})

    return summary
