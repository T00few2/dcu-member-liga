"""Claude sandbox research: anonymized dataset, the Claude loop, run lifecycle."""
from __future__ import annotations

import csv
import io
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import predictor_research as research  # noqa: E402
from services import predictor_service as ps  # noqa: E402
from services import predictor_tuning as pt  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb, FakeSnap  # noqa: E402
from tests.test_predictor_tuning import _curves, _rider  # noqa: E402


class _Query:
    def __init__(self, store, name):
        self.docs = [dict(v) for k, v in store.items() if k.startswith(f"{name}/")]
        self._limit = None

    def order_by(self, field, direction="ASCENDING"):
        self.docs.sort(key=lambda d: d.get(field) or "", reverse=direction == "DESCENDING")
        return self

    def limit(self, n):
        self._limit = n
        return self

    def stream(self):
        docs = self.docs[: self._limit] if self._limit else self.docs
        return [FakeSnap(d) for d in docs]


class QueryDb(FakeDb):
    def collection(self, name):
        coll = super().collection(name)
        coll.order_by = lambda field, direction="ASCENDING": _Query(self.store, name).order_by(field, direction)
        return coll


def _parse_csv(data: bytes) -> list[dict]:
    return list(csv.DictReader(io.StringIO(data.decode())))


# --- dataset --------------------------------------------------------------------


def test_dataset_is_anonymized_and_keeps_folds_and_baseline():
    participants = [_rider(i) for i in range(50)]
    read = _curves(participants)
    riders = pt.build_eval_set(participants, read, min_rides=15)
    _, per_rider = pt.cross_validate(participants, riders, research.vp.PredictorConfig())

    ds = research.build_dataset(participants, riders, per_rider, read, salt="s")

    blob = b"".join(ds["files"].values()).decode()
    ids = {p["zwiftId"] for p in participants}
    for p in participants:
        assert f"{p['name']}," not in blob and f",{p['name']}" not in blob
        assert p["userDocId"] not in blob
    eval_rows = _parse_csv(ds["files"]["eval.csv"])
    training_rows = _parse_csv(ds["files"]["training.csv"])
    assert not ({r["rider"] for r in eval_rows + training_rows} & ids)  # riders keyed by hash only
    assert "name" not in eval_rows[0] and "zwiftId" not in eval_rows[0]
    # ZRS is as unreliable as vELO for the riders we predict for, so it is never sent.
    assert "racingScore" not in eval_rows[0] and "racingScore" not in training_rows[0]
    assert "Do NOT use the Zwift Racing Score" in research.SYSTEM_PROMPT
    assert len(eval_rows) == 50 and ds["counts"]["eval"] == 50
    assert {r["fold"] for r in eval_rows} == {"0", "1", "2", "3", "4"}
    assert all(r["baselinePredDivision"] for r in eval_rows)
    assert eval_rows[0]["strava90_w1200"] != ""
    assert ds["idMap"][eval_rows[0]["rider"]] in {p["zwiftId"] for p in participants}
    divisions = _parse_csv(ds["files"]["divisions.csv"])
    assert divisions[0]["division"] == "Diamond"


# --- Claude loop ------------------------------------------------------------------


def _resp(stop, blocks, container="c1", inp=100, out=50):
    return SimpleNamespace(
        stop_reason=stop, content=blocks, container=SimpleNamespace(id=container),
        usage=SimpleNamespace(input_tokens=inp, output_tokens=out),
    )


def _text(t):
    return SimpleNamespace(type="text", text=t, model_dump=lambda **_: {"type": "text", "text": t})


def _submit(findings):
    return SimpleNamespace(type="tool_use", name="submit_findings", id="tu1", input=findings,
                           model_dump=lambda **_: {"type": "tool_use", "id": "tu1", "name": "submit_findings",
                                                   "input": findings})


FINDINGS = {
    "baselineDivisionAccuracy": 55.0, "bestDivisionAccuracy": 62.0, "baselineMaeVelo": 90.0,
    "bestMaeVelo": 75.0, "improved": True, "summary": "Ratio of 1min/20min helps.",
    "method": "OLS on wkg20m, wkg1m/wkg20m", "proposedCode": "FeatureDef(...)", "caveats": "n=50",
    "ridersChanged": 4,
}


class FakeMessages:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return self.responses.pop(0)


def _client(responses):
    msgs = FakeMessages(responses)
    files = SimpleNamespace(
        uploaded=[], deleted=[],
    )
    files.upload = lambda file, expires_in_seconds: (files.uploaded.append(file[0]),
                                                     SimpleNamespace(id=f"f-{file[0]}"))[1]
    files.delete = lambda fid: files.deleted.append(fid)
    return SimpleNamespace(beta=SimpleNamespace(messages=msgs), files=files), msgs


