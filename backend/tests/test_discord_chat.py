"""Discord linking, the rider chat (drafts, appeals, rate limit) and the bot API."""
from __future__ import annotations

import os
from datetime import datetime, timezone
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import authz  # noqa: E402
from authz import AuthzError  # noqa: E402
from services import discord_link  # noqa: E402
from services import predictor_service as ps  # noqa: E402
from services.division_agent import chat, proposals, runner  # noqa: E402
from services.division_agent import league_tools as lt  # noqa: E402
from tests.test_admin_predictor_routes import FakeSnap  # noqa: E402
from tests.test_division_agent import CATS, MODEL, TRAINING, _target  # noqa: E402

DELETE = object()


class Doc:
    def __init__(self, store, path):
        self.store, self.path = store, path

    @property
    def id(self):
        return self.path.split("/", 1)[1]

    def get(self, transaction=None):
        return FakeSnap(self.store.get(self.path), self.id)

    def set(self, data, merge=False):
        if merge and self.path in self.store:
            self.store[self.path] = _deep_merge(self.store[self.path], data)
        else:
            self.store[self.path] = dict(data)

    def update(self, fields):
        doc = self.store[self.path]
        for path, value in fields.items():
            *parents, leaf = path.split(".")
            node = doc
            for part in parents:
                node = node.setdefault(part, {})
            if value is DELETE:
                node.pop(leaf, None)
            else:
                node[leaf] = value

    def delete(self):
        self.store.pop(self.path, None)


def _deep_merge(a, b):
    out = dict(a)
    for k, v in b.items():
        out[k] = _deep_merge(out[k], v) if isinstance(v, dict) and isinstance(out.get(k), dict) else v
    return out


class Collection:
    def __init__(self, store, name, filters=()):
        self.store, self.name, self.filters = store, name, filters

    def document(self, doc_id):
        return Doc(self.store, f"{self.name}/{doc_id}")

    def where(self, field, op, value):
        return Collection(self.store, self.name, self.filters + ((field, value),))

    def limit(self, _n):
        return self

    def stream(self):
        prefix = f"{self.name}/"
        out = []
        for k, v in self.store.items():
            if not k.startswith(prefix) or "/" in k[len(prefix):]:
                continue
            if all(_get(v, f) == val for f, val in self.filters):
                out.append(FakeSnap(v, k[len(prefix):]))
        return out


def _get(doc, dotted):
    node = doc
    for part in dotted.split("."):
        if not isinstance(node, dict):
            return None
        node = node.get(part)
    return node


class Db:
    def __init__(self):
        self.store: dict[str, dict] = {}

    def collection(self, name):
        return Collection(self.store, name)


@pytest.fixture
def chat_db(monkeypatch):
    db = Db()
    target = _target()
    db.store[f"users/{target['zwiftId']}"] = {
        "zwiftId": target["zwiftId"], "name": target["name"],
        "connections": {"discord": {"userId": "d-1", "username": "rider"}},
    }
    rows = TRAINING + [target]
    monkeypatch.setattr(ps, "load_participants", lambda _db: rows)
    monkeypatch.setattr(ps, "get_model", lambda _db, *a, **k: (MODEL, rows, CATS))
    return db, target


# --- linking --------------------------------------------------------------------


def test_bot_token_is_required(monkeypatch):
    monkeypatch.setattr(authz, "BOT_SHARED_SECRET", "s3cret")
    authz.require_bot(SimpleNamespace(headers={"X-Bot-Token": "s3cret"}))
    with pytest.raises(AuthzError):
        authz.require_bot(SimpleNamespace(headers={"X-Bot-Token": "wrong"}))
    monkeypatch.setattr(authz, "BOT_SHARED_SECRET", None)
    with pytest.raises(AuthzError):
        authz.require_bot(SimpleNamespace(headers={"X-Bot-Token": ""}))


def test_identity_is_read_and_the_token_discarded(monkeypatch):
    monkeypatch.setattr(discord_link, "DISCORD_CLIENT_ID", "cid")
    http = MagicMock()
    http.post.return_value = MagicMock(status_code=200, json=lambda: {"access_token": "tok"})
    http.get.return_value = MagicMock(status_code=200, json=lambda: {"id": "42", "username": "rider",
                                                                       "global_name": "Rider One"})
    assert discord_link.fetch_identity("code", http=http) == {"userId": "42", "username": "Rider One"}
    assert "scope=identify" in discord_link.authorize_url("st")


