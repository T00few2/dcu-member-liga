"""API for the Discord bot (X-Bot-Token). The bot only relays: all logic lives here.

- `POST /bot/ask`: answer a rider message in a help thread.
- `GET /bot/pending`: what the bot still has to post (new proposals and reply drafts for
  the admin channel) or deliver (approved replies and decisions for rider threads), plus
  admin-channel posts to update because they were decided on the admin page.
- `POST /bot/ack`: mark an item as posted / delivered so it is never sent twice.
- `POST /bot/proposals/<id>/decision`, `POST /bot/replies/<id>/decision`: admin buttons.
- `POST /bot/unanswered/<id>/resolve`: an admin marks an unanswered question as solved.
- `POST /bot/admin/ask`: an admin talks with the division agent in the admin channel
  (why a rider is in a division, what the agent suggests, prepare a move).
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

from flask import jsonify, request

from authz import AuthzError, require_bot
from extensions import db
from routes.integration import integration_bp
from services import predictor_service as ps
from services import velo_predictor as vp
from services.division_agent import admin_chat, chat, proposals
from services.division_agent import league_tools as lt

logger = logging.getLogger(__name__)

DECIDED = ("approved", "edited", "rejected")
# A move prepared in the admin chat is posted in that thread by the bot right away. Only if
# the bot never acknowledged it (crash, Discord error) does the relay post it in the channel.
ADMIN_CHAT_GRACE = timedelta(minutes=5)


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
            "riderStatement", "requestedBy", "locked", "movePreview", "status", "appliedCategory", "decidedBy")
    card = {k: p.get(k) for k in keys}
    card["divisions"] = ev.get("divisions") or []
    strava = ev.get("strava") or {}
    card["stravaRides"] = {k: strava.get(k) for k in ("activityCount", "indoorCount", "outdoorCount", "days")} \
        if strava else None
    return card


def _posting_in_thread(p: dict, now: datetime) -> bool:
    """A fresh admin-chat move the bot is posting in its thread itself."""
    if not (p.get("discord") or {}).get("adminChat"):
        return False
    try:
        created = datetime.fromisoformat(str(p.get("createdAt") or "").replace("Z", "+00:00"))
    except ValueError:
        return False
    created = created if created.tzinfo else created.replace(tzinfo=timezone.utc)
    return now - created < ADMIN_CHAT_GRACE


def _positive(value) -> int | None:
    v = vp.to_float(value)
    return round(v) if v and v > 0 else None


def rider_now(db, zwift_id) -> dict | None:
    """The rider's vELO and placement right now (read when a card is posted, not when the
    proposal was made), so the admin sees current values."""
    try:
        snap = db.collection("users").document(str(zwift_id)).get()
    except Exception as e:
        logger.warning("bot: could not read rider %s: %s", zwift_id, e)
        return None
    if not getattr(snap, "exists", False):
        return None
    data = snap.to_dict() or {}
    zr = data.get("zwiftRacing") or {}
    lc = data.get("ligaCategory") or {}
    manual = lc.get("manualAssigned") or {}
    return {
        "velo": _positive(zr.get("currentRating")),
        "max30": _positive(zr.get("max30Rating")),
        "locked": bool(lc.get("locked")),
        "holdCategory": manual.get("category") or None,
        "assignedFrom": (manual.get("assignedFrom") or "manual") if manual.get("category") else None,
        "selfSelected": (lc.get("selfSelected") or {}).get("category") or None,
    }


def _card_for_post(db, p: dict) -> dict:
    """A proposal card with the rider's current numbers, falling back to the proposal's evidence."""
    card = _proposal_card(p)
    rider = rider_now(db, p.get("zwiftId"))
    if rider is None:
        velo = (p.get("evidence") or {}).get("velo") or {}
        rider = {"velo": _positive(velo.get("current")), "max30": _positive(velo.get("max30")),
                 "locked": bool(p.get("locked")), "holdCategory": None, "assignedFrom": None, "selfSelected": None}
    card["rider"] = rider
    return card


def pending_items(db, now: datetime | None = None) -> list[dict]:
    t = now or datetime.now(timezone.utc)
    items: list[dict] = []
    for p in proposals.all_proposals(db):
        d = p.get("discord") or {}
        if p.get("status") == "pending" and not d.get("adminMessageId"):
            if not _posting_in_thread(p, t):
                items.append({"kind": "proposal", "id": p["id"], "proposal": _card_for_post(db, p)})
        elif p.get("status") != "pending" and d.get("adminMessageId") and not d.get("adminUpdated"):
            item = {"kind": "proposal_decided", "id": p["id"], "messageId": d["adminMessageId"],
                    "proposal": _proposal_card(p)}
            if d.get("adminChannelId"):  # posted in an admin-chat thread, not in the channel itself
                item["channelId"] = d["adminChannelId"]
            items.append(item)
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
    for snap in db.collection(lt.UNANSWERED).stream():
        u = snap.to_dict() or {}
        uid = u.get("id") or snap.id
        d = u.get("discord") or {}
        if u.get("status") == "open" and not d.get("adminMessageId"):
            items.append({"kind": "unanswered", "id": uid, "unanswered": {
                k: u.get(k) for k in ("id", "question", "missing", "threadId", "guildId", "createdAt")}})
        elif u.get("status") == "resolved" and d.get("adminMessageId") and not d.get("adminUpdated"):
            items.append({"kind": "unanswered_resolved", "id": uid, "messageId": d["adminMessageId"],
                          "resolvedBy": u.get("resolvedBy"), "note": u.get("note")})
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
        guild = str(body.get("guildId") or "") or None
        return jsonify(chat.ask(db, user, thread, [m for m in messages if isinstance(m, dict)],
                                guild_id=guild)), 200
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
    "unanswered": (lt.UNANSWERED, "discord.adminMessageId"),
    "unanswered_resolved": (lt.UNANSWERED, "discord.adminUpdated"),
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
    update = {field: value}  # dotted paths: only those nested fields change
    if kind == "proposal" and body.get("channelId"):
        update["discord.adminChannelId"] = str(body["channelId"])
    ref.update(update)
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


@integration_bp.route("/bot/unanswered/<item_id>/resolve", methods=["POST"])
def bot_unanswered_resolve(item_id: str):
    """The bot checks the admin role before calling this."""
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        item = lt.resolve_unanswered(db, item_id, resolved_by=_who(body),
                                     note=body.get("note") if isinstance(body.get("note"), str) else None)
        # The Discord post was just updated by the bot itself; nothing left to sync.
        db.collection(lt.UNANSWERED).document(item_id).update({"discord.adminUpdated": True})
        return jsonify({"unanswered": item}), 200
    except LookupError:
        return jsonify({"message": "Not found"}), 404
    except Exception as e:
        logger.error("bot_unanswered_resolve error: %s", e)
        return jsonify({"message": "Something went wrong"}), 500


@integration_bp.route("/bot/admin/ask", methods=["POST"])
def bot_admin_ask():
    """An admin's message in the admin channel. The bot checks the admin role before calling this."""
    err = _bot()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    messages = body.get("messages") if isinstance(body.get("messages"), list) else []
    if not messages:
        return jsonify({"message": "messages are required"}), 400
    try:
        out = admin_chat.ask(db, [m for m in messages if isinstance(m, dict)], admin_name=str(body.get("discordUser") or "admin")[:80],
                             thread_id=str(body.get("threadId") or "") or None)
        return jsonify({"reply": out["reply"], "proposals": [_card_for_post(db, p) for p in out["proposals"]]}), 200
    except Exception as e:
        logger.error("bot_admin_ask error: %s", e)
        return jsonify({"message": "Something went wrong"}), 500
