"""Division agent: triage, evidence, decisions, Claude assessment, proposals and the queue."""
from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import predictor_service as ps  # noqa: E402
from services import velo_predictor as vp  # noqa: E402
from services.division_agent import assess, decide, evidence, proposals, queue, runner, triage  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402
from tests.test_predictor_tuning import _rider  # noqa: E402

SETTINGS = {"minZwiftRides": 15, "enabled": True, "assessModel": "claude-haiku-5-5", "maxPerRun": 8}
TRAINING = [_rider(i) for i in range(60)]
MODEL = vp.build_model(TRAINING, vp.PredictorConfig())
CATS = None  # default ZR divisions


def _target(i=500, **extra):
    """A rider with few Zwift rides and an unreliable vELO."""
    row = {**_rider(i, rides=3), "hasStrava": True, "name": f"Rider {i}", **extra}
    return row


def _curve(row, factor=0.95, count=30):
    return {
        "curve": {"w5": row["cp5s"] * factor, "w60": row["cp1min"] * factor,
                  "w300": row["cp5min"] * factor, "w1200": row["cp20min"] * factor},
        "activityCount": count, "days": 90, "computedAt": datetime.now(timezone.utc).isoformat(),
    }


# --- triage ---------------------------------------------------------------------------


def test_triage_reviews_unreliable_riders_only():
    assert triage.needs_review(_rider(1), SETTINGS) == []  # 30 rides, stable rating
    assert triage.needs_review(_rider(1, rides=3), SETTINGS) == [triage.FEW_RIDES]
    no_velo = {**_rider(1, rides=0), "rating": "N/A", "max30Rating": "N/A"}
    assert triage.needs_review(no_velo, SETTINGS) == [triage.NO_VELO, triage.FEW_RIDES]


# --- evidence and decide ----------------------------------------------------------------


def test_evidence_never_uses_zrs_and_flags_problems():
    row = _target(racingScore=9999)
    ev = evidence.gather(row, {}, model=MODEL, categories=CATS, curve_entry=_curve(row, count=1),
                         reasons=[triage.FEW_RIDES])
    assert ev["zwift"]["inputs"]["racingScore"] == 0.0 and ev["strava"]["inputs"]["racingScore"] == 0.0
    assert evidence.FEW_STRAVA_RIDES in ev["flags"]
    assert "name" not in json.dumps(ev) and "userDocId" not in json.dumps(ev)


def test_decide_prefers_strava_then_zwift_then_velo():
    row = _target()
    ev = evidence.gather(row, {}, model=MODEL, categories=CATS, curve_entry=_curve(row), reasons=["few_rides"])
    assert decide.suggest(ev, CATS)["source"] == "strava"
    ev_low = evidence.gather(row, {}, model=MODEL, categories=CATS, curve_entry=_curve(row, count=1),
                             reasons=["few_rides"])
    assert decide.suggest(ev_low, CATS)["source"] == "zwift"  # low-confidence Strava loses
    empty = {**row, "cp5s": None, "cp1min": None, "cp5min": None, "cp20min": None}
    ev_velo = evidence.gather(empty, {}, model=MODEL, categories=CATS, curve_entry=None, reasons=["few_rides"])
    assert decide.suggest(ev_velo, CATS)["source"] == "velo"
    nothing = {**empty, "rating": "N/A", "max30Rating": "N/A"}
    ev_none = evidence.gather(nothing, {}, model=MODEL, categories=CATS, curve_entry=None, reasons=["no_velo"])
    s = decide.suggest(ev_none, CATS)
    assert s["category"] is None and decide.needs_proposal(ev_none, s)  # no division yet: look by hand


def test_no_proposal_when_the_division_would_not_change():
    row = _target()
    ev = evidence.gather(row, {}, model=MODEL, categories=CATS, curve_entry=_curve(row), reasons=["few_rides"])
    s = decide.suggest(ev, CATS)
    assert not decide.needs_proposal({**ev, "currentCategory": s["category"]}, s)
    assert decide.needs_proposal({**ev, "currentCategory": None}, s)