@pytest.fixture
def client(chat_db, monkeypatch):
    from routes import bot_routes, discord_routes
    from routes.integration import integration_bp

    db, target = chat_db
    for mod in (bot_routes, discord_routes):
        monkeypatch.setattr(mod, "db", db)
    monkeypatch.setattr(authz, "BOT_SHARED_SECRET", "s3cret")
    monkeypatch.setattr(discord_routes, "verify_user_token", lambda _req: {"uid": target["zwiftId"]})
    monkeypatch.setattr(discord_routes, "_resolve_user_doc_ref_from_uid",
                        lambda uid: db.collection("users").document(uid))
    # Only the routes' own reference: other tests replace the shared firestore module.
    monkeypatch.setattr(discord_routes, "firestore", SimpleNamespace(DELETE_FIELD=DELETE, SERVER_TIMESTAMP="now"))
    monkeypatch.setattr(chat.assess_mod, "client_from_env", lambda: None)
    app = Flask(__name__)
    app.register_blueprint(integration_bp)
    return app.test_client(), db, target


def _confirm_params(res):
    from urllib.parse import parse_qs, urlparse
    q = parse_qs(urlparse(res.headers["Location"]).query)
    assert q["discord"] == ["confirm"]
    return {"state": q["state"][0], "token": q["token"][0]}


def test_linking_saves_the_discord_account_and_refuses_one_taken_by_another_rider(client, monkeypatch):
    http, db, target = client
    from routes import discord_routes

    monkeypatch.setattr(discord_link, "configured", lambda: True)
    url = http.post("/discord/login").get_json()["url"]
    assert "prompt=consent" in url
    state = url.split("state=")[1].split("&")[0]
    monkeypatch.setattr(discord_link, "fetch_identity", lambda _code: {"userId": "d-9", "username": "New"})
    db.store[f"users/{target['zwiftId']}"]["connections"] = {}
    res = http.get(f"/discord/callback?code=c&state={state}")
    params = _confirm_params(res)
    assert res.status_code == 302 and params["state"] == state
    assert "token" not in str(db.store[f"{discord_link.STATES_COLLECTION}/{state}"].get("confirmTokenHash"))
    assert "discord" not in db.store[f"users/{target['zwiftId']}"]["connections"]  # not linked yet
    res = http.post("/discord/confirm", json=params)
    assert res.get_json() == {"status": "connected", "username": "New"}
    assert db.store[f"users/{target['zwiftId']}"]["connections"]["discord"]["userId"] == "d-9"
    assert f"{discord_link.STATES_COLLECTION}/{state}" not in db.store  # state used once
    assert http.post("/discord/confirm", json=params).get_json()["status"] == "expired"

    db.store["users/other"] = {"connections": {"discord": {"userId": "d-7"}}}
    monkeypatch.setattr(discord_link, "fetch_identity", lambda _code: {"userId": "d-7", "username": "X"})
    discord_routes.db.collection(discord_link.STATES_COLLECTION).document("s2").set({"uid": target["zwiftId"]})
    res = http.post("/discord/confirm", json=_confirm_params(http.get("/discord/callback?code=c&state=s2")))
    assert res.status_code == 409 and res.get_json()["status"] == "taken"
    assert db.store[f"users/{target['zwiftId']}"]["connections"]["discord"]["userId"] == "d-9"

    assert http.post("/discord/unlink").status_code == 200
    assert "discord" not in db.store[f"users/{target['zwiftId']}"]["connections"]
    assert http.get("/discord/callback?code=c&state=bogus").status_code == 302


def test_a_link_started_by_someone_else_cannot_be_finished_in_my_browser(client, monkeypatch):
    """An attacker starts linking for their own rider and sends the Discord URL to a victim."""
    http, db, target = client
    from routes import discord_routes

    db.store["users/attacker"] = {"connections": {}}
    db.collection(discord_link.STATES_COLLECTION).document("evil").set({"uid": "attacker"})
    monkeypatch.setattr(discord_link, "fetch_identity", lambda _code: {"userId": "victim-d", "username": "V"})
    params = _confirm_params(http.get("/discord/callback?code=c&state=evil"))  # victim's browser
    # The victim's app confirms with the victim's own token (the fixture's rider): refused.
    res = http.post("/discord/confirm", json=params)
    assert res.status_code == 403 and res.get_json()["status"] == "mismatch"
    assert "discord" not in db.store["users/attacker"]["connections"]
    assert f"{discord_link.STATES_COLLECTION}/evil" not in db.store
    # Even the attacker cannot finish it afterwards.
    monkeypatch.setattr(discord_routes, "verify_user_token", lambda _req: {"uid": "attacker"})
    assert http.post("/discord/confirm", json=params).get_json()["status"] == "expired"
    assert "discord" not in db.store["users/attacker"]["connections"]


