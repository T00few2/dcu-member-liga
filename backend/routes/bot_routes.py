"""API for the Discord bot (X-Bot-Token). The bot only relays: all logic lives here.

- `POST /bot/ask`: answer a rider message in a help thread.
- `GET /bot/pending`: what the bot still has to post (new proposals and reply drafts for
  the admin channel) or deliver (approved replies and decisions for rider threads), plus
  admin-channel posts to update because they were decided on the admin page.
- `POST /bot/ack`: mark an item as posted / delivered so it is never sent twice.
- `POST /bot/proposals/<id>/decision`, `POST /bot/replies/<id>/decision`: admin buttons.
"""
from __future__ import annotations

import logging

from flask import jsonify, request

from authz import AuthzError, require_bot
from extensions import db
from routes.integration import integration_bp
from services import predictor_service as ps
from services.division_agent import chat, proposals

logger = logging.getLogger(__name__)

DECIDED = ("approved", "edited", "rejected")


def _bot():
    try:
        require_bot(request)
        return None
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code


def _outcome_text(p: dict) -> str:
    if p.get("status") == "rejected":
        return ("En admin har set på din sag og beholder din nuværende division. / "
                "An admin reviewed your request and kept your current division.")
    cat = p.get("appliedCategory") or p.get("proposedCategory")
    return f"En admin har besluttet: din division er nu {cat}. / An admin decided: your division is now {cat}."


def _proposal_card(p: dict) -> dict:
    ev = p.get("evidence") or {}
    keys = ("id", "zwiftId", "name", "origin", "currentCategory", "proposedCategory", "suggestedCategory",
            "requestedCategory", "predictedVelo", "source", "confidence", "flags", "adminRationale",
            "riderStatement", "locked", "movePreview", "status", "appliedCategory", "decidedBy")
    card = {k: p.get(k) for k in keys}
    card["divisions"] = ev.get("divisions") or []
    strava = ev.get("strava") or {}
    card["stravaRides"] = {k: strava.get(k) for k in ("activityCount", "indoorCount", "outdoorCount", "days")} \
        if strava else None
    return card


def pending_items(db) -> list[dict]:
    items: list[dict] = []
    for p in proposals.all_proposals(db):
        d = p.get("discord") or {}
        if p.get("status") == "pending" and not d.get("adminMessageId"):
            items.append({"kind": "proposal", "id": p["id"], "proposal": _proposal_card(p)})
        elif p.get("status") != "pending" and d.get("adminMessageId") and not d.get("adminUpdated"):
            items.append({"kind": "proposal_decided", "id": p["id"], "messageId": d["adminMessageId"],
                          "proposal": _proposal_card(p)})
        if p.get("status") in DECIDED and d.get("threadId") and not d.get("riderNotified"):
            items.append({"kind": "outcome", "id": p["id"], "threadId": d["threadId"], "text": _outcome_text(p)})
    for snap in db.collection(chat.DRAFTS).stream():
        r = snap.to_dict() or {}
        if r.get("status") == "pending" and not r.get("adminMessageId"):
            items.append({"kind": "draft", "id": r.get("id") or snap.id, "draft": {
                k: r.get(k) for k in ("id", "threadId", "zwiftId", "name", "question", "draft", "proposalId")}})
        elif r.get("status") in ("sent", "edited") and not r.get("delivered"):
            items.append({"kind": "reply", "id": r.get("id") or snap.id, "threadId": r.get("threadId"),
                          "text": r.get("finalText") or r.get("draft")})
        if r.get("status") != "pending" and r.get("adminMessageId") and not r.get("adminUpdated"):
            items.append({"kind": "draft_decided", "id": r.get("id") or snap.id,
                          "messageId": r["adminMessageId"], "status": r.get("status")})
    return items


@integration_bp.route("/bot/ask", methods=["POST"])
def bot_ask():
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    user, thread = str(body.get("discordUserId") or ""), str(body.get("threadId") or "")
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    if not user or not thread or not messages:
        return jsonify({"message": "discordUserId, threadId and messages are required"}), 400
    try:
        return jsonify(chat.ask(db, user, thread, [m for m in messages if isinstance(m, dict)])), 200
    except Exception as e:
        logger.error("bot_ask error: %s", e)
        return jsonify({"message": "Something went wrong"}), 500


@integration_bp.route("/bot/pending", methods=["GET"])
def bot_pending():
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify({"items": pending_items(db)}), 200
    except Exception as e:
        logger.error("bot_pending error: %s", e)
        return jsonify({"message": "Something went wrong"}), 500


ACK_FIELDS = {
    # kind: (collection, field set to true or to the posted message id)
    "proposal": (proposals.COLLECTION, "discord.adminMessageId"),
    "proposal_decided": (proposals.COLLECTION, "discord.adminUpdated"),
    "outcome": (proposals.COLLECTION, "discord.riderNotified"),
    "draft": (chat.DRAFTS, "adminMessageId"),
    "draft_decided": (chat.DRAFTS, "adminUpdated"),
    "reply": (chat.DRAFTS, "delivered"),
}


@integration_bp.route("/bot/ack", methods=["POST"])
def bot_ack():
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    kind, item_id = str(body.get("kind") or ""), str(body.get("id") or "")
    if kind not in ACK_FIELDS or not item_id:
        return jsonify({"message": "Unknown kind or missing id"}), 400
    collection, field = ACK_FIELDS[kind]
    value = str(body.get("messageId") or "") if field.endswith("MessageId") else True
    if value == "":
        return jsonify({"message": "messageId is required"}), 400
    ref = db.collection(collection).document(item_id)
    if not getattr(ref.get(), "exists", False):
        return jsonify({"message": "Not found"}), 404
    ref.update({field: value})  # dotted path: only that nested field changes
    return jsonify({"ok": True}), 200


def _who(body: dict) -> str:
    return "discord:" + (str(body.get("discordUser") or "admin")[:80])


@integration_bp.route("/bot/proposals/<proposal_id>/decision", methods=["POST"])
def bot_proposal_decision(proposal_id: str):
    """The bot checks the admin role before calling this."""
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        result = proposals.decide(
            db, proposal_id, str(body.get("action") or ""), decided_by=_who(body),
            category=body.get("category") if isinstance(body.get("category"), str) else None,
            note=body.get("note") if isinstance(body.get("note"), str) else None,
        )
        ps.clear_caches()
        return jsonify({"proposal": _proposal_card(result)}), 200
    except proposals.ProposalError as e:
        return jsonify({"message": e.message}), e.status_code
    except Exception as e:
        logger.error("bot_proposal_decision error: %s", e)
        return jsonify({"message": "Something went wrong"}), 500


@integration_bp.route("/bot/replies/<draft_id>/decision", methods=["POST"])
def bot_reply_decision(draft_id: str):
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        draft = chat.decide_reply(db, draft_id, str(body.get("action") or ""), decided_by=_who(body),
                                  text=body.get("text") if isinstance(body.get("text"), str) else None)
        return jsonify({"draft": draft}), 200
    except LookupError:
        return jsonify({"message": "Not found"}), 404
    except ValueError as e:
        return jsonify({"message": str(e)}), 400
