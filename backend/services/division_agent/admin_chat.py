"""Admin chat in the Discord admin channel: ask the division agent about a rider and tell it to move one.

An admin mentions the bot in the admin channel (the bot opens a thread) and keeps talking
in that thread. Claude gets admin tools:

- `find_rider`: search registered riders by name (or Zwift ID);
- `explain_rider_division`: why a rider is in their division (locked after racing, admin
  hold, prediction hold, vELO auto-assignment, self-selection), their numbers, the
  division the agent would suggest, and the rider's recent proposals and transfers;
- `move_rider`: prepare a move as a proposal (origin "admin"). The bot posts it in the
  thread with the usual Approve / Edit / Reject buttons, so the division only changes on
  an admin's click, exactly as for the agent's own proposals.

Unlike the rider chat, Claude sees rider names here: admins ask about riders by name.
The bot checks the admin role before calling; the backend trusts the bot token.
"""
from __future__ import annotations

import logging
import unicodedata
from typing import Any, Callable

from services import predictor_service as ps
from services.category_engine import GRACE_POINTS, effective_liga_category_name
from services.division_agent import assess as assess_mod
from services.division_agent import chat, decide, evidence, proposals, runner, triage

logger = logging.getLogger(__name__)

MAX_MATCHES = 10
HISTORY_LIMIT = 30
FALLBACK = ("Jeg kunne ikke svare lige nu (ingen svar fra modellen). Prøv igen om lidt, eller brug admin-siden. / "
            "I could not answer right now (no model reply). Try again shortly, or use the admin page.")

SYSTEM_PROMPT = f"""You are the division agent of DCU E-serien, a Danish Zwift racing league, talking with the league
ADMINS in their private Discord admin channel. Admins ask why a rider is in a division, which division you would
suggest, and may tell you to move a rider.

How divisions work: divisions follow the rider's vELO (ZwiftRacing rating), hardest first. A rider's effective
division is, in this order: the locked division once they have raced this season (only a category transfer moves
them); otherwise the harder of the assignment floor and the division the rider self-selected. The assignment floor
is an admin's or the agent's hold (`manualAssigned`, assignedFrom "admin" = placed by hand, "predicted" = placed
from a predicted vELO) or else the automatic assignment from the real vELO (`autoAssigned`). A rider may sit up to
{GRACE_POINTS} vELO points above the division's upper limit (the grace margin) before being moved up. Riders with no
vELO or few Zwift rides are placed from predicted power data (Strava indoor/outdoor and Zwift power).

Rules:
- Reply in the language the admin writes in (Danish or English). Be short and concrete (at most about 200 words).
- Always look riders up with `find_rider` first. If several riders match, list them (name, club, Zwift ID,
  division) and ask which one is meant; never guess. If none match, say so.
- Use `explain_rider_division` before saying anything about a rider's division or numbers, and only use numbers
  it returns. Explain which rule decides the current division, then the division you suggest and why (the
  `agentSuggestion` and the evidence: source, confidence, data-quality flags). Say plainly when the data is weak.
- Call `move_rider` only when an admin clearly tells you to move a specific rider to a specific division (and
  after you know exactly which rider). Pass the admin's reason. The move is NOT applied yet: tell the admin that a
  proposal card with Approve / Edit / Reject has been posted in this thread and that Approve applies it. For a
  rider locked after racing, say that approving makes a category transfer (pens, credited races, standings).
- If the admin only asks what you would suggest, do not call `move_rider`.
- Never use the Zwift Racing Score (ZRS) as a reason for a division."""

_NO_INPUT = {"type": "object", "properties": {}, "additionalProperties": False}
_ZWIFT_ID = {"type": "string", "description": "The rider's Zwift ID, from find_rider."}

