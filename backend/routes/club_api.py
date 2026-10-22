"""Club results API.

Clubs send a username and secret with HTTP Basic on every read. Admins issue
those credentials with a Firebase admin token.
"""

from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request

from authz import AuthzError, require_admin
from extensions import db
from services.club_api_auth import (
    ClubApiError,
    authenticate_header,
    club_standings,
    create_client,
    describe_api,
    list_clients,
    race_index,
    race_results,
    rotate_client,
    season_standings,
    set_revoked,
)

logger = logging.getLogger(__name__)

club_api_bp = Blueprint("club_api", __name__)


def _db_or_error():
    if not db:
        return jsonify({"error": "DB not available"}), 500
    return None


def _club_response(builder):
    unavailable = _db_or_error()
    if unavailable:
        return unavailable
    try:
        client = authenticate_header(db, request.headers.get("Authorization"))
        payload = builder(client)
    except ClubApiError as exc:
        response = jsonify({"message": exc.message})
        if exc.retry_after:
            response.headers["Retry-After"] = str(exc.retry_after)
        return response, exc.status_code
    except Exception as exc:
        logger.exception("Club API read failed: %s", exc)
        return jsonify({"message": "Could not load club results."}), 500
    return jsonify(payload), 200


def _admin_response(builder):
    try:
        require_admin(request)
    except AuthzError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    unavailable = _db_or_error()
    if unavailable:
        return unavailable
    try:
        payload = builder()
    except ClubApiError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    except Exception as exc:
        logger.exception("Club API admin request failed: %s", exc)
        return jsonify({"message": "Could not update the club API login."}), 500
    return jsonify(payload), 200


@club_api_bp.route("/club-api", methods=["GET"])
def get_club_api_index():
    return _club_response(lambda client: describe_api(client["club"]))


@club_api_bp.route("/club-api/races", methods=["GET"])
def get_club_races():
    return _club_response(lambda _client: race_index(db))


@club_api_bp.route("/club-api/races/<race_id>/results", methods=["GET"])
def get_club_race_results(race_id: str):
    return _club_response(lambda client: race_results(db, client, race_id))


@club_api_bp.route("/club-api/standings", methods=["GET"])
def get_club_standings():
    return _club_response(lambda client: season_standings(db, client))


@club_api_bp.route("/club-api/club-standings", methods=["GET"])
def get_club_club_standings():
    return _club_response(lambda client: club_standings(db, client))


@club_api_bp.route("/admin/club-api/clients", methods=["GET"])
def get_admin_club_api_clients():
    return _admin_response(lambda: list_clients(db))


@club_api_bp.route("/admin/club-api/clients", methods=["POST"])
def post_admin_club_api_client():
    body = request.get_json(silent=True) or {}

    def create():
        created = create_client(db, str(body.get("club") or ""), str(body.get("username") or ""))
        base_url = request.url_root.rstrip("/")
        secret = created["secret"]
        username = created["client"]["username"]
        created["baseUrl"] = base_url
        created["curl"] = f'curl -u "{username}:{secret}" {base_url}/club-api'
        return created

    return _admin_response(create)


@club_api_bp.route("/admin/club-api/clients/<username>/rotate", methods=["POST"])
def post_admin_club_api_rotate(username: str):
    def rotate():
        rotated = rotate_client(db, username)
        base_url = request.url_root.rstrip("/")
        secret = rotated["secret"]
        stored = rotated["client"]["username"]
        rotated["baseUrl"] = base_url
        rotated["curl"] = f'curl -u "{stored}:{secret}" {base_url}/club-api'
        return rotated

    return _admin_response(rotate)


@club_api_bp.route("/admin/club-api/clients/<username>/revoke", methods=["POST"])
def post_admin_club_api_revoke(username: str):
    return _admin_response(lambda: set_revoked(db, username, True))


@club_api_bp.route("/admin/club-api/clients/<username>/restore", methods=["POST"])
def post_admin_club_api_restore(username: str):
    return _admin_response(lambda: set_revoked(db, username, False))
