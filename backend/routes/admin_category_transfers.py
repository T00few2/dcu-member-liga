"""Admin category moves. Registered on admin_bp."""
from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db
from routes.admin import admin_bp
from services.category_transfer import (
    CategoryTransferError,
    apply_move,
    build_move_preview,
    list_transfers,
    undo_move,
)
from services.category_transfer_logic import STATUS_APPLIED
from services.user_service import UserService


def _admin_guard():
    try:
        require_admin(request)
    except AuthzError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    return None


@admin_bp.route("/admin/liga-categories/transfers", methods=["GET"])
def get_category_transfers():
    blocked = _admin_guard()
    if blocked:
        return blocked
    rows = [_public_row(item) for item in list_transfers(db)]
    return jsonify({"transfers": rows}), 200


@admin_bp.route("/admin/liga-categories/transfers/<transfer_id>/undo", methods=["POST"])
def undo_category_transfer(transfer_id: str):
    blocked = _admin_guard()
    if blocked:
        return blocked
    body = request.get_json(silent=True) or {}
    try:
        result = undo_move(db, transfer_id, dry_run=bool(body.get("dryRun")))
        return jsonify(result), 200
    except CategoryTransferError as exc:
        return jsonify({"message": exc.message}), exc.status_code


@admin_bp.route("/admin/liga-categories/<zwift_id>/transfer", methods=["POST"])
def transfer_liga_category(zwift_id: str):
    blocked = _admin_guard()
    if blocked:
        return blocked
    body = request.get_json(silent=True) or {}
    to_category = str(body.get("toCategory") or "").strip()
    if not to_category:
        return jsonify({"message": "toCategory is required"}), 400
    user = UserService.get_user_by_id(zwift_id)
    if not user:
        return jsonify({"message": "User not found"}), 404
    try:
        if bool(body.get("dryRun")):
            result = build_move_preview(
                db,
                zwift_id=str(zwift_id),
                user_data=user._data,
                to_category=to_category,
            )
        else:
            result = apply_move(
                db,
                user_doc_id=str(user.id),
                zwift_id=str(zwift_id),
                user_data=user._data,
                to_category=to_category,
            )
        return jsonify(result), 200
    except CategoryTransferError as exc:
        return jsonify({"message": exc.message}), exc.status_code


def _public_row(item: dict) -> dict:
    return {
        "id": item.get("id"),
        "zwiftId": item.get("zwiftId"),
        "name": item.get("name"),
        "fromCategory": item.get("fromCategory"),
        "toCategory": item.get("toCategory"),
        "status": item.get("status") or STATUS_APPLIED,
        "creditedRaceIds": list(item.get("creditedRaceIds") or []),
        "createdAtIso": item.get("createdAtIso"),
        "revertedAtIso": item.get("revertedAtIso"),
        "penErrors": list(item.get("penErrors") or []),
    }
