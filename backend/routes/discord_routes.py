"""Discord account linking routes (registered on the integration blueprint)."""
from __future__ import annotations

import datetime
import logging
import secrets

from firebase_admin import firestore
from flask import jsonify, redirect, request

from authz import AuthzError, verify_user_token
from config import FRONTEND_URL
from extensions import db
from routes.integration import _resolve_user_doc_ref_from_uid, integration_bp
from services import discord_link
from services.schema_validation import with_schema_version

logger = logging.getLogger(__name__)


def _user_ref(uid: str):
    return _resolve_user_doc_ref_from_uid(uid) or db.collection("users").document(uid)


@integration_bp.route("/discord/login", methods=["POST"])
def discord_login():
    """Start linking: returns the Discord authorize URL (scope `identify`)."""
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    if not discord_link.configured():
        return jsonify({"message": "Discord linking is not set up yet"}), 503
    state = secrets.token_urlsafe(32)
    db.collection(discord_link.STATES_COLLECTION).document(state).set({
        "uid": decoded["uid"],
        "createdAt": firestore.SERVER_TIMESTAMP,
    })
    return jsonify({"url": discord_link.authorize_url(state)}), 200


@integration_bp.route("/discord/callback", methods=["GET"])
def discord_callback():
    code, state, error = request.args.get("code"), request.args.get("state"), request.args.get("error")
    # The rider's browser lands here from Discord: always send them back to the app.
    if error:
        return redirect(f"{FRONTEND_URL}/register?discord=cancelled")
    if not code or not state or not db:
        return redirect(f"{FRONTEND_URL}/register?discord=error")
    state_ref = db.collection(discord_link.STATES_COLLECTION).document(state)
    snap = state_ref.get()
    if not snap.exists:
        return redirect(f"{FRONTEND_URL}/register?discord=expired")
    data = snap.to_dict() or {}
    try:
        created = data.get("createdAt")
        if isinstance(created, datetime.datetime) and (
                datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() \
                > discord_link.STATE_MAX_AGE_SECONDS:
            return redirect(f"{FRONTEND_URL}/register?discord=expired")
        identity = discord_link.fetch_identity(code)
        user_ref = _user_ref(str(data.get("uid")))
        other = discord_link.user_for_discord(db, identity["userId"])
        if other and other[0] != user_ref.id:
            return redirect(f"{FRONTEND_URL}/register?discord=taken")
        user_ref.set(with_schema_version({
            "connections": {"discord": {
                "userId": identity["userId"],
                "username": identity["username"],
                "linkedAt": firestore.SERVER_TIMESTAMP,
            }},
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }), merge=True)
    except discord_link.DiscordLinkError as e:
        logger.warning("discord link failed: %s", e.message)
        return redirect(f"{FRONTEND_URL}/register?discord=error")
    finally:
        try:
            state_ref.delete()
        except Exception as exc:
            logger.warning("could not delete Discord OAuth state: %s", exc)
    return redirect(f"{FRONTEND_URL}/register?discord=connected")


@integration_bp.route("/discord/unlink", methods=["POST"])
def discord_unlink():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        _user_ref(decoded["uid"]).update({"connections.discord": firestore.DELETE_FIELD})
    except Exception as exc:
        logger.warning("discord unlink failed: %s", exc)
        return jsonify({"message": "Could not unlink Discord"}), 500
    return jsonify({"message": "Discord unlinked"}), 200