def test_loop_continues_paused_turns_and_returns_submitted_findings():
    client, msgs = _client([
        _resp("pause_turn", [_text("running the baseline")]),
        _resp("tool_use", [_text("done"), _submit(FINDINGS)]),
    ])
    out = research.run_claude(client, model="claude-opus-5-5", file_ids=["a", "b"], baseline_note="x",
                              deadline=float("inf"))
    assert out["status"] == "done" and out["findings"] == FINDINGS
    assert out["usage"] == {"inputTokens": 200, "outputTokens": 100, "turns": 2}
    first, second = msgs.calls
    assert [c["type"] for c in first["messages"][0]["content"]] == ["text", "container_upload", "container_upload"]
    assert first["fallbacks"] == "default" and research.FALLBACK_BETA in first["betas"]
    assert {t.get("type", t.get("name")) for t in first["tools"]} == {"code_execution_20260521", "submit_findings"}
    assert second["container"] == "c1"  # same sandbox across turns


def test_loop_nudges_once_then_fails_without_findings():
    client, msgs = _client([_resp("end_turn", [_text("all done")]), _resp("end_turn", [_text("bye")])])
    out = research.run_claude(client, model="m", file_ids=[], baseline_note="", deadline=float("inf"))
    assert out["status"] == "failed" and len(msgs.calls) == 2
    nudges = [m for m in msgs.calls[1]["messages"] if m["role"] == "user" and isinstance(m["content"], str)]
    assert len(nudges) == 1 and "submit_findings" in nudges[0]["content"]


def test_loop_stops_at_the_deadline_and_on_refusal():
    client, _ = _client([_resp("pause_turn", [_text("x")])] * 3)
    ticks = iter([0, 10, 1000])
    out = research.run_claude(client, model="m", file_ids=[], baseline_note="", deadline=100,
                              clock=lambda: next(ticks))
    assert out["status"] == "timed_out" and out["usage"]["turns"] == 1  # 2nd turn would start past the deadline

    client, _ = _client([_resp("refusal", [])])
    assert research.run_claude(client, model="m", file_ids=[], baseline_note="",
                               deadline=float("inf"))["status"] == "failed"


# --- assessment -------------------------------------------------------------------


def _score(acc):
    return pt.Score(n=50, divisionAccuracy=acc, adjacentAccuracy=95, maeVelo=90, zwiftDivisionAccuracy=80)


def test_a_proposal_needs_a_reproduced_baseline_a_clear_gain_and_code():
    assert research.assess_findings(FINDINGS, _score(55.4))["outcome"] == "proposal"
    assert research.assess_findings(FINDINGS, _score(50.0))["baselineReproduced"] is False
    assert research.assess_findings(FINDINGS, _score(50.0))["outcome"] == "report"
    assert research.assess_findings({**FINDINGS, "bestDivisionAccuracy": 56.0}, _score(55.0))["outcome"] == "report"
    assert research.assess_findings({**FINDINGS, "proposedCode": " "}, _score(55.0))["outcome"] == "report"


# --- run lifecycle ------------------------------------------------------------------


@pytest.fixture
def run_db(monkeypatch):
    db = QueryDb()
    participants = [_rider(i) for i in range(60)]
    read = _curves(participants)
    for p in participants:
        db.store[f"strava_power_curves/{p['userDocId']}_90"] = read(p["userDocId"], 90)
    monkeypatch.setattr(ps, "load_participants", lambda _db: participants)
    monkeypatch.setattr(ps, "load_categories", lambda _db: None)
    return db


def test_queue_then_process_stores_findings_and_cleans_up_files(run_db):
    run = research.queue_run(run_db, started_by="admin@example.com")
    with pytest.raises(research.ResearchError):
        research.queue_run(run_db, started_by="admin@example.com")

    client, _ = _client([_resp("tool_use", [_submit(FINDINGS)])])
    done = research.process_next(run_db, client_factory=lambda: client)

    stored = run_db.store[f"{research.COLLECTION}/{run['runId']}"]
    assert done["status"] == stored["status"] == "done"
    assert stored["findings"] == FINDINGS
    assert stored["evalRiders"] == 60 and stored["idMap"]
    assert stored["outcome"] in ("proposal", "report")
    assert sorted(client.files.uploaded) == ["divisions.csv", "eval.csv", "training.csv"]
    assert sorted(client.files.deleted) == ["f-divisions.csv", "f-eval.csv", "f-training.csv"]
    assert "idMap" not in research.list_runs(run_db)[0]  # never sent to the browser
    assert research.process_next(run_db, client_factory=lambda: client) is None  # idle


def test_process_fails_cleanly_without_enough_data(run_db, monkeypatch):
    monkeypatch.setattr(ps, "load_participants", lambda _db: [_rider(i) for i in range(5)])
    research.queue_run(run_db, started_by="admin")
    done = research.process_next(run_db, client_factory=lambda: pytest.fail("no Claude call expected"))
    assert done["status"] == "failed" and "Only 5 riders" in done["error"]


