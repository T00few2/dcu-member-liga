"""Admin club kit unlock index, pins, auto-assignment, and drop-level refresh."""
from __future__ import annotations

import logging
from typing import Any

from flask import jsonify, request
from firebase_admin import firestore

from authz import AuthzError, require_admin
from extensions import db, get_zwift_game_service
from routes.admin import admin_bp
from services.club_kits import (
    apply_auto_assignment,
    club_kits_by_club,
    pin_club_kit,
    preview_auto_assignment,
    rider_assigned_kit_coverage,
    riders_below_kit_level,
    riders_by_club,
    unpin_club_kit,
)
from services.jersey_unlock_seed import match_known_unlocks, merge_unlocks
from services.request_models import (
    ClubKitPinRequest,
    ClubKitUnpinRequest,
    JerseyUnlocksSaveRequest,
    parse_body,
)
from services.schema_validation import (
    log_schema_issues,
    validate_league_settings_doc,
    with_schema_version,
)
from services.zwift_drop_levels import (
    DropLevelAuthError,
    numeric_zwift_id,
    refresh_drop_levels_for_ids,
)
from services.zwift_game import jersey_image_url

logger = logging.getLogger(__name__)


def _settings_ref():
    return db.collection("league").document("settings")


def _load_settings() -> dict[str, Any]:
    doc = _settings_ref().get()
    return doc.to_dict() if doc.exists else {}


def _registered_riders() -> list[dict[str, Any]]:
    docs = db.collection("users").where("registration.status", "==", "complete").stream()
    riders: list[dict[str, Any]] = []
    for doc in docs:
        data = doc.to_dict() or {}
        if data.get("isTestData"):
            continue
        club = (data.get("club") or "").strip()
        zwift_id = numeric_zwift_id(data.get("zwiftId"))
        profile = data.get("zwiftProfile") if isinstance(data.get("zwiftProfile"), dict) else {}
        drop_level = profile.get("dropLevel")
        try:
            drop_level_int = int(drop_level) if drop_level is not None else None
        except (TypeError, ValueError):
            drop_level_int = None
        riders.append({
            "id": doc.id,
            "name": data.get("name") or "",
            "club": club,
            "zwiftId": zwift_id,
            "dropLevel": drop_level_int,
        })
    return riders


def _jersey_lookup() -> dict[int, dict[str, Any]]:
    game = get_zwift_game_service()
    return {row["signature"]: row for row in game.get_jerseys(query=None, limit=None)}


