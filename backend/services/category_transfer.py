"""Admin category moves: preview, apply, and undo.

Firestore writes live here. Scoring rules live in category_transfer_logic.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from firebase_admin import firestore

from services.category_engine import (
    build_manual_assigned,
    effective_liga_category_name,
    effective_rating,
)
from services.category_transfer_logic import (
    STATUS_APPLIED,
    STATUS_REVERTED,
    TRANSFER_COLLECTION,
    apply_credits_to_races,
    describe_credits,
    latest_applied_transfer,
    merge_transfer_credits,
    plan_credits,
    preexisting_destination_race_ids,
    protected_ids_for_race,
    race_has_results,
    score_standings,
    standings_delta,
    strip_transfer_rows,
    undo_blocked_by_later_result,
)
from services.liga_categories_core import _load_liga_settings, _resolve_categories
from services.schema_validation import log_schema_issues, validate_user_doc, with_schema_version

logger = logging.getLogger(__name__)


class CategoryTransferError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _doc_data(doc: Any) -> dict[str, Any]:
    data = doc.to_dict() or {}
    data["id"] = doc.id
    return data


def list_transfers(db: Any) -> list[dict[str, Any]]:
    try:
        docs = list(db.collection(TRANSFER_COLLECTION).stream())
    except TypeError:
        return []
    except Exception as exc:
        logger.warning("Could not load category transfers: %s", exc)
        return []
    rows = [_doc_data(doc) for doc in docs if getattr(doc, "exists", True)]
    rows.sort(key=lambda item: str(item.get("createdAtIso") or ""), reverse=True)
    return rows


def list_applied_transfers(db: Any) -> list[dict[str, Any]]:
    return [item for item in list_transfers(db) if str(item.get("status") or "") == STATUS_APPLIED]


def protected_zwift_ids(db: Any, race_id: str) -> set[str]:
    return protected_ids_for_race(list_applied_transfers(db), race_id)


def reapply_active_transfers(db: Any, race_id: str, results: dict[str, Any]) -> dict[str, Any]:
    """Put last-place credits back after a results rewrite. Real rows stay put."""
    try:
        settings = _load_liga_settings(db) if db else {}
    except Exception:
        settings = {}
    scheme = list((settings or {}).get("finishPoints") or [])
    transfers = list_applied_transfers(db)
    if not transfers:
        return results
    race = {"id": race_id, "results": results}
    try:
        stored = db.collection("races").document(str(race_id)).get()
        if getattr(stored, "exists", False):
            stored_data = stored.to_dict() or {}
            race["manualDQs"] = stored_data.get("manualDQs") or []
            race["manualDeclassifications"] = stored_data.get("manualDeclassifications") or []
            race["manualExclusions"] = stored_data.get("manualExclusions") or []
            race["type"] = stored_data.get("type")
            race["resultsPhase"] = stored_data.get("resultsPhase")
    except Exception as exc:
        logger.warning("Could not load race %s while reapplying transfers: %s", race_id, exc)
    return merge_transfer_credits(results, race, transfers, scheme)


def _scoring_settings(db: Any) -> dict[str, Any]:
    """Full league settings. Category resolution uses a smaller view of the same doc."""
    try:
        doc = db.collection("league").document("settings").get()
        data = doc.to_dict() if getattr(doc, "exists", False) else {}
    except Exception:
        data = {}
    return data if isinstance(data, dict) else {}


def _load_races(db: Any) -> list[dict[str, Any]]:
    races: list[dict[str, Any]] = []
    for doc in db.collection("races").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        races.append(data)
    return races


def _load_stage_races(db: Any) -> list[dict[str, Any]]:
    events: list[dict[str, Any]] = []
    for doc in db.collection("stageRaces").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        events.append(data)
    return events


def _public_transfer(doc: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": doc.get("id"),
        "zwiftId": doc.get("zwiftId"),
        "name": doc.get("name"),
        "fromCategory": doc.get("fromCategory"),
        "toCategory": doc.get("toCategory"),
        "status": doc.get("status"),
        "creditedRaceIds": list(doc.get("creditedRaceIds") or []),
        "createdAtIso": doc.get("createdAtIso"),
        "revertedAtIso": doc.get("revertedAtIso"),
        "penErrors": list(doc.get("penErrors") or []),
    }


def _planned_signups(db: Any, races: list[dict[str, Any]], zwift_id: str, to_category: str) -> list[dict[str, Any]]:
    from routes import races as races_mod

    planned: list[dict[str, Any]] = []
    for race in races:
        if race_has_results(race):
            continue
        race_id = str(race.get("id") or "")
        snap = db.collection("races").document(race_id).collection("signups").document(str(zwift_id)).get()
        if not getattr(snap, "exists", False):
            continue
        data = snap.to_dict() or {}
        subgroup_id, _event_id, _secret = races_mod._pick_mode_config_for_user(race, to_category)
        planned.append({
            "raceId": race_id,
            "raceName": str(race.get("name") or race_id),
            "status": str(data.get("status") or ""),
            "fromCategory": str(data.get("ligaCategory") or ""),
            "toCategory": to_category,
            "fromSubgroupId": str(data.get("subgroupId") or ""),
            "toSubgroupId": str(subgroup_id or ""),
            "eventId": str(data.get("eventId") or ""),
            "zwiftUserId": str(data.get("zwiftUserId") or ""),
        })
    return planned


def _category_update(user_data: dict[str, Any], to_category: str, categories, grace_period: int) -> dict[str, Any]:
    zr = user_data.get("zwiftRacing") or {}
    rating = effective_rating(
        zr.get("currentRating", "N/A"),
        zr.get("max30Rating", "N/A"),
        zr.get("max90Rating", "N/A"),
    )
    manual = build_manual_assigned(to_category, rating, grace_period, categories)
    if not manual:
        raise CategoryTransferError(f"Unknown category: {to_category}")
    manual["assignedAt"] = firestore.SERVER_TIMESTAMP
    lc = user_data.get("ligaCategory") or {}
    self_selected = (lc.get("selfSelected") or {}).get("category")
    clear_self = bool(self_selected) and str(self_selected) != to_category
    return {"manual": manual, "clearSelfSelect": clear_self, "wasLocked": bool(lc.get("locked"))}


def build_move_preview(
    db: Any,
    *,
    zwift_id: str,
    user_data: dict[str, Any],
    to_category: str,
) -> dict[str, Any]:
    settings = _load_liga_settings(db)
    categories = _resolve_categories(settings)
    grace_period = int(settings.get("gracePeriod", 35))
    from_category = effective_liga_category_name(user_data.get("ligaCategory") or {}, categories)
    if not from_category:
        raise CategoryTransferError("Rider has no category to move from")
    if to_category == from_category:
        raise CategoryTransferError("Rider is already in that category")
    if build_manual_assigned(to_category, None, grace_period, categories) is None:
        raise CategoryTransferError(f"Unknown category: {to_category}")

    races = _load_races(db)
    stage_races = _load_stage_races(db)
    scoring = _scoring_settings(db)
    credits, skipped = plan_credits(races, zwift_id, to_category)
    scheme = list(scoring.get("finishPoints") or [])
    rank_points = list(scoring.get("leagueRankPoints") or [])
    described = describe_credits(
        races,
        zwift_id=zwift_id,
        to_category=to_category,
        credits=credits,
        transfer_id="preview",
        finish_points_scheme=scheme,
        league_rank_points=rank_points,
        stage_races=stage_races,
        settings=scoring,
    )
    before = score_standings(races, stage_races, scoring)
    projected = apply_credits_to_races(
        races,
        zwift_id=zwift_id,
        to_category=to_category,
        credits=credits,
        transfer_id="preview",
        finish_points_scheme=scheme,
    )
    after = score_standings(projected, stage_races, scoring)
    signups = _planned_signups(db, races, zwift_id, to_category)
    return {
        "dryRun": True,
        "zwiftId": str(zwift_id),
        "name": str(user_data.get("name") or ""),
        "fromCategory": from_category,
        "toCategory": to_category,
        "races": described,
        "skipped": skipped,
        "standings": standings_delta(
            before,
            after,
            zwift_id=zwift_id,
            from_category=from_category,
            to_category=to_category,
        ),
        "signups": signups,
        "message": "Dry run — no writes",
    }


def _write_race_results(db: Any, before: list[dict[str, Any]], after: list[dict[str, Any]]) -> None:
    before_by_id = {str(race.get("id") or ""): race for race in before}
    for race in after:
        race_id = str(race.get("id") or "")
        previous = before_by_id.get(race_id) or {}
        if previous.get("results") == race.get("results"):
            continue
        db.collection("races").document(race_id).update(with_schema_version({
            "results": race.get("results") or {},
        }))


def _resolve_subgroup(race_data: dict[str, Any], category: str, zwift_service: Any) -> tuple[str | None, str | None]:
    """Return (subgroup id, error). Uses the race config first, then Zwift when a service is available."""
    from routes import races as races_mod

    subgroup_id, _event_id, _secret = races_mod._pick_mode_config_for_user(race_data, category)
    if subgroup_id:
        return str(subgroup_id), None
    if zwift_service is None:
        return None, "Zwift pen is not stored on the race"
    resolved, error = races_mod._resolve_signup_subgroup_id(race_data, category, zwift_service)
    return (str(resolved) if resolved else None), error


def _move_pens(db: Any, signups: list[dict[str, Any]], *, restore: bool = False) -> list[str]:
    """Point upcoming signups at the target category. Zwift failures are returned, not raised."""
    from services.race_signups import _batch_register, _batch_unregister

    errors: list[str] = []
    zwift_service = None
    try:
        from extensions import get_zwift_service
        zwift_service = get_zwift_service()
    except Exception as exc:
        zwift_service = None
        if any(str(item.get("status") or "") == "registered" for item in signups):
            errors.append(f"Zwift signup service unavailable: {exc}")

    for signup in signups:
        race_id = str(signup.get("raceId") or "")
        zwift_id = str(signup.get("zwiftId") or "")
        if restore:
            target_category = str(signup.get("fromCategory") or "")
            current_subgroup = str(signup.get("appliedSubgroupId") or signup.get("toSubgroupId") or "")
            target_subgroup = str(signup.get("fromSubgroupId") or "")
        else:
            target_category = str(signup.get("toCategory") or "")
            current_subgroup = str(signup.get("fromSubgroupId") or "")
            target_subgroup = str(signup.get("toSubgroupId") or "")
        status = str(signup.get("status") or "")
        zwift_user_id = str(signup.get("zwiftUserId") or "")
        update: dict[str, Any] = {"ligaCategory": target_category}
        if status == "registered" and not target_subgroup:
            race_doc = db.collection("races").document(race_id).get()
            race_data = race_doc.to_dict() if getattr(race_doc, "exists", False) else {}
            resolved, resolve_error = _resolve_subgroup(race_data or {}, target_category, zwift_service)
            if resolved:
                target_subgroup = resolved
            elif resolve_error:
                errors.append(f"{race_id}: {resolve_error}")
        if (
            status == "registered"
            and zwift_service is not None
            and target_subgroup
            and current_subgroup
            and target_subgroup != current_subgroup
            and zwift_user_id
        ):
            status_code, _payload = _batch_register(zwift_service, target_subgroup, [zwift_user_id])
            if status_code != 200:
                errors.append(f"{race_id}: Zwift register failed ({status_code})")
            else:
                old_code, _old_payload = _batch_unregister(zwift_service, current_subgroup, [zwift_user_id])
                if old_code != 200:
                    errors.append(
                        f"{race_id}: registered on the new pen, unregister of the old pen failed ({old_code})"
                    )
                update["subgroupId"] = target_subgroup
                update["status"] = "registered"
                update["lastError"] = ""
                signup["appliedSubgroupId"] = target_subgroup
        elif target_subgroup:
            update["subgroupId"] = target_subgroup
            signup["appliedSubgroupId"] = target_subgroup
        db.collection("races").document(race_id).collection("signups").document(zwift_id).set(update, merge=True)
    return errors


def _signup_rows_for_apply(planned: list[dict[str, Any]], zwift_id: str) -> list[dict[str, Any]]:
    rows = []
    for item in planned:
        row = dict(item)
        row["zwiftId"] = str(zwift_id)
        rows.append(row)
    return rows


def apply_move(
    db: Any,
    *,
    user_doc_id: str,
    zwift_id: str,
    user_data: dict[str, Any],
    to_category: str,
) -> dict[str, Any]:
    preview = build_move_preview(db, zwift_id=zwift_id, user_data=user_data, to_category=to_category)
    settings = _load_liga_settings(db)
    scoring = _scoring_settings(db)
    categories = _resolve_categories(settings)
    grace_period = int(settings.get("gracePeriod", 35))
    category_bits = _category_update(user_data, to_category, categories, grace_period)
    races = _load_races(db)
    credits, _skipped = plan_credits(races, zwift_id, to_category)
    transfer_id = uuid.uuid4().hex
    scheme = list(scoring.get("finishPoints") or [])
    updated_races = apply_credits_to_races(
        races,
        zwift_id=zwift_id,
        to_category=to_category,
        credits=credits,
        transfer_id=transfer_id,
        finish_points_scheme=scheme,
    )
    preexisting = preexisting_destination_race_ids(races, zwift_id, to_category)
    snapshot = copy_category(user_data.get("ligaCategory") or {})
    signup_rows = _signup_rows_for_apply(preview.get("signups") or [], zwift_id)
    pen_errors = _move_pens(db, signup_rows, restore=False)

    user_update: dict[str, Any] = {
        "ligaCategory.category": to_category,
        "ligaCategory.locked": True,
        "ligaCategory.manualAssigned": category_bits["manual"],
    }
    if not category_bits["wasLocked"]:
        user_update["ligaCategory.lockedAt"] = firestore.SERVER_TIMESTAMP
    if category_bits["clearSelfSelect"]:
        user_update["ligaCategory.selfSelected"] = firestore.DELETE_FIELD
    user_payload = with_schema_version(user_update)
    log_schema_issues(logger, f"users/{user_doc_id} (category transfer)", validate_user_doc(user_payload, partial=True))
    db.collection("users").document(str(user_doc_id)).update(user_payload)
    _write_race_results(db, races, updated_races)

    record = with_schema_version({
        "zwiftId": str(zwift_id),
        "userDocId": str(user_doc_id),
        "name": preview.get("name") or "",
        "fromCategory": preview.get("fromCategory"),
        "toCategory": to_category,
        "status": STATUS_APPLIED,
        "creditedRaceIds": [item["raceId"] for item in credits],
        "preexistingDestinationRaceIds": preexisting,
        "categorySnapshot": snapshot,
        "signupSnapshot": signup_rows,
        "penErrors": pen_errors,
        "createdAt": firestore.SERVER_TIMESTAMP,
        "createdAtIso": _now_iso(),
    })
    db.collection(TRANSFER_COLLECTION).document(transfer_id).set(record)
    _refresh_standings(db)
    result = dict(preview)
    result["dryRun"] = False
    result["applied"] = True
    result["transferId"] = transfer_id
    result["penErrors"] = pen_errors
    result["message"] = f"Rider moved to {to_category}"
    return result


def copy_category(value: dict[str, Any]) -> dict[str, Any]:
    import copy
    return copy.deepcopy(value) if isinstance(value, dict) else {}


def _refresh_standings(db: Any) -> None:
    from services.results_processor import ResultsProcessor

    try:
        ResultsProcessor(db, None, None).save_league_standings()
    except Exception as exc:
        logger.error("Category transfer standings refresh failed: %s", exc)
        raise CategoryTransferError(f"Category was saved but standings refresh failed: {exc}", 500) from exc


def undo_move(db: Any, transfer_id: str, *, dry_run: bool) -> dict[str, Any]:
    ref = db.collection(TRANSFER_COLLECTION).document(str(transfer_id))
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise CategoryTransferError("Transfer not found", 404)
    transfer = _doc_data(snap)
    if str(transfer.get("status") or "") != STATUS_APPLIED:
        raise CategoryTransferError("Only the latest applied move can be undone")
    zwift_id = str(transfer.get("zwiftId") or "")
    applied = list_applied_transfers(db)
    latest = latest_applied_transfer(applied, zwift_id)
    if latest is None or str(latest.get("id") or "") != str(transfer_id):
        raise CategoryTransferError("Undo the later move first")
    races = _load_races(db)
    if undo_blocked_by_later_result(
        races,
        zwift_id=zwift_id,
        to_category=str(transfer.get("toCategory") or ""),
        preexisting_race_ids=list(transfer.get("preexistingDestinationRaceIds") or []),
    ):
        raise CategoryTransferError(
            "Undo is closed because the rider has a real result in the new division from a later race"
        )
    stage_races = _load_stage_races(db)
    scoring = _scoring_settings(db)
    restored = strip_transfer_rows(races, str(transfer_id))
    before = score_standings(races, stage_races, scoring)
    after = score_standings(restored, stage_races, scoring)
    payload = {
        "dryRun": dry_run,
        "transferId": str(transfer_id),
        "zwiftId": zwift_id,
        "name": transfer.get("name") or "",
        "fromCategory": transfer.get("toCategory"),
        "toCategory": transfer.get("fromCategory"),
        "standings": standings_delta(
            before,
            after,
            zwift_id=zwift_id,
            from_category=str(transfer.get("toCategory") or ""),
            to_category=str(transfer.get("fromCategory") or ""),
        ),
        "signups": list(transfer.get("signupSnapshot") or []),
        "message": "Dry run — no writes" if dry_run else f"Move undone. Rider is back in {transfer.get('fromCategory')}",
    }
    if dry_run:
        return payload

    _write_race_results(db, races, restored)
    user_doc_id = str(transfer.get("userDocId") or zwift_id)
    snapshot = transfer.get("categorySnapshot") or {}
    db.collection("users").document(user_doc_id).update(with_schema_version({
        "ligaCategory": snapshot,
    }))
    pen_errors = _move_pens(db, list(transfer.get("signupSnapshot") or []), restore=True)
    ref.update({
        "status": STATUS_REVERTED,
        "revertedAt": firestore.SERVER_TIMESTAMP,
        "revertedAtIso": _now_iso(),
        "undoPenErrors": pen_errors,
    })
    _refresh_standings(db)
    payload["dryRun"] = False
    payload["applied"] = True
    payload["penErrors"] = pen_errors
    return payload