TOOLS = [
    {
        "name": "find_rider",
        "description": "Search registered riders by name (any part of the name, case and accents ignored) or by "
                       "Zwift ID. Returns up to 10 matches with Zwift ID, name, club and current division.",
        "input_schema": {"type": "object", "properties": {"query": {"type": "string"}}, "required": ["query"],
                         "additionalProperties": False},
    },
    {
        "name": "explain_rider_division",
        "description": "Why one rider is in their current division: the assignment breakdown (locked, admin or "
                       "prediction hold, vELO auto-assignment, self-selection), vELO and ride counts, predicted "
                       "vELO from Strava and Zwift power, data-quality flags, the division the agent suggests, "
                       "division limits, and the rider's recent proposals and category transfers.",
        "input_schema": {"type": "object", "properties": {"zwiftId": _ZWIFT_ID}, "required": ["zwiftId"],
                         "additionalProperties": False},
    },
    {
        "name": "move_rider",
        "description": "Prepare moving a rider to a division, on an admin's explicit instruction. Creates a "
                       "proposal that is posted in this thread with Approve / Edit / Reject; nothing changes "
                       "until an admin clicks Approve.",
        "input_schema": {
            "type": "object",
            "properties": {
                "zwiftId": _ZWIFT_ID,
                "division": {"type": "string", "description": "The target division, exactly as listed."},
                "reason": {"type": "string", "description": "The admin's reason, in their words."},
            },
            "required": ["zwiftId", "division"],
            "additionalProperties": False,
        },
    },
]


def _fold(text: Any) -> str:
    """Lower case without accents, for name search."""
    norm = unicodedata.normalize("NFKD", str(text or "").casefold())
    return "".join(c for c in norm if not unicodedata.combining(c))


def search_riders(rows: list[dict], query: str, limit: int = MAX_MATCHES) -> list[dict]:
    q = str(query or "").strip()
    if not q:
        return []
    exact = [r for r in rows if str(r.get("zwiftId") or "") == q]
    if exact:
        matches = exact
    else:
        words = _fold(q).split()
        matches = [r for r in rows if words and all(w in _fold(r.get("name")) for w in words)]
        matches.sort(key=lambda r: (not _fold(r.get("name")).startswith(words[0]), _fold(r.get("name"))))
    return [{"zwiftId": str(r.get("zwiftId")), "name": r.get("name"), "club": r.get("club"),
             "division": r.get("category") if r.get("category") not in (None, "N/A") else None,
             "locked": bool(r.get("locked"))} for r in matches[:limit]]


