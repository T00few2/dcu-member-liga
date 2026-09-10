"""Admin: Zwift-only stream dummy riders on a race category pen."""
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


def _clear_live_riders_cache(race_id: str) -> None:
    try:
        from routes import live_race as live_race_mod

        prefix = f"{race_id}:"
        for key in [k for k in live_race_mod._LIVE_RIDERS_CACHE if str(k).startswith(prefix)]:
            live_race_mod._LIVE_RIDERS_CACHE.pop(key, None)
    except Exception:
        logger.debug("Could not clear live-riders cache for race %s", race_id, exc_info=True)


@admin_bp.route("/admin/races/<race_id>/stream-riders", methods=["GET"])
def get_stream_riders(race_id: str):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    race_doc = db.collection("races").document(str(race_id)).get()
    if not race_doc.exists:
        return jsonify({"message": "Race not found"}), 404

    return jsonify({"riders": list_stream_riders(race_id)}), 200


@admin_bp.route("/admin/races/<race_id>/stream-riders", methods=["POST"])
def post_stream_rider(race_id: str):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    body = request.get_json(silent=True) or {}
    try:
        payload = add_stream_rider(
            race_id,
            zwift_id=str(body.get("zwiftId") or ""),
            public_id=body.get("publicId"),
            category=body.get("category"),
        )
    except StreamRiderError as e:
        return jsonify({"message": e.message}), e.status_code

    _clear_live_riders_cache(race_id)
    return jsonify({"rider": payload}), 200


@admin_bp.route("/admin/races/<race_id>/stream-riders/<zwift_id>", methods=["DELETE"])
def delete_stream_rider(race_id: str, zwift_id: str):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    try:
        result = remove_stream_rider(race_id, zwift_id)
    except StreamRiderError as e:
        return jsonify({"message": e.message}), e.status_code

    _clear_live_riders_cache(race_id)
    return jsonify(result), 200