def test_strava_fetch_waits_when_the_budget_is_used(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(evidence, "strava_budget", lambda _db, _now: (lambda *a, **k: False))
    with pytest.raises(evidence.WaitingForStrava):
        evidence.strava_curve(db, _target(), 90, strava_service=MagicMock(), compute_curve=MagicMock())
    no_strava = _target(hasStrava=False)
    assert evidence.strava_curve(db, no_strava, 90, strava_service=MagicMock(), compute_curve=MagicMock()) is None


# --- Claude assessment --------------------------------------------------------------------


class FakeClient:
    def __init__(self, payload, stop_reason="end_turn"):
        self.calls = []
        text = json.dumps(payload)
        response = SimpleNamespace(stop_reason=stop_reason, content=[SimpleNamespace(type="text", text=text)],
                                   usage=SimpleNamespace(input_tokens=900, output_tokens=120))
        self.messages = SimpleNamespace(create=lambda **kw: (self.calls.append(kw), response)[1])


def _ev_and_suggestion():
    row = _target()
    ev = evidence.gather(row, {}, model=MODEL, categories=CATS, curve_entry=_curve(row), reasons=["few_rides"])
    return ev, decide.suggest(ev, CATS)


def test_assessment_uses_claude_with_structured_output():
    ev, s = _ev_and_suggestion()
    client = FakeClient({"proposedCategory": s["category"], "confidence": "high",
                         "adminRationale": "Strava says so.", "riderExplanation": "Vi foreslår ..."})
    out = assess.assess(ev, s, model="claude-haiku-5-5", client_factory=lambda: client)
    assert out["author"] == "claude" and out["proposedCategory"] == s["category"]
    assert out["usage"] == {"inputTokens": 900, "outputTokens": 120}
    call = client.calls[0]
    assert call["model"] == "claude-haiku-5-5" and call["output_config"]["format"]["type"] == "json_schema"
    assert "Rider 500" not in json.dumps(call["messages"])  # no names sent


def test_assessment_falls_back_to_templates():
    ev, s = _ev_and_suggestion()
    out = assess.assess(ev, s, model="claude-haiku-5-5", client_factory=lambda: None)  # no API key
    assert out["author"] == "template" and out["proposedCategory"] == s["category"]
    assert "admin" in out["riderExplanation"]
    refused = FakeClient({}, stop_reason="refusal")
    assert assess.assess(ev, s, model="m", client_factory=lambda: refused)["author"] == "template"
    unknown = FakeClient({"proposedCategory": "Platinum+", "confidence": "high",
                          "adminRationale": "x", "riderExplanation": "y"})
    assert assess.assess(ev, s, model="m", client_factory=lambda: unknown)["author"] == "template"


# --- queue -------------------------------------------------------------------------------


def test_queue_is_idempotent_and_claimed_once():
    db = FakeDb()
    queue.enqueue(db, "7", "registered")
    queue.enqueue(db, "7", "strava_connected")
    assert queue.entries(db)[0]["reasons"] == ["registered", "strava_connected"]
    assert queue.claim(db, "7") is not None
    assert queue.claim(db, "7") is None  # already being processed
    queue.retry_later(db, "7", 15)
    assert queue.ready(db) == []  # waits for notBefore
    later = datetime.now(timezone.utc) + timedelta(minutes=16)
    assert [e["zwiftId"] for e in queue.ready(db, later)] == ["7"]


# --- processing and proposals --------------------------------------------------------------


@pytest.fixture
def agent_db(monkeypatch):
    db = FakeDb()
    target = _target()
    db.store[f"users/{target['zwiftId']}"] = {"ligaCategory": {}}
    rows = TRAINING + [target]
    monkeypatch.setattr(ps, "load_participants", lambda _db: rows)
    monkeypatch.setattr(ps, "get_model", lambda _db, *a, **k: (MODEL, rows, CATS))
    fixed = _curve(target)
    monkeypatch.setattr(evidence, "strava_curve", lambda _db, row, days, **k: fixed)
    return db, target


def test_scan_queues_unreliable_riders_and_batch_creates_a_proposal(agent_db):
    db, target = agent_db
    assert runner.scan(db) == 1  # only the target; reliable riders are skipped
    counts = runner.process_batch(db, strava_service=MagicMock(), compute_curve=MagicMock(),
                                  client_factory=lambda: None)
    assert counts["proposed"] == 1 and queue.entries(db) == []
    [p] = proposals.list_proposals(db)
    assert p["zwiftId"] == target["zwiftId"] and p["source"] == "strava" and p["currentCategory"] is None
    assert runner.scan(db) == 1  # pending proposal: re-checked (cheap when nothing changed)
    runner.process_batch(db, strava_service=MagicMock(), compute_curve=MagicMock(),
                         client_factory=lambda: None)
    assert [x["id"] for x in proposals.list_proposals(db)] == [p["id"]]  # same evidence: kept


def test_rejected_proposal_is_not_repeated_until_the_evidence_changes(agent_db, monkeypatch):
    db, target = agent_db
    settings = SETTINGS
    bundle = (MODEL, TRAINING + [target], CATS)
    first = runner.process_rider(db, target, settings=settings, model_bundle=bundle,
                                 strava_service=None, compute_curve=None, client_factory=lambda: None)
    proposals.decide(db, first["proposal"]["id"], "reject", decided_by="admin", note="Known injury")
    again = runner.process_rider(db, target, settings=settings, model_bundle=bundle,
                                 strava_service=None, compute_curve=None, client_factory=lambda: None)
    assert again["outcome"] == "handled"
    newer = {**_curve(target), "computedAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
    monkeypatch.setattr(evidence, "strava_curve", lambda _db, row, days, **k: newer)
    assert runner.process_rider(db, target, settings=settings, model_bundle=bundle, strava_service=None,
                                compute_curve=None, client_factory=lambda: None)["outcome"] == "proposed"


def test_new_proposal_supersedes_the_old_pending_one():
    db = FakeDb()
    a = proposals.create(db, {"zwiftId": "7", "proposedCategory": "Gold"})
    b = proposals.create(db, {"zwiftId": "7", "proposedCategory": "Silver"})
    assert db.store[f"{proposals.COLLECTION}/{a['id']}"]["status"] == "superseded"
    assert [p["id"] for p in proposals.list_proposals(db)] == [b["id"]]


def _pending(db, **extra):
    return proposals.create(db, {"zwiftId": "7", "currentCategory": None, "proposedCategory": "Gold",
                                 "predictedVelo": 1080, **extra})


def test_approve_unlocked_rider_uses_predict_assign(monkeypatch):
    db = FakeDb()
    db.store["users/7"] = {"ligaCategory": {}}
    calls = []
    monkeypatch.setattr(proposals.liga_assignment, "predict_assign",
                        lambda _db, uid, data, velo: calls.append(("predict", uid, velo)))
    monkeypatch.setattr(proposals.liga_assignment, "manual_assign",
                        lambda _db, uid, data, cat: calls.append(("manual", uid, cat)))
    p = _pending(db)
    done = proposals.decide(db, p["id"], "approve", decided_by="admin@x")
    assert calls == [("predict", "7", 1080.0)] and done["status"] == "approved"
    assert done["appliedCategory"] == "Gold"

    p2 = _pending(db)
    edited = proposals.decide(db, p2["id"], "edit", category="Silver", decided_by="admin@x", note="Injured")
    assert calls[-1] == ("manual", "7", "Silver") and edited["status"] == "edited"
    assert edited["decisionNote"] == "Injured"


def test_approve_locked_rider_runs_the_transfer(monkeypatch):
    from services import category_transfer

    db = FakeDb()
    db.store["users/7"] = {"ligaCategory": {"locked": True, "category": "Silver"}}
    moves = []
    monkeypatch.setattr(category_transfer, "apply_move",
                        lambda _db, **kw: moves.append(kw) or {"transferId": "t1"})
    p = _pending(db, currentCategory="Silver", locked=True)
    done = proposals.decide(db, p["id"], "approve", decided_by="admin")
    assert moves[0]["to_category"] == "Gold" and done["transferId"] == "t1"


def test_stale_proposal_is_superseded_instead_of_applied(monkeypatch):
    db = FakeDb()
    db.store["users/7"] = {"ligaCategory": {"manualAssigned": {"category": "Bronze"}}}
    p = _pending(db)  # made when the rider had no division
    with pytest.raises(proposals.ProposalError) as err:
        proposals.decide(db, p["id"], "approve", decided_by="admin")
    assert err.value.status_code == 409
    assert db.store[f"{proposals.COLLECTION}/{p['id']}"]["status"] == "superseded"


def test_decided_proposals_cannot_be_decided_again():
    db = FakeDb()
    p = _pending(db)
    proposals.decide(db, p["id"], "reject", decided_by="admin")
    with pytest.raises(proposals.ProposalError):
        proposals.decide(db, p["id"], "approve", decided_by="admin")


# --- shared assignment service (also used by the admin buttons) -------------------------------


class UpdatableDb(FakeDb):
    def collection(self, name):
        coll = super().collection(name)
        original = coll.document

        def document(doc_id):
            doc = original(doc_id)
            doc.update = lambda data: doc.store.__setitem__(doc.path, {**doc.store.get(doc.path, {}), **data})
            return doc

        coll.document = document
        return coll


def test_predict_assign_writes_a_predicted_hold():
    from services import liga_assignment

    db = UpdatableDb()
    liga_assignment.predict_assign(db, "7", {"ligaCategory": {}}, 1080)
    manual = db.store["users/7"]["ligaCategory.manualAssigned"]
    assert manual["assignedFrom"] == "predicted" and manual["category"] == "Gold"
    assert manual["predictedVelo"] == 1080.0
    with pytest.raises(liga_assignment.AssignmentError):
        liga_assignment.predict_assign(db, "7", {"ligaCategory": {"locked": True}}, 1080)


def test_manual_assign_writes_an_admin_hold():
    from services import liga_assignment

    db = UpdatableDb()
    liga_assignment.manual_assign(db, "7", {"ligaCategory": {}}, "Silver")
    assert db.store["users/7"]["ligaCategory.manualAssigned"]["category"] == "Silver"
    with pytest.raises(liga_assignment.AssignmentError):
        liga_assignment.manual_assign(db, "7", {}, "Nonsense")


# --- routes and triggers --------------------------------------------------------------------


@pytest.fixture
def client(agent_db, monkeypatch):
    from flask import Flask

    from routes import admin_division_agent_routes as routes
    from routes.admin import admin_bp

    db, target = agent_db
    monkeypatch.setattr(routes, "db", db)
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True, "email": "admin@example.com"})
    monkeypatch.setattr(routes.runner.assess_mod, "client_from_env", lambda: None)
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    return app.test_client(), db, target


