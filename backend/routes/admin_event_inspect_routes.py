"""Admin read of one Zwift event document."""
from __future__ import annotations

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import get_zwift_game_service
from routes.admin import admin_bp
from services.event_inspect import EventInspectError, inspect_document, load_event


@admin_bp.route("/admin/zwift/events/<int:event_id>", methods=["GET"])
def get_zwift_event_inspection(event_id: int):
    try:
        require_admin(request)
    except AuthzError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    try:
        event = load_event(event_id)
        dictionary = get_zwift_game_service().get_game_dictionary()
    except EventInspectError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    return jsonify(inspect_document(event, dictionary))