def _fill_image_urls(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out = []
    for row in rows:
        item = dict(row)
        if not item.get("imageUrl") and item.get("imageName"):
            item["imageUrl"] = jersey_image_url(item.get("imageName"))
        out.append(item)
    return out


@admin_bp.route("/admin/club-kits/overview", methods=["GET"])
def club_kits_overview():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        settings = _load_settings()
        riders = _registered_riders()
        jerseys = _jersey_lookup()
        preview = preview_auto_assignment(
            unlocks=settings.get("jerseyUnlocks") or [],
            club_kits=settings.get("clubKits") or [],
            riders=riders,
            jerseys_by_sig=jerseys,
        )
        grouped = riders_by_club(riders)
        saved = club_kits_by_club(settings.get("clubKits") or [])
        unlocks = settings.get("jerseyUnlocks") or []
        annotated = []
        for club in preview.get("clubs") or []:
            row = dict(club)
            row.update(riders_below_kit_level(
                grouped.get(row.get("club") or "", []),
                saved.get(row.get("club") or ""),
                unlocks,
            ))
            annotated.append(row)
        preview["clubs"] = annotated
        preview["riderCoverage"] = rider_assigned_kit_coverage(
            riders,
            preview.get("proposedClubKits") or [],
            unlocks,
        )
        known_levels = sum(1 for r in riders if r.get("dropLevel") is not None)
        return jsonify({
            "jerseyUnlocks": _fill_image_urls(list(settings.get("jerseyUnlocks") or [])),
            "clubKits": _fill_image_urls(list(settings.get("clubKits") or [])),
            "preview": preview,
            "riders": {
                "total": len(riders),
                "withClub": sum(1 for r in riders if r.get("club")),
                "knownDropLevel": known_levels,
                "unknownDropLevel": len(riders) - known_levels,
            },
            "riderCoverage": rider_assigned_kit_coverage(
                riders,
                settings.get("clubKits") or [],
                unlocks,
            ),
        }), 200
    except Exception as exc:
        logger.exception("club_kits_overview failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/jersey-unlocks", methods=["PUT"])
def save_jersey_unlocks():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body, err = parse_body(JerseyUnlocksSaveRequest, request.get_json(silent=True) or {})
    if err:
        return err
    try:
        jerseys = _jersey_lookup()
        rows = []
        for item in body.jerseyUnlocks:
            catalog = jerseys.get(item.jerseySignature) or {}
            payload = item.model_dump(exclude_none=True)
            if not payload.get("jerseyName"):
                payload["jerseyName"] = catalog.get("name") or ""
            if not payload.get("imageName"):
                payload["imageName"] = catalog.get("imageName") or ""
            if not payload.get("imageUrl"):
                payload["imageUrl"] = catalog.get("imageUrl") or jersey_image_url(payload.get("imageName"))
            if payload.get("unlockCode") and not payload.get("codeStatus"):
                payload["codeStatus"] = "unverified"
            rows.append(payload)
        update = with_schema_version({
            "jerseyUnlocks": rows,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        log_schema_issues(logger, "league/settings (jerseyUnlocks)", validate_league_settings_doc(update, partial=True))
        _settings_ref().set(update, merge=True)
        return jsonify({"jerseyUnlocks": rows, "message": "Unlock index saved"}), 200
    except Exception as exc:
        logger.exception("save_jersey_unlocks failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/jersey-unlocks/seed", methods=["POST"])
def seed_jersey_unlocks():
    """Merge known level kits and published P-codes into the unlock index."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        settings = _load_settings()
        existing = list(settings.get("jerseyUnlocks") or [])
        catalog = get_zwift_game_service().get_jerseys(query=None, limit=None)
        seeded = match_known_unlocks(catalog)
        merged = merge_unlocks(existing, seeded)
        update = with_schema_version({
            "jerseyUnlocks": merged,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        log_schema_issues(logger, "league/settings (jerseyUnlocks seed)", validate_league_settings_doc(update, partial=True))
        _settings_ref().set(update, merge=True)
        existing_sigs = {row.get("jerseySignature") for row in existing}
        added = sum(1 for row in merged if row.get("jerseySignature") not in existing_sigs)
        return jsonify({
            "jerseyUnlocks": merged,
            "seeded": len(seeded),
            "added": added,
            "total": len(merged),
            "message": f"Tilføjet {added} kendte unlocks ({len(seeded)} matchede kataloget)",
        }), 200
    except Exception as exc:
        logger.exception("seed_jersey_unlocks failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/club-kits/pin", methods=["POST"])
def pin_club_kit_route():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body, err = parse_body(ClubKitPinRequest, request.get_json(silent=True) or {})
    if err:
        return err
    try:
        settings = _load_settings()
        jerseys = _jersey_lookup()
        catalog = jerseys.get(body.jerseySignature) or {}
        next_kits = pin_club_kit(
            club=body.club,
            signature=body.jerseySignature,
            club_kits=settings.get("clubKits") or [],
            unlocks=settings.get("jerseyUnlocks") or [],
            jersey=catalog,
            notes=body.notes,
            image_url=body.imageUrl or catalog.get("imageUrl"),
            jersey_name=body.jerseyName or catalog.get("name"),
            image_name=body.imageName or catalog.get("imageName"),
        )
        update = with_schema_version({
            "clubKits": next_kits,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        log_schema_issues(logger, "league/settings (clubKits pin)", validate_league_settings_doc(update, partial=True))
        _settings_ref().set(update, merge=True)
        return jsonify({"clubKits": next_kits, "message": "Club kit pinned"}), 200
    except ValueError as exc:
        return jsonify({"message": str(exc)}), 400
    except Exception as exc:
        logger.exception("pin_club_kit failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/club-kits/unpin", methods=["POST"])
def unpin_club_kit_route():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body, err = parse_body(ClubKitUnpinRequest, request.get_json(silent=True) or {})
    if err:
        return err
    try:
        settings = _load_settings()
        next_kits = unpin_club_kit(body.club, settings.get("clubKits") or [])
        update = with_schema_version({
            "clubKits": next_kits,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        _settings_ref().set(update, merge=True)
        return jsonify({"clubKits": next_kits, "message": "Club kit unpinned"}), 200
    except Exception as exc:
        logger.exception("unpin_club_kit failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/club-kits/preview", methods=["POST"])
def preview_club_kits_route():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        settings = _load_settings()
        preview = preview_auto_assignment(
            unlocks=settings.get("jerseyUnlocks") or [],
            club_kits=settings.get("clubKits") or [],
            riders=_registered_riders(),
            jerseys_by_sig=_jersey_lookup(),
        )
        return jsonify({"preview": preview}), 200
    except Exception as exc:
        logger.exception("preview_club_kits failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/club-kits/apply", methods=["POST"])
def apply_club_kits_route():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        settings = _load_settings()
        next_kits = apply_auto_assignment(
            unlocks=settings.get("jerseyUnlocks") or [],
            club_kits=settings.get("clubKits") or [],
            riders=_registered_riders(),
            jerseys_by_sig=_jersey_lookup(),
        )
        update = with_schema_version({
            "clubKits": next_kits,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        log_schema_issues(logger, "league/settings (clubKits apply)", validate_league_settings_doc(update, partial=True))
        _settings_ref().set(update, merge=True)
        return jsonify({"clubKits": next_kits, "message": "Auto-assignment applied"}), 200
    except Exception as exc:
        logger.exception("apply_club_kits failed")
        return jsonify({"message": str(exc)}), 500


@admin_bp.route("/admin/club-kits/refresh-drop-levels", methods=["POST"])
def refresh_drop_levels_route():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        riders = _registered_riders()
        id_to_docs: dict[int, list[str]] = {}
        for rider in riders:
            zwift_id = rider.get("zwiftId")
            if zwift_id is None:
                continue
            id_to_docs.setdefault(int(zwift_id), []).append(rider["id"])
        if not id_to_docs:
            return jsonify({"message": "No numeric Zwift IDs", "updated": 0}), 200

        def write_fields(zwift_id: int, fields: dict[str, Any]) -> None:
            payload = {f"zwiftProfile.{key}": value for key, value in fields.items()}
            payload["updatedAt"] = firestore.SERVER_TIMESTAMP
            for doc_id in id_to_docs.get(zwift_id, []):
                db.collection("users").document(doc_id).update(payload)

        stats = refresh_drop_levels_for_ids(sorted(id_to_docs), write_fields)
        return jsonify(stats), 200
    except DropLevelAuthError as exc:
        return jsonify({"message": str(exc)}), 400
    except Exception as exc:
        logger.exception("refresh_drop_levels failed")
        return jsonify({"message": str(exc)}), 500