def test_routes_scan_review_and_decide(client, monkeypatch):
    http, db, target = client
    assert http.post("/admin/division-agent/scan").get_json() == {"queued": 1}
    assert http.get("/admin/division-agent/status").get_json()["queued"] == 1

    dry = http.post(f"/admin/division-agent/assess/{target['zwiftId']}?dryRun=1").get_json()
    assert dry["outcome"] == "proposed" and http.get("/admin/division-agent/proposals").get_json() == {
        "proposals": []}  # dry run saves nothing

    http.post(f"/admin/division-agent/assess/{target['zwiftId']}")
    [p] = http.get("/admin/division-agent/proposals").get_json()["proposals"]
    res = http.post(f"/admin/division-agent/proposals/{p['id']}/decision",
                    json={"action": "reject", "note": "Known injury"})
    assert res.status_code == 200 and res.get_json()["proposal"]["decidedBy"] == "admin@example.com"
    [h] = http.get("/admin/division-agent/proposals?status=history").get_json()["proposals"]
    assert h["status"] == "rejected" and h["decisionNote"] == "Known injury"
    assert http.post(f"/admin/division-agent/proposals/{p['id']}/decision",
                     json={"action": "approve"}).status_code == 400


def test_routes_need_admin(client, monkeypatch):
    from authz import AuthzError
    from routes import admin_division_agent_routes as routes

    def deny(_req):
        raise AuthzError("Forbidden", 403)

    http, _db, _t = client
    monkeypatch.setattr(routes, "require_admin", deny)
    assert http.get("/admin/division-agent/proposals").status_code == 403
    assert http.post("/admin/division-agent/scan").status_code == 403


