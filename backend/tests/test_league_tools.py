"""League knowledge tools for the Discord help bot, routing of answers, and unanswered questions."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.division_agent import chat  # noqa: E402
from services.division_agent import league_tools as lt  # noqa: E402
from tests.test_admin_predictor_routes import FakeSnap  # noqa: E402
from tests.test_discord_chat import Collection, Db, FakeClaude, _reply, _tool, chat_db  # noqa: E402,F401

NOW = datetime(2026, 11, 5, 12, 0, tzinfo=timezone.utc)


class GroupDb(Db):
    """The chat test db plus `collection_group` over subcollections."""

    def collection(self, name):
        return Collection(self.store, name)

    def collection_group(self, name):
        store = self.store

        class Group:
            def __init__(self, filters=()):
                self.filters = filters

            def where(self, field, op, value):
                return Group(self.filters + ((field, value),))

            def stream(self):
                out = []
                for k, v in store.items():
                    parts = k.split("/")
                    if len(parts) >= 4 and parts[-2] == name and all(v.get(f) == val for f, val in self.filters):
                        out.append(FakeSnap(v, parts[-1]))
                return out

        return Group()


@pytest.fixture
def db():
    d = GroupDb()
    d.store.update({
        "races/r1": {"name": "Classic 1", "date": "2026-11-12T19:30:00", "map": "Watopia", "routeName": "Volcano",
                     "laps": 3, "totalDistance": 30.1, "eventId": "123", "eventSecret": "s3cr3t",
                     "eventConfiguration": [{"customCategory": "Gold", "startTime": "19:30", "eventId": "9"}]},
        "races/r0": {"name": "Tour stage", "date": "2026-10-01T19:30:00", "stageRaceId": "t1", "stageIndex": 1,
                     "results": {"Gold": [{"zwiftId": "2", "name": "B", "totalPoints": 10},
                                          {"zwiftId": "1", "name": "A", "totalPoints": 25, "club": "CK"}]}},
        "races/r2": {"name": "Classic 2", "date": "2026-11-26T19:30:00"},
        "stageRaces/t1": {"name": "Tour de Test"},
        "league/standings": {"standings": {
            "Gold": [{"zwiftId": "2", "name": "B", "totalPoints": 30, "raceCount": 2},
                     {"zwiftId": "1", "name": "A", "totalPoints": 45, "raceCount": 2}],
            "Silver": [{"zwiftId": "3", "name": "C", "totalPoints": 12, "raceCount": 1}]}},
        "posts/p1": {"status": "published", "title": "Ny sæson", "slug": "ny-saeson",
                     "publishedAt": "2026-10-01T10:00:00+00:00",
                     "body": {"type": "doc", "content": [
                         {"type": "paragraph", "content": [{"type": "text", "text": "Sæsonen starter"},
                                                           {"type": "hardBreak"},
                                                           {"type": "text", "text": "i november."}]},
                         {"type": "heading", "content": [{"type": "text", "text": "Point"}]}]}},
        "posts/p2": {"status": "draft", "title": "Hemmelig", "slug": "x", "body": {}},
        "races/r1/signups/1": {"zwiftId": "1", "raceId": "r1", "status": "registered", "ligaCategory": "Gold"},
        "races/r0/signups/1": {"zwiftId": "1", "raceId": "r0", "status": "registered"},
        "races/r1/signups/9": {"zwiftId": "9", "raceId": "r1", "status": "registered"},
    })
    return d


def test_tiptap_body_becomes_plain_text():
    body = {"type": "doc", "content": [
        {"type": "paragraph", "content": [{"type": "text", "text": "Hej"}, {"type": "hardBreak"},
                                          {"type": "text", "text": "verden"}]},
        {"type": "bulletList", "content": [{"type": "listItem", "content": [
            {"type": "paragraph", "content": [{"type": "text", "text": "punkt"}]}]}]}]}
    assert lt.post_plain_text(body) == "Hej verden punkt"
    assert lt.post_plain_text(None) == ""


def test_the_guide_is_the_sites_llms_txt_cached_and_kept_on_failure(monkeypatch):
    monkeypatch.setattr(lt, "_guide_cache", {"text": None, "at": 0.0})
    calls = []

    class Http:
        def __init__(self, status, text):
            self.status, self.text = status, text

        def get(self, url, timeout):
            calls.append(url)
            return SimpleNamespace(status_code=self.status, text=self.text)

    t = [0.0]
    clock = lambda: t[0]  # noqa: E731
    out = lt.league_guide(http=Http(200, "# DCU E-serien\n## Point"), clock=clock)
    assert out["guide"].startswith("# DCU E-serien") and calls[0].endswith("/llms.txt")
    lt.league_guide(http=Http(200, "new"), clock=clock)
    assert len(calls) == 1  # cached
    t[0] = lt.GUIDE_TTL_SECONDS + 1
    out = lt.league_guide(http=Http(503, ""), clock=clock)
    assert out["stale"] is True and out["guide"].startswith("# DCU")  # last good copy
    monkeypatch.setattr(lt, "_guide_cache", {"text": None, "at": 0.0})
    assert "error" in lt.league_guide(http=Http(500, ""), clock=clock)


def test_schedule_lists_upcoming_races_in_copenhagen_time_without_secrets(db):
    out = lt.race_schedule(db, now=NOW)
    assert [r["name"] for r in out["races"]] == ["Classic 1", "Classic 2"]
    first = out["races"][0]
    assert first["start"] == "2026-11-12 19:30" and first["startTimesByCategory"][0]["category"] == "Gold"
    dumped = json.dumps(out)
    assert "s3cr3t" not in dumped and "eventSecret" not in dumped and "eventId" not in dumped
    past = lt.race_schedule(db, past=True, now=NOW)["races"]
    assert past[0]["name"] == "Tour stage" and past[0]["stageRace"] == "Tour de Test" and past[0]["stage"] == 1


def test_standings_and_results_are_ranked_top_rows(db):
    out = lt.standings(db)["standings"]
    assert [e["name"] for e in out["Gold"]] == ["A", "B"] and out["Gold"][0]["rank"] == 1
    assert list(lt.standings(db, division="silver")["standings"]) == ["Silver"]
    assert "error" in lt.standings(db, division="Bronze")
    res = lt.race_results(db, now=NOW)
    assert res["race"] == "Tour stage" and res["results"]["Gold"][0] == {
        "rank": 1, "name": "A", "club": "CK", "points": 25, "status": None}
    assert "zwiftId" not in json.dumps(res)


def test_news_reads_only_published_posts(db):
    out = lt.read_news(db)
    assert [p["title"] for p in out["posts"]] == ["Ny sæson"]
    assert out["posts"][0]["text"] == "Sæsonen starter i november. Point"
    assert out["posts"][0]["link"].endswith("/nyheder/ny-saeson")
    assert "error" in lt.read_news(db, query="hemmelig")


def test_my_status_is_only_about_the_asking_rider(db):
    user = {"registration": {"status": "complete"}, "connections": {"zwift": {"connected": True}},
            "equipment": {"trainer": "Kickr"}, "dualRecordingMethod": "direct", "dualRecordingOptIn": True,
            "verification": {"status": "pending", "currentRequest": {"type": "weight", "status": "pending",
                                                                     "deadline": "2026-11-20"}}}
    out = lt.my_status(db, "1", user, now=NOW)
    assert out["registered"] is True and out["connections"] == {"zwift": True, "strava": False, "discord": False}
    assert [s["race"] for s in out["upcomingSignups"]] == ["Classic 1"]  # past race and other riders left out
    assert out["standing"] == {"division": "Gold", "rank": 1, "of": 2, "points": 45, "races": 2}
    assert out["verification"]["openRequest"]["deadline"] == "2026-11-20"
    assert out["dualRecording"]["method"] == "direct"
    assert "Optag dual" in out["dualRecording"]["where"]
    assert out["trainer"] == "Kickr"


def test_unanswered_questions_are_logged_once_and_resolved(db):
    kw = dict(thread_id="th1", discord_user_id="d1", zwift_id=None, now=NOW)
    assert lt.report_unanswered(db, question="Må jeg køre MTB?", missing="bike rules", **kw)["status"] == \
        "passed to the admins"
    assert lt.report_unanswered(db, question="Må jeg køre MTB?", missing="x", **kw)["status"] == \
        "already passed to the admins"
    [item] = lt.list_unanswered(db)
    assert item["missing"] == "bike rules" and item["status"] == "open"
    done = lt.resolve_unanswered(db, item["id"], resolved_by="admin", note="added to /info")
    assert done["status"] == "resolved" and lt.list_unanswered(db) == []
    assert lt.list_unanswered(db, status="resolved")[0]["note"] == "added to /info"
    with pytest.raises(LookupError):
        lt.resolve_unanswered(db, "missing", resolved_by="admin")


# --- routing in the chat ---------------------------------------------------------------


def _offered(claude):
    return {t["name"] for t in claude.calls[0]["tools"]}


def test_league_answers_go_out_directly_even_without_auto_reply(chat_db, monkeypatch):  # noqa: F811 (pytest fixture)
    db, _ = chat_db
    monkeypatch.setattr(lt, "league_guide", lambda: {"guide": "## Point\nMål: 1. 20 point"})
    claude = FakeClaude([_tool("league_guide"), _reply("Vinderen får 20 point. Se /point")])
    out = chat.ask(db, "d-1", "th1", [{"author": "rider", "text": "Hvor mange point får vinderen?"}],
                   client_factory=lambda: claude)
    assert out == {"reply": "Vinderen får 20 point. Se /point", "sendNow": True, "proposalId": None}
    assert "Mål: 1. 20 point" in claude.calls[1]["messages"][-1]["content"][0]["content"]
    assert {"league_guide", "my_status", "explain_my_division", "file_appeal"} <= _offered(claude)
    assert not [k for k in db.store if k.startswith(f"{chat.DRAFTS}/")]


def test_unlinked_users_get_public_answers_but_no_personal_tools(chat_db):  # noqa: F811 (pytest fixture)
    db, _ = chat_db
    claude = FakeClaude([_reply("Næste løb er torsdag.")])
    out = chat.ask(db, "stranger", "th2", [{"author": "rider", "text": "Hvornår er næste løb?"}],
                   client_factory=lambda: claude)
    assert out["reply"] == "Næste løb er torsdag." and out["sendNow"] is True
    offered = _offered(claude)
    assert "league_guide" in offered and "report_unanswered" in offered
    assert not offered & {"my_status", "explain_my_division", "file_appeal"}
    assert "NOT linked Discord" in claude.calls[0]["system"]


def test_the_bot_reports_what_it_cannot_answer(chat_db):  # noqa: F811 (pytest fixture)
    db, _ = chat_db
    claude = FakeClaude([_tool("report_unanswered", {"question": "Må jeg køre på MTB?", "missing": "bike rules"}),
                         _reply("Det ved jeg ikke – jeg har sendt spørgsmålet til en admin.")])
    out = chat.ask(db, "stranger", "th3", [{"author": "rider", "text": "Må jeg køre på MTB?"}],
                   client_factory=lambda: claude)
    assert out["sendNow"] is True and "admin" in out["reply"]
    [item] = [v for k, v in db.store.items() if k.startswith(f"{lt.UNANSWERED}/")]
    assert item["question"] == "Må jeg køre på MTB?" and item["zwiftId"] is None and item["threadId"] == "th3"


def test_admin_routes_list_and_resolve_unanswered(chat_db, monkeypatch):  # noqa: F811 (pytest fixture)
    db, _ = chat_db
    from routes import admin_division_agent_routes as routes
    from routes.admin import admin_bp

    monkeypatch.setattr(routes, "db", db)
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"email": "boss@example.com"})
    lt.report_unanswered(db, question="Q?", missing="m", thread_id="t", discord_user_id="d", zwift_id=None)
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    http = app.test_client()
    [item] = http.get("/admin/division-agent/unanswered").get_json()["items"]
    res = http.post(f"/admin/division-agent/unanswered/{item['id']}/resolve", json={"note": "fixed"})
    assert res.get_json()["item"]["resolvedBy"] == "boss@example.com"
    assert http.get("/admin/division-agent/unanswered").get_json()["items"] == []
    assert http.get("/admin/division-agent/unanswered?status=resolved").get_json()["items"][0]["note"] == "fixed"