def test_the_starter_cannot_confirm_without_the_token_from_the_consenting_browser(client, monkeypatch):
    """The victim consents but is not logged into the app; the attacker knows only the state."""
    http, db, target = client
    from routes import discord_routes

    monkeypatch.setattr(discord_routes, "verify_user_token", lambda _req: {"uid": "attacker"})
    db.store["users/attacker"] = {"connections": {}}
    monkeypatch.setattr(discord_link, "fetch_identity", lambda _code: {"userId": "victim-d", "username": "V"})
    for attempt in ({"state": "evil"}, {"state": "evil", "token": "guess"}):
        db.collection(discord_link.STATES_COLLECTION).document("evil").set({"uid": "attacker"})
        _confirm_params(http.get("/discord/callback?code=c&state=evil"))  # the victim's browser
        res = http.post("/discord/confirm", json=attempt)
        assert res.status_code == 403 and res.get_json()["status"] == "mismatch"
        assert "discord" not in db.store["users/attacker"]["connections"]
        assert f"{discord_link.STATES_COLLECTION}/evil" not in db.store


# --- chat ---------------------------------------------------------------------


def _block(kind, **kw):
    return SimpleNamespace(type=kind, **kw)


class FakeClaude:
    """Scripted responses; records the tool results it was sent."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = []
        self.messages = self

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.script.pop(0)


def _reply(text):
    return SimpleNamespace(stop_reason="end_turn", content=[_block("text", text=text)],
                           usage=SimpleNamespace(input_tokens=10, output_tokens=5))


def _tool(name, args=None):
    return SimpleNamespace(stop_reason="tool_use",
                           content=[_block("tool_use", id=f"t-{name}", name=name, input=args or {})],
                           usage=SimpleNamespace(input_tokens=10, output_tokens=5))


def test_an_unlinked_user_without_a_model_answer_is_passed_to_the_admins(chat_db):
    db, _ = chat_db
    out = chat.ask(db, "unknown", "th1", [{"author": "rider", "text": "Hvornår er næste løb?"}],
                   client_factory=lambda: None)
    assert out == {"reply": chat.FALLBACK_REPLY, "sendNow": True, "proposalId": None}
    [item] = [v for k, v in db.store.items() if k.startswith(f"{lt.UNANSWERED}/")]
    assert item["question"] == "Hvornår er næste løb?" and item["zwiftId"] is None


def test_the_answer_waits_as_a_draft_and_only_sees_the_asking_rider(chat_db):
    db, target = chat_db
    claude = FakeClaude([_tool("explain_my_division"), _reply("Du er placeret ud fra din Strava-watt.")])
    out = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "Hvorfor er jeg i Gold?"}],
                   client_factory=lambda: claude)
    assert out["reply"] == chat.HOLDING and out["draftId"]
    draft = db.store[f"{chat.DRAFTS}/{out['draftId']}"]
    assert draft["status"] == "pending" and draft["draft"].startswith("Du er placeret")
    tool_result = claude.calls[1]["messages"][-1]["content"][0]["content"]
    assert target["name"] not in tool_result and target["zwiftId"] not in tool_result  # no names or ids
    assert '"divisionLimits"' in tool_result and "racingScore" not in tool_result
    assert db.store[f"{chat.CONVERSATIONS}/th1"]["messages"][-1]["draftId"] == out["draftId"]


def test_auto_reply_answers_directly(chat_db):
    db, _ = chat_db
    db.store["league/settings"] = {"divisionAgent": {"autoReply": True}}
    out = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "hi"}],
                   client_factory=lambda: FakeClaude([_reply("Hello!")]))
    assert out == {"reply": "Hello!", "sendNow": True, "proposalId": None}


def test_a_request_to_move_always_becomes_an_appeal(chat_db):
    db, target = chat_db
    claude = FakeClaude([
        _tool("file_appeal", {"statement": "My power meter reads high outdoors", "requestedCategory": "Bronze"}),
        _reply("(the appeal's own assessment call; unparseable, so templates are used)"),
        _reply("Jeg har sendt det til admins."),
    ])
    out = chat.ask(db, "d-1", "th7", [{"author": "rider", "text": "Kan jeg komme ned i Bronze?"}],
                   client_factory=lambda: claude)
    p = db.store[f"{proposals.COLLECTION}/{out['proposalId']}"]
    assert p["origin"] == "appeal" and p["requestedCategory"] == "Bronze" and p["proposedCategory"] == "Bronze"
    assert p["riderStatement"].startswith("My power meter") and p["discord"]["threadId"] == "th7"
    if p["suggestedCategory"] != "Bronze":
        assert "appeal_not_supported" in p["flags"]
    assert db.store[f"{chat.DRAFTS}/{out['draftId']}"]["proposalId"] == out["proposalId"]


def test_a_failed_claude_call_passes_the_question_to_the_admins(chat_db):
    db, _ = chat_db

    class Broken:
        messages = SimpleNamespace(create=MagicMock(side_effect=RuntimeError("down")))

    out = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "Hvornår er næste løb?"}],
                   client_factory=lambda: Broken())
    assert out == {"reply": chat.FALLBACK_REPLY, "sendNow": True, "proposalId": None}
    [item] = [v for k, v in db.store.items() if k.startswith(f"{lt.UNANSWERED}/")]
    assert item["question"] == "Hvornår er næste løb?" and item["status"] == "open" and item["threadId"] == "th1"


def test_riders_are_rate_limited_per_day(chat_db):
    db, _ = chat_db
    day1 = datetime(2026, 11, 5, 9, 0, tzinfo=timezone.utc)
    for _ in range(chat.MAX_MESSAGES_PER_DAY):
        chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "?"}], client_factory=lambda: None, now=lambda: day1)
    out = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "?"}], client_factory=lambda: None,
                   now=lambda: day1.replace(hour=22))  # 23:00 in Copenhagen: still the same day
    assert out["reply"] == chat.RATE_LIMITED
    next_day = day1.replace(hour=23, minute=30)  # 00:30 in Copenhagen
    out = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "?"}], client_factory=lambda: None,
                   now=lambda: next_day)
    assert out["reply"] != chat.RATE_LIMITED


def test_history_becomes_alternating_turns_starting_with_the_rider():
    msgs = [{"author": "bot", "text": "hello"}, {"author": "rider", "text": "a"},
            {"author": "rider", "text": "b"}, {"author": "bot", "text": "c"}, {"author": "rider", "text": "d"}]
    assert [m["role"] for m in chat._claude_messages(msgs)] == ["user", "assistant", "user"]
    assert chat._claude_messages(msgs)[0]["content"] == "a\n\nb"


# --- bot API --------------------------------------------------------------------


H = {"X-Bot-Token": "s3cret"}


def test_bot_api_needs_the_token(client):
    http, _, _ = client
    assert http.get("/bot/pending").status_code == 403
    assert http.get("/bot/pending", headers={"X-Bot-Token": "nope"}).status_code == 403


def test_items_are_posted_and_delivered_once(client):
    http, db, target = client
    # Without a model reply the question goes to the admins as an unanswered question.
    unanswered = http.post("/bot/ask", headers=H, json={
        "discordUserId": "d-1", "threadId": "th0", "messages": [{"author": "rider", "text": "?"}]}).get_json()
    assert unanswered["reply"] == chat.FALLBACK_REPLY
    [u_id] = [v["id"] for k, v in db.store.items() if k.startswith(f"{lt.UNANSWERED}/")]
    asked = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "Hvorfor Gold?"}],
                     client_factory=lambda: FakeClaude([_tool("explain_my_division"), _reply("Fordi...")]))
    proposal = runner.file_appeal(db, target["zwiftId"], "please", None, thread_id="th1",
                                  client_factory=lambda: None)

    items = http.get("/bot/pending", headers=H).get_json()["items"]
    assert {(i["kind"], i["id"]) for i in items} == {("draft", asked["draftId"]), ("proposal", proposal["id"]),
                                                     ("unanswered", u_id)}
    for i in items:
        assert http.post("/bot/ack", headers=H, json={"kind": i["kind"], "id": i["id"], "messageId": "m1"}).status_code == 200
    assert http.get("/bot/pending", headers=H).get_json()["items"] == []
    assert db.store[f"{proposals.COLLECTION}/{proposal['id']}"]["discord"] == {"threadId": "th1",
                                                                                "adminMessageId": "m1"}

    res = http.post(f"/bot/replies/{asked['draftId']}/decision", headers=H,
                    json={"action": "edit", "text": "Final answer", "discordUser": "admin"})
    assert res.get_json()["draft"]["status"] == "edited"
    res = http.post(f"/bot/proposals/{proposal['id']}/decision", headers=H,
                    json={"action": "reject", "note": "no", "discordUser": "admin"})
    assert res.status_code == 200 and res.get_json()["proposal"]["decidedBy"] == "discord:admin"

    kinds = {i["kind"]: i for i in http.get("/bot/pending", headers=H).get_json()["items"]}
    assert set(kinds) == {"reply", "draft_decided", "outcome", "proposal_decided"}
    assert kinds["reply"]["text"] == "Final answer" and kinds["outcome"]["threadId"] == "th1"
    for i in kinds.values():
        http.post("/bot/ack", headers=H, json={"kind": i["kind"], "id": i["id"]})
    assert http.get("/bot/pending", headers=H).get_json()["items"] == []
    assert http.post(f"/bot/replies/{asked['draftId']}/decision", headers=H,
                     json={"action": "send"}).status_code == 400  # already handled

    # Solved from Discord: the post was updated by the bot itself, so nothing is left to sync.
    res = http.post(f"/bot/unanswered/{u_id}/resolve", headers=H, json={"discordUser": "admin"})
    assert res.status_code == 200 and res.get_json()["unanswered"]["status"] == "resolved"
    assert http.get("/bot/pending", headers=H).get_json()["items"] == []
    assert http.post("/bot/unanswered/missing/resolve", headers=H, json={}).status_code == 404


def test_ack_rejects_unknown_kinds(client):
    http, _, _ = client
    assert http.post("/bot/ack", headers=H, json={"kind": "x", "id": "1"}).status_code == 400
    assert http.post("/bot/ack", headers=H, json={"kind": "draft", "id": "missing", "messageId": "m"}).status_code == 404


def test_the_agent_never_closes_an_appeal(chat_db, monkeypatch):
    db, target = chat_db
    appeal = runner.file_appeal(db, target["zwiftId"], "please move me", "Bronze", thread_id="th1",
                                client_factory=lambda: None)
    # An agent re-check that finds no change needed (or a trusted vELO) supersedes agent cards only.
    assert proposals.supersede_pending(db, target["zwiftId"]) == 0
    agent = proposals.create(db, {"zwiftId": target["zwiftId"], "origin": "agent", "proposedCategory": "Gold"})
    assert db.store[f"{proposals.COLLECTION}/{appeal['id']}"]["status"] == "pending"
    # ... and a newer appeal replaces the older appeal, not the agent card.
    newer = runner.file_appeal(db, target["zwiftId"], "again", None, client_factory=lambda: None)
    assert db.store[f"{proposals.COLLECTION}/{appeal['id']}"]["status"] == "superseded"
    assert db.store[f"{proposals.COLLECTION}/{agent['id']}"]["status"] == "pending"
    assert db.store[f"{proposals.COLLECTION}/{newer['id']}"]["status"] == "pending"
    # A pending appeal alone does not make the nightly scan re-review the rider.
    monkeypatch.setattr(runner.triage, "needs_review", lambda row, settings: [])
    db.store[f"{proposals.COLLECTION}/{agent['id']}"]["status"] = "rejected"
    assert runner.scan(db) == 0


def test_a_failed_or_expired_link_returns_to_the_app(client, monkeypatch):
    http, db, target = client
    assert http.get("/discord/callback?code=c&state=unknown").headers["Location"].endswith("discord=expired")
    assert http.get("/discord/callback").headers["Location"].endswith("discord=error")

    def fail(_code):
        raise discord_link.DiscordLinkError("nope", 502)

    monkeypatch.setattr(discord_link, "fetch_identity", fail)
    db.collection(discord_link.STATES_COLLECTION).document("s3").set({"uid": target["zwiftId"]})
    res = http.get("/discord/callback?code=c&state=s3")
    assert res.headers["Location"].endswith("discord=error")
    assert f"{discord_link.STATES_COLLECTION}/s3" not in db.store
