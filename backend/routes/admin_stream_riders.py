"""Admin: Zwift-only stream dummy riders, registered on every race."""
from __future__ import annotations

import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db
from routes.admin import admin_bp
from services.stream_riders import (
    StreamRiderError,
    add_stream_rider,
    list_stream_riders,
    remove_stream_rider,
)

logger = logging.getLogger(__name__)


def _clear_live_riders_cache() -> None:
    try:
        from routes import live_race as live_race_mod

        live_race_mod._LIVE_RIDERS_CACHE.clear()
    except Exception:
        logger.debug("Could not clear live-riders cache", exc_info=True)


def _guard():
    try:
        require_admin(request)
    except AuthzError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    return None


@admin_bp.route("/admin/stream-riders", methods=["GET"])
@admin_bp.route("/admin/races/<race_id>/stream-riders", methods=["GET"])
def get_stream_riders(race_id: str | None = None):
    del race_id
    blocked = _guard()
    if blocked:
        return blocked
    return jsonify({"riders": list_stream_riders()}), 200


@admin_bp.route("/admin/stream-riders", methods=["POST"])
@admin_bp.route("/admin/races/<race_id>/stream-riders", methods=["POST"])
def post_stream_rider(race_id: str | None = None):
    del race_id
    blocked = _guard()
    if blocked:
        return blocked

    body = request.get_json(silent=True) or {}
    try:
        payload = add_stream_rider(
            zwift_id=str(body.get("zwiftId") or ""),
            public_id=body.get("publicId"),
            category=body.get("category"),
        )
    except StreamRiderError as exc:
        return jsonify({"message": exc.message}), exc.status_code

    _clear_live_riders_cache()
    return jsonify({"rider": payload}), 200


@admin_bp.route("/admin/stream-riders/<zwift_id>", methods=["DELETE"])
@admin_bp.route("/admin/races/<race_id>/stream-riders/<zwift_id>", methods=["DELETE"])
def delete_stream_rider(zwift_id: str, race_id: str | None = None):
    del race_id
    blocked = _guard()
    if blocked:
        return blocked

    try:
        result = remove_stream_rider(zwift_id)
    except StreamRiderError as exc:
        return jsonify({"message": exc.message}), exc.status_code

    _clear_live_riders_cache()
    return jsonify(result), 200