def _ts(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        try:
            return value.isoformat()
        except Exception:
            return None
    return str(value)


def assignment(lc: dict | None, categories: Any) -> dict:
    """Which rule decides the rider's effective division, with each part of `ligaCategory`."""
    lc = lc if isinstance(lc, dict) else {}
    manual = lc.get("manualAssigned") or {}
    auto = lc.get("autoAssigned") or {}
    sel = lc.get("selfSelected") or {}
    effective = effective_liga_category_name(lc, categories) or None
    if lc.get("locked"):
        decided_by = "locked after racing this season (only a category transfer moves the rider)"
    elif not effective:
        decided_by = "no division yet"
    elif sel.get("category") == effective and sel.get("category") != (manual.get("category") or auto.get("category")):
        decided_by = "the rider self-selected a harder division than their assignment"
    elif manual.get("category"):
        decided_by = {"admin": "held there by an admin (placed by hand)",
                      "predicted": "held there from a predicted vELO (agent proposal or predict-assign)"}.get(
            manual.get("assignedFrom"), f"held there ({manual.get('assignedFrom') or 'manual'})")
    else:
        decided_by = "assigned automatically from the rider's vELO"
    out = {
        "effectiveDivision": effective,
        "decidedBy": decided_by,
        "locked": bool(lc.get("locked")),
        "lockedAt": _ts(lc.get("lockedAt")),
        "lockedDivision": lc.get("category") if lc.get("locked") else None,
        "hold": {"division": manual.get("category"), "assignedFrom": manual.get("assignedFrom"),
                 "predictedVelo": manual.get("predictedVelo"), "assignedRating": manual.get("assignedRating"),
                 "assignedAt": _ts(manual.get("assignedAt"))} if manual.get("category") else None,
        "auto": {"division": auto.get("category"), "assignedRating": auto.get("assignedRating"),
                 "lastCheckedRating": auto.get("lastCheckedRating"), "status": auto.get("status"),
                 "upperBoundary": auto.get("upperBoundary"), "graceLimit": auto.get("graceLimit")}
        if auto.get("category") else None,
        "selfSelected": sel.get("category") or None,
    }
    return out


def _history(db: Any, zwift_id: str) -> dict:
    rows = proposals.for_rider(proposals.all_proposals(db), zwift_id)[:5]
    props = [{k: p.get(k) for k in ("origin", "status", "currentCategory", "proposedCategory", "appliedCategory",
                                     "suggestedCategory", "requestedCategory", "riderStatement", "decidedBy",
                                     "decisionNote", "createdAt", "decidedAt")} for p in rows]
    transfers = []
    try:
        from services import category_transfer
        transfers = [{k: t.get(k) for k in ("fromCategory", "toCategory", "status", "createdAtIso")}
                     for t in category_transfer.list_transfers(db) if str(t.get("zwiftId")) == str(zwift_id)][:5]
    except Exception as exc:
        logger.warning("admin chat: could not read transfers for %s: %s", zwift_id, exc)
    return {"proposals": [{k: v for k, v in p.items() if v not in (None, "")} for p in props],
            "transfers": transfers}


def explain_rider(db: Any, zwift_id: str, settings: dict) -> dict:
    ctx = runner.rider_context(db, zwift_id)
    if ctx is None:
        return {"error": "No registered rider with that Zwift ID."}
    row, user_data, bundle = ctx
    categories = bundle[2]
    ev = runner.rider_evidence(db, row, user_data, bundle, settings)
    suggestion = decide.suggest(ev, categories)
    info = chat.explain(ev, categories)
    info.pop("currentDivision", None)
    info.pop("lockedAfterRacing", None)
    return {
        "zwiftId": str(row.get("zwiftId")),
        "name": row.get("name"),
        "club": row.get("club"),
        "assignment": assignment(user_data.get("ligaCategory"), categories),
        **info,
        "weightKg": ev.get("weightKg"),
        "hasStrava": ev.get("hasStrava"),
        "agentReviewReasons": triage.needs_review(row, settings),
        "agentSuggestion": suggestion,
        "history": _history(db, str(row.get("zwiftId"))),
    }


def prepare_move(db: Any, zwift_id: str, division: str, *, reason: str, requested_by: str,
                 thread_id: str | None, settings: dict) -> dict:
    """An admin-instructed move as a pending proposal (origin "admin"). Returns the proposal."""
    ctx = runner.rider_context(db, zwift_id)
    if ctx is None:
        raise ValueError("No registered rider with that Zwift ID.")
    row, user_data, bundle = ctx
    categories = bundle[2]
    ev = runner.rider_evidence(db, row, user_data, bundle, settings)
    names = evidence.division_names(categories)
    target = next((d for d in names if d.casefold() == str(division or "").strip().casefold()), None)
    if target is None:
        raise ValueError("Unknown division. Choose one of: " + ", ".join(names))
    if target == ev["currentCategory"]:
        raise ValueError(f"The rider is already in {target}.")
    suggestion = decide.suggest(ev, categories)
    reason = (reason or "").strip()[:1000]
    data = {
        "zwiftId": str(row["zwiftId"]),
        "name": row.get("name") or "",
        "origin": "admin",
        "reasons": ["admin"],
        "requestedBy": requested_by,
        "requestedCategory": target,
        "currentCategory": ev["currentCategory"],
        "proposedCategory": target,
        "suggestedCategory": suggestion.get("category"),
        "predictedVelo": suggestion.get("velo"),
        "source": suggestion.get("source"),
        "confidence": suggestion.get("confidence"),
        "flags": list(ev["flags"]),
        "evidence": ev,
        "adminRationale": f"Requested by {requested_by} in the Discord admin channel"
                          + (f": {reason}" if reason else "."),
        "riderExplanation": "",
        "author": "admin",
        "model": None,
        "usage": None,
        "locked": ev["locked"],
        "movePreview": None,
        "evidenceFingerprint": evidence.fingerprint(ev),
        "discord": {"adminChat": True, **({"adminThreadId": str(thread_id)} if thread_id else {})},
    }
    if ev["locked"]:
        data["movePreview"] = runner._move_preview(db, row, user_data, target)
    return proposals.create(db, data)


def _messages(messages: list[dict]) -> list[dict]:
    """Thread history → alternating turns; each admin message is prefixed with the admin's name."""
    out: list[dict] = []
    for m in messages[-HISTORY_LIMIT:]:
        text = str(m.get("text") or "").strip()[:2000]
        if not text:
            continue
        role = "assistant" if m.get("author") == "bot" else "user"
        if role == "user" and m.get("name"):
            text = f"[{str(m['name'])[:60]}] {text}"
        if out and out[-1]["role"] == role:
            out[-1]["content"] += "\n\n" + text
        else:
            out.append({"role": role, "content": text})
    while out and out[0]["role"] != "user":
        out.pop(0)
    return out


def ask(
    db: Any,
    messages: list[dict],
    *,
    admin_name: str,
    thread_id: str | None = None,
    client_factory: Callable[[], Any] | None = None,
) -> dict:
    """Answer an admin in the admin channel. Returns `{reply, proposals}`: `proposals` are the moves
    prepared in this turn, for the bot to post with Approve / Edit / Reject."""
    settings = ps.division_agent_settings(db)
    prepared: list[dict] = []

    def find_tool(args: dict) -> dict:
        query = str(args.get("query") or "")
        rows = ps.get_model(db)[1]
        found = search_riders(rows, query)
        if not found:  # the cached rows can be two minutes old
            found = search_riders(ps.load_participants(db), query)
        return {"matches": found} if found else {"matches": [], "note": "No registered rider matches."}

    def move_tool(args: dict) -> dict:
        try:
            p = prepare_move(db, str(args.get("zwiftId") or ""), str(args.get("division") or ""),
                             reason=str(args.get("reason") or ""), requested_by=admin_name,
                             thread_id=thread_id, settings=settings)
        except ValueError as exc:
            return {"error": str(exc)}
        prepared.append(p)
        return {"status": "proposal posted in this thread; an admin must click Approve to apply it",
                "from": p.get("currentCategory"), "to": p.get("proposedCategory"), "locked": p.get("locked"),
                "transferPreview": (p.get("movePreview") or {}).get("message")}

    tools: dict[str, Callable[[dict], dict]] = {
        "find_rider": find_tool,
        "explain_rider_division": lambda a: explain_rider(db, str(a.get("zwiftId") or ""), settings),
        "move_rider": move_tool,
    }
    text = ""
    try:
        client = (client_factory or assess_mod.client_from_env)()
    except Exception as exc:
        logger.warning("admin chat: no Claude client: %s", exc)
        client = None
    conv = _messages(messages)
    if client is not None and conv:
        try:
            text, _usage = chat.converse(conv, model=settings["chatModel"], tools=tools, client=client,
                                         system=SYSTEM_PROMPT, tool_specs=TOOLS)
        except Exception as exc:
            logger.warning("admin chat: Claude call failed: %s", exc)
    if not text:
        text = FALLBACK if not prepared else "Forslaget er lagt i tråden. / The proposal is posted in the thread."
    return {"reply": text, "proposals": prepared}