def test_enqueue_never_breaks_the_caller():
    broken = MagicMock()
    broken.collection.side_effect = RuntimeError("firestore down")
    queue.safe_enqueue(broken, "7", "registered")  # logs, does not raise


def _process(db, target, bundle=None):
    return runner.process_rider(db, target, settings=SETTINGS,
                                model_bundle=bundle or (MODEL, TRAINING + [target], CATS),
                                strava_service=None, compute_curve=None, client_factory=lambda: None)


def test_batch_reads_fresh_riders_not_the_cached_list(agent_db, monkeypatch):
    db, target = agent_db
    monkeypatch.setattr(ps, "get_model", lambda _db, *a, **k: (MODEL, TRAINING, CATS))  # stale cache
    queue.enqueue(db, target["zwiftId"], "registration")
    counts = runner.process_batch(db, strava_service=MagicMock(), compute_curve=MagicMock(),
                                  client_factory=lambda: None)
    assert counts["proposed"] == 1 and len(proposals.list_proposals(db)) == 1


def test_new_evidence_replaces_a_pending_proposal(agent_db, monkeypatch):
    db, target = agent_db
    first = _process(db, target)["proposal"]
    newer = {**_curve(target), "computedAt": (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()}
    monkeypatch.setattr(evidence, "strava_curve", lambda _db, row, days, **k: newer)
    second = _process(db, target)
    assert second["outcome"] == "proposed"
    assert db.store[f"{proposals.COLLECTION}/{first['id']}"]["status"] == "superseded"
    assert [p["id"] for p in proposals.list_proposals(db)] == [second["proposal"]["id"]]


def test_a_pending_proposal_no_longer_needed_is_superseded(agent_db, monkeypatch):
    db, target = agent_db
    first = _process(db, target)["proposal"]
    db.store[f"users/{target['zwiftId']}"] = {"ligaCategory": {"manualAssigned": {
        "category": first["proposedCategory"]}}}
    monkeypatch.setattr(evidence, "fingerprint", lambda ev: "changed")
    monkeypatch.setattr(runner.evidence, "gather", _with_current(runner.evidence.gather, first["proposedCategory"]))
    assert _process(db, target)["outcome"] == "no_change"
    assert db.store[f"{proposals.COLLECTION}/{first['id']}"]["status"] == "superseded"


def _with_current(gather, category):
    def wrapped(*a, **k):
        ev = gather(*a, **k)
        ev["currentCategory"] = category
        return ev
    return wrapped


def test_a_rider_who_became_reliable_has_the_pending_card_superseded(agent_db, monkeypatch):
    db, target = agent_db
    first = _process(db, target)["proposal"]
    monkeypatch.setattr(triage, "needs_review", lambda row, settings: [])
    assert _process(db, target)["outcome"] == "not_needed"
    assert db.store[f"{proposals.COLLECTION}/{first['id']}"]["status"] == "superseded"


def test_an_admin_edit_is_not_re_proposed(agent_db, monkeypatch):
    db, target = agent_db
    first = _process(db, target)["proposal"]
    other = next(d for d in first["evidence"]["divisions"] if d != first["proposedCategory"])
    db.store[f"{proposals.COLLECTION}/{first['id']}"].update({"status": "edited", "appliedCategory": other})
    monkeypatch.setattr(runner.evidence, "gather", _with_current(runner.evidence.gather, other))
    assert _process(db, target)["outcome"] == "handled"
