"""Discord account linking routes (registered on the integration blueprint)."""
from __future__ import annotations

import datetime
import hashlib
import hmac
import logging
import secrets
from urllib.parse import urlencode

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


def _expired(data: dict) -> bool:
    created = data.get("createdAt")
    return isinstance(created, datetime.datetime) and (
        datetime.datetime.now(datetime.timezone.utc) - created).total_seconds() > discord_link.STATE_MAX_AGE_SECONDS


@integration_bp.route("/discord/callback", methods=["GET"])
def discord_callback():
    """Discord sends the browser here. Nothing is linked yet: the identity is parked on the
    one-time state and the app confirms it with the logged-in rider's token (`/discord/confirm`),
    so a link started by someone else can never be completed in another rider's browser."""
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
    if _expired(data) or data.get("identity"):
        _delete_state(state_ref)
        return redirect(f"{FRONTEND_URL}/register?discord=expired")
    try:
        identity = discord_link.fetch_identity(code)
    except discord_link.DiscordLinkError as e:
        logger.warning("discord link failed: %s", e.message)
        _delete_state(state_ref)
        return redirect(f"{FRONTEND_URL}/register?discord=error")
    # Only the browser that came back from Discord gets this token, so a link started by
    # someone else can't be finished by them either.
    token = secrets.token_urlsafe(32)
    state_ref.update({"identity": identity, "confirmTokenHash": _hash(token)})
    return redirect(f"{FRONTEND_URL}/register?" + urlencode({"discord": "confirm", "state": state, "token": token}))


@integration_bp.route("/discord/confirm", methods=["POST"])
def discord_confirm():
    """Finish linking for the logged-in rider who started it."""
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    state, token = str(body.get("state") or ""), str(body.get("token") or "")
    if not state:
        return jsonify({"status": "error", "message": "Missing state"}), 400
    state_ref = db.collection(discord_link.STATES_COLLECTION).document(state)
    snap = state_ref.get()
    if not snap.exists:
        return jsonify({"status": "expired"}), 410
    data = snap.to_dict() or {}
    _delete_state(state_ref)  # one attempt only, whoever makes it
    identity = data.get("identity") or {}
    if str(data.get("uid")) != str(decoded["uid"]) or not token or not hmac.compare_digest(
            _hash(token), str(data.get("confirmTokenHash") or "")):
        logger.warning("discord confirm by a different user than the one who started the link")
        return jsonify({"status": "mismatch"}), 403
    if _expired(data) or not identity.get("userId"):
        return jsonify({"status": "expired"}), 410
    user_ref = _user_ref(str(decoded["uid"]))
    other = discord_link.user_for_discord(db, identity["userId"])
    if other and other[0] != user_ref.id:
        return jsonify({"status": "taken"}), 409
    user_ref.set(with_schema_version({
        "connections": {"discord": {
            "userId": identity["userId"],
            "username": identity.get("username") or "",
            "linkedAt": firestore.SERVER_TIMESTAMP,
        }},
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }), merge=True)
    return jsonify({"status": "connected", "username": identity.get("username") or ""}), 200


def _hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def _delete_state(state_ref) -> None:
    try:
        state_ref.delete()
    except Exception as exc:
        logger.warning("could not delete Discord OAuth state: %s", exc)


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