def test_stale_running_run_is_failed_and_monthly_auto_queue(run_db):
    old = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    run_db.store[f"{research.COLLECTION}/r0"] = {"runId": "r0", "status": "running", "createdAt": old,
                                                 "startedAt": old}
    assert research.auto_queue_due(run_db, older_than_days=30) is False  # one created 45 min ago
    research.queue_run(run_db, started_by="admin")  # stale run no longer blocks
    assert run_db.store[f"{research.COLLECTION}/r0"]["status"] == "failed"

    long_ago = (datetime.now(timezone.utc) - timedelta(days=40)).isoformat()
    db2 = QueryDb()
    db2.store[f"{research.COLLECTION}/r1"] = {"runId": "r1", "status": "done", "createdAt": long_ago}
    assert research.auto_queue_due(db2, older_than_days=30) is True


# --- routes -------------------------------------------------------------------------


def test_routes_queue_list_and_idle_process(monkeypatch):
    from flask import Flask
    from routes import admin_predictor_routes as routes
    from routes.admin import admin_bp

    db = QueryDb()
    monkeypatch.setattr(routes, "db", db)
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True, "email": "a@example.com"})
    monkeypatch.setattr(routes, "require_scheduler", lambda _req: None)
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    client = app.test_client()

    assert client.post("/admin/predictor/research/process", json={}).get_json() == {"idle": True, "autoQueued": False}
    queued = client.post("/admin/predictor/research", json={}).get_json()
    assert queued["status"] == "queued" and queued["startedBy"] == "a@example.com"
    assert client.post("/admin/predictor/research", json={}).status_code == 400
    assert client.get("/admin/predictor/research/runs").get_json()["runs"][0]["runId"] == queued["runId"]


# --- review fixes -------------------------------------------------------------------


def test_only_riders_with_the_active_strava_window_are_sent(run_db, monkeypatch):
    # 15 of 60 riders only have a 180-day curve; the active window is 90 days.
    for i in range(15):
        doc = f"doc{i}"
        run_db.store[f"strava_power_curves/{doc}_180"] = run_db.store.pop(f"strava_power_curves/{doc}_90")
    research.queue_run(run_db, started_by="admin")
    client, _ = _client([_resp("tool_use", [_submit(FINDINGS)])])
    done = research.process_next(run_db, client_factory=lambda: client)
    assert done["evalRiders"] == 45 == done["baseline"]["n"]


def test_a_second_worker_cannot_claim_a_run_that_is_being_processed(run_db):
    research.queue_run(run_db, started_by="admin")
    assert research._acquire_lock(run_db, "other-worker") is True
    assert research.process_next(run_db, client_factory=lambda: pytest.fail("must not run")) is None
    research._release_lock(run_db, "other-worker")

    # A lock left behind by a killed worker is taken over after the stale window.
    old = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    run_db.store[f"{research.LOCK_COLLECTION}/{research.LOCK_DOC}"] = {"owner": "dead", "at": old}
    client, _ = _client([_resp("tool_use", [_submit(FINDINGS)])])
    assert research.process_next(run_db, client_factory=lambda: client)["status"] == "done"
    assert f"{research.LOCK_COLLECTION}/{research.LOCK_DOC}" not in run_db.store  # released


def test_a_slow_call_is_bounded_by_the_deadline():
    class Timeout(Exception):
        pass

    Timeout.__name__ = "APITimeoutError"
    seen = {}

    def create(**kwargs):
        raise Timeout("slow")

    def with_options(timeout, max_retries):
        seen.update(timeout=timeout, max_retries=max_retries)
        return SimpleNamespace(beta=SimpleNamespace(messages=SimpleNamespace(create=create)))

    client = SimpleNamespace(with_options=with_options)
    ticks = iter([0, 0, 0])
    out = research.run_claude(client, model="m", file_ids=[], baseline_note="", deadline=300,
                              clock=lambda: next(ticks))
    assert out["status"] == "timed_out"
    assert seen == {"timeout": 300, "max_retries": 0}

    # Too little time left for another turn: stop before calling.
    out = research.run_claude(client, model="m", file_ids=[], baseline_note="", deadline=30, clock=lambda: 0)
    assert out["status"] == "timed_out"


def test_scheduler_response_has_no_private_fields():
    run = {"runId": "r", "status": "done", "outcome": "report", "improvementPP": 0.5,
           "startedBy": "admin@example.com", "lastText": "model text", "error": "x", "findings": {}}
    assert research.public_summary(run) == {"runId": "r", "status": "done", "outcome": "report",
                                           "improvementPP": 0.5}
