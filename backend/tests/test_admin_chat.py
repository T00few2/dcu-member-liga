"""Admin chat in the Discord admin channel: rider search, division explanation, and moves as proposals."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import bot_routes  # noqa: E402
from services.division_agent import admin_chat, chat, proposals, runner  # noqa: E402
from tests.test_discord_chat import H, FakeClaude, _reply, _tool, chat_db, client  # noqa: E402,F401


def _results(claude):
    """The tool results Claude was sent, in order (the fake client keeps one shared message list)."""
    conv = claude.calls[-1]["messages"]
    return [json.loads(m["content"][0]["content"]) for m in conv[2::2]]


def test_riders_are_found_by_any_part_of_the_name_ignoring_case_and_accents():
    rows = [{"zwiftId": "1", "name": "Søren Ørsted Hansen", "club": "DCU", "category": "Gold"},
            {"zwiftId": "2", "name": "Rene Hansen", "category": "N/A"},
            {"zwiftId": "3", "name": "René Jensen", "category": "Silver", "locked": True}]
    assert [r["zwiftId"] for r in admin_chat.search_riders(rows, "hansen")] == ["2", "1"]  # alphabetical
    assert [r["zwiftId"] for r in admin_chat.search_riders(rows, "s")][0] == "1"  # name starts with it first
    assert [r["zwiftId"] for r in admin_chat.search_riders(rows, "rene")] == ["2", "3"]  # René too
    assert admin_chat.search_riders(rows, "søren hansen")[0]["division"] == "Gold"
    assert admin_chat.search_riders(rows, "2") == [{"zwiftId": "2", "name": "Rene Hansen", "club": None,
                                                    "division": None, "locked": False}]
    assert admin_chat.search_riders(rows, "  ") == []


def test_the_assignment_says_which_rule_decides_the_division():
    held = {"manualAssigned": {"category": "Silver", "assignedFrom": "admin"}, "autoAssigned": {"category": "Bronze"}}
    assert admin_chat.assignment(held, None)["decidedBy"].startswith("held there by an admin")
    predicted = {"manualAssigned": {"category": "Silver", "assignedFrom": "predicted", "predictedVelo": 1010}}
    out = admin_chat.assignment(predicted, None)
    assert "predicted vELO" in out["decidedBy"] and out["hold"]["predictedVelo"] == 1010
    selected = {"autoAssigned": {"category": "Bronze"}, "selfSelected": {"category": "Gold"}}
    assert "self-selected" in admin_chat.assignment(selected, None)["decidedBy"]
    assert admin_chat.assignment({"autoAssigned": {"category": "Gold"}}, None)["decidedBy"].startswith("assigned automatically")
    locked = {"locked": True, "category": "Gold", "autoAssigned": {"category": "Silver"}}
    out = admin_chat.assignment(locked, None)
    assert out["effectiveDivision"] == "Gold" and out["decidedBy"].startswith("locked")
    assert admin_chat.assignment(None, None)["decidedBy"] == "no division yet"


def test_an_admin_asks_why_and_gets_the_explanation_and_the_suggestion(chat_db):
    db, target = chat_db
    db.store["users/doc500"] = {"ligaCategory": {"autoAssigned": {"category": "Gold"}}}
    claude = FakeClaude([
        _tool("find_rider", {"query": "rider 500"}),
        _tool("explain_rider_division", {"zwiftId": target["zwiftId"]}),
        _reply("Rider 500 er i Gold fra sin vELO; jeg ville foreslå ..."),
    ])
    out = admin_chat.ask(db, [{"author": "admin", "name": "Boss", "text": "Hvorfor er Rider 500 i Gold?"}],
                         admin_name="Boss", thread_id="t1", client_factory=lambda: claude)
    assert out["reply"].startswith("Rider 500") and out["proposals"] == []
    assert claude.calls[0]["messages"][0]["content"] == "[Boss] Hvorfor er Rider 500 i Gold?"
    found, explained = _results(claude)
    assert found["matches"][0]["zwiftId"] == target["zwiftId"]
    assert explained["assignment"]["effectiveDivision"] == "Gold"
    assert explained["agentSuggestion"]["category"] and "divisionLimits" in explained
    assert not any(k.startswith(proposals.COLLECTION) for k in db.store)  # asking writes nothing


def test_a_move_becomes_an_admin_proposal_that_only_approve_applies(chat_db, monkeypatch):
    db, target = chat_db
    db.store[f"users/{target['zwiftId']}"]["ligaCategory"] = {"autoAssigned": {"category": "Gold"}}
    db.store["users/doc500"] = db.store[f"users/{target['zwiftId']}"]
    claude = FakeClaude([
        _tool("move_rider", {"zwiftId": target["zwiftId"], "division": "silver", "reason": "Injured"}),
        _reply("Forslaget er lagt i tråden – tryk Approve."),
    ])
    out = admin_chat.ask(db, [{"author": "admin", "name": "Boss", "text": "Flyt Rider 500 til Silver"}],
                         admin_name="Boss", thread_id="t1", client_factory=lambda: claude)
    [p] = out["proposals"]
    assert p["origin"] == "admin" and p["proposedCategory"] == "Silver" and p["currentCategory"] == "Gold"
    assert p["requestedBy"] == "Boss" and "Injured" in p["adminRationale"]
    assert p["discord"] == {"adminChat": True, "adminThreadId": "t1"}
    assert p["status"] == "pending"  # nothing applied yet

    # The agent's own re-check never closes it, and a newer agent card does not replace it.
    assert proposals.supersede_pending(db, target["zwiftId"]) == 0
    proposals.create(db, {"zwiftId": target["zwiftId"], "origin": "agent", "proposedCategory": "Gold"})
    assert db.store[f"{proposals.COLLECTION}/{p['id']}"]["status"] == "pending"

    calls = []
    monkeypatch.setattr(proposals.liga_assignment, "manual_assign",
                        lambda _db, uid, data, cat: calls.append(("manual", cat)))
    monkeypatch.setattr(proposals.liga_assignment, "predict_assign",
                        lambda *a: calls.append(("predict",)))
    done = proposals.decide(db, p["id"], "approve", decided_by="discord:Boss")
    assert calls == [("manual", "Silver")] and done["status"] == "approved"  # an admin placement


def test_bad_moves_are_refused_to_the_model(chat_db):
    db, target = chat_db
    db.store["users/doc500"] = {"ligaCategory": {"autoAssigned": {"category": "Gold"}}}
    claude = FakeClaude([
        _tool("move_rider", {"zwiftId": target["zwiftId"], "division": "Mithril"}),
        _tool("move_rider", {"zwiftId": target["zwiftId"], "division": "Gold"}),
        _tool("move_rider", {"zwiftId": "nobody", "division": "Gold"}),
        _reply("Det kunne jeg ikke."),
    ])
    out = admin_chat.ask(db, [{"author": "admin", "text": "flyt"}], admin_name="Boss", client_factory=lambda: claude)
    errors = [r["error"] for r in _results(claude)]
    assert errors[0].startswith("Unknown division") and "already in Gold" in errors[1]
    assert "No registered rider" in errors[2]
    assert out["proposals"] == []


def test_without_a_model_the_admin_gets_a_clear_fallback(chat_db):
    db, _ = chat_db
    out = admin_chat.ask(db, [{"author": "admin", "text": "?"}], admin_name="Boss", client_factory=lambda: None)
    assert out == {"reply": f"{admin_chat.FALLBACK} (no API key)", "proposals": []}


def test_the_bot_api_returns_cards_and_the_relay_waits_for_the_thread_post(client, monkeypatch):
    http, db, target = client
    db.store["users/doc500"] = {"ligaCategory": {"autoAssigned": {"category": "Gold"}}}
    db.store[f"users/{target['zwiftId']}"]["ligaCategory"] = {"autoAssigned": {"category": "Gold"}}
    claude = FakeClaude([_tool("move_rider", {"zwiftId": target["zwiftId"], "division": "Silver"}), _reply("ok")])
    monkeypatch.setattr(admin_chat.assess_mod, "client_from_env", lambda: claude)
    assert http.post("/bot/admin/ask", json={"messages": [{"text": "x"}]}).status_code == 403
    res = http.post("/bot/admin/ask", headers=H, json={
        "messages": [{"author": "admin", "name": "Boss", "text": "Flyt Rider 500 til Silver"}],
        "threadId": "t1", "discordUser": "Boss"}).get_json()
    [card] = res["proposals"]
    assert res["reply"] == "ok" and card["requestedBy"] == "Boss" and card["divisions"]

    # The bot posts it in the thread itself; the relay leaves it alone for a few minutes ...
    assert http.get("/bot/pending", headers=H).get_json()["items"] == []
    later = datetime.now(timezone.utc) + bot_routes.ADMIN_CHAT_GRACE + timedelta(seconds=1)
    assert [i["id"] for i in bot_routes.pending_items(db, now=later)] == [card["id"]]  # ... then posts it
    # Acknowledged with the thread: a decision on the admin page later updates the thread post.
    assert http.post("/bot/ack", headers=H, json={"kind": "proposal", "id": card["id"], "messageId": "m9",
                                                  "channelId": "t1"}).status_code == 200
    assert bot_routes.pending_items(db, now=later) == []
    db.store[f"{proposals.COLLECTION}/{card['id']}"]["status"] = "rejected"
    [item] = [i for i in http.get("/bot/pending", headers=H).get_json()["items"] if i["kind"] == "proposal_decided"]
    assert item["channelId"] == "t1" and item["messageId"] == "m9"


def test_an_admin_request_replaces_the_agent_card_but_never_an_appeal(chat_db):
    db, target = chat_db
    zid = target["zwiftId"]
    appeal = runner.file_appeal(db, zid, "please", None, client_factory=lambda: None)
    agent = proposals.create(db, {"zwiftId": zid, "origin": "agent", "proposedCategory": "Gold"})
    request = proposals.create(db, {"zwiftId": zid, "origin": "admin", "proposedCategory": "Silver"})
    status = {k: db.store[f"{proposals.COLLECTION}/{p['id']}"]["status"] for k, p in
              (("appeal", appeal), ("agent", agent), ("request", request))}
    assert status == {"appeal": "pending", "agent": "superseded", "request": "pending"}


def test_a_second_move_for_the_same_rider_posts_only_the_live_card(chat_db):
    db, target = chat_db
    db.store["users/doc500"] = {"ligaCategory": {"autoAssigned": {"category": "Gold"}}}
    claude = FakeClaude([
        _tool("move_rider", {"zwiftId": target["zwiftId"], "division": "Silver"}),
        _tool("move_rider", {"zwiftId": target["zwiftId"], "division": "Bronze"}),
        _reply("ok"),
    ])
    out = admin_chat.ask(db, [{"author": "admin", "text": "flyt"}], admin_name="Boss", client_factory=lambda: claude)
    [p] = out["proposals"]
    assert p["proposedCategory"] == "Bronze" and db.store[f"{proposals.COLLECTION}/{p['id']}"]["status"] == "pending"


def test_the_filter_preview_does_not_count_admin_requests_as_closable(chat_db):
    db, target = chat_db
    request = proposals.create(db, {"zwiftId": target["zwiftId"], "origin": "admin", "proposedCategory": "Silver"})
    rows = [{"zwiftId": target["zwiftId"]}]
    settings = {"minZwiftRides": 15, "reviewFilter": {"reasons": []}}
    assert runner.filter_preview(rows, settings, [request])["pendingOutside"] == 0
    agent = proposals.create(db, {"zwiftId": target["zwiftId"], "origin": "agent", "proposedCategory": "Gold"})
    assert runner.filter_preview(rows, settings, [request, agent])["pendingOutside"] == 1


def test_velo_check_places_each_number_so_the_model_never_compares_itself():
    # The case from the admin channel: locked in Ruby (1900-2200), current 1882, max30 1902.
    check = chat.velo_check({"current": 1882, "max30": 1902, "max90": None}, "Ruby", None)
    assert check["current"] == {"velo": 1882, "divisionForThisVelo": "Emerald",
                                "comparedToCurrentDivision": "below the lower limit of Ruby (1900)"}
    assert check["max30"]["divisionForThisVelo"] == "Ruby"
    assert check["max30"]["comparedToCurrentDivision"].startswith("inside Ruby")
    assert check["assignmentVelo"]["velo"] == 1902 and "max90" not in check
    grace = chat.velo_check({"current": 2210}, "Ruby", None)["current"]["comparedToCurrentDivision"]
    assert "within the grace limit (2235)" in grace
    assert "above the grace limit" in chat.velo_check({"current": 2240}, "Ruby", None)["current"][
        "comparedToCurrentDivision"]
    assert chat.velo_check({"current": 2500}, "Diamond", None)["current"]["comparedToCurrentDivision"].startswith(
        "inside Diamond")


def test_a_reply_cut_off_while_thinking_says_why_and_the_cap_leaves_room():
    cut = SimpleNamespace(stop_reason="max_tokens", content=[SimpleNamespace(type="thinking", thinking="")],
                          usage=SimpleNamespace(input_tokens=10, output_tokens=16000))
    claude = FakeClaude([cut])
    text, usage = chat.converse([{"role": "user", "content": "?"}], model="m", tools={}, client=claude)
    assert text == "" and usage["stopReason"] == "max_tokens"
    assert claude.calls[0]["max_tokens"] >= 16000  # thinking counts against the cap


def test_the_admin_sees_why_there_was_no_answer(chat_db):
    db, _ = chat_db
    cut = SimpleNamespace(stop_reason="max_tokens", content=[], usage=None)
    out = admin_chat.ask(db, [{"author": "admin", "text": "?"}], admin_name="Boss",
                         client_factory=lambda: FakeClaude([cut]))
    assert out["reply"] == f"{admin_chat.FALLBACK} (max_tokens)"


def test_posted_cards_carry_the_riders_current_velo_and_placement(client):
    http, db, target = client
    zid = target["zwiftId"]
    db.store[f"users/{zid}"].update({
        "zwiftRacing": {"currentRating": 1882.4, "max30Rating": 1902, "max90Rating": "N/A"},
        "ligaCategory": {"locked": False, "manualAssigned": {"category": "Gold", "assignedFrom": "admin"},
                         "selfSelected": {"category": "Platinum"}},
    })
    p = proposals.create(db, {"zwiftId": zid, "origin": "agent", "proposedCategory": "Silver"})
    [item] = [i for i in http.get("/bot/pending", headers=H).get_json()["items"] if i["id"] == p["id"]]
    assert item["proposal"]["rider"] == {"velo": 1882, "max30": 1902, "locked": False, "holdCategory": "Gold",
                                         "assignedFrom": "admin", "selfSelected": "Platinum"}
    # A rider without a user document falls back to the proposal's own evidence.
    gone = proposals.create(db, {"zwiftId": "nobody", "origin": "agent", "locked": True,
                                 "evidence": {"velo": {"current": 1500, "max30": 0}}})
    card = bot_routes._card_for_post(db, gone)
    assert card["rider"]["velo"] == 1500 and card["rider"]["max30"] is None and card["rider"]["locked"]
