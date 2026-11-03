"""Faster predictor tooling: one-query cache reads and background tuning."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone

from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import predictor_service as ps  # noqa: E402
from services import predictor_tuning_runs as runs  # noqa: E402
from services import strava_cache_warmer as warmer  # noqa: E402
from services import strava_power_curve as spc  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402
from tests.test_predictor_research import QueryDb  # noqa: E402
from tests.test_predictor_tuning import _rider  # noqa: E402
from tests.test_strava_cache_warmer import _rider as _warm_rider  # noqa: E402


# --- one-query cache reads ------------------------------------------------------------


def test_cached_reader_reads_every_curve_in_one_query():
    db = FakeDb()
    db.store["strava_power_curves/docA_90"] = {"curve": {"w5": 1.0}, "userDocId": "docA", "days": 90}
    db.store["strava_power_curves/doc_with_underscore_180"] = {"curve": {"w5": 2.0}}  # id parsed
    db.store["strava_power_curves/broken"] = {"curve": "nope"}
    read = spc.cached_reader(db)
    assert read("docA", 90)["curve"] == {"w5": 1.0}
    assert read("doc_with_underscore", 180)["curve"] == {"w5": 2.0}
    assert read("docA", 180) is None


def test_a_failed_cache_query_is_an_error_not_an_empty_cache():
    db = MagicMock()
    db.collection.return_value.stream.side_effect = RuntimeError("firestore down")
    with pytest.raises(RuntimeError):
        spc.cached_reader(db)
    with pytest.raises(RuntimeError):  # the warm-up must not refetch every rider
        warmer.warm(db, MagicMock(), [_warm_rider(1)], min_rides=15, days=90, compute_curve=MagicMock())


# --- background tuning ------------------------------------------------------------------


@pytest.fixture
def tune_db(monkeypatch):
    db = QueryDb()
    monkeypatch.setattr(ps, "load_participants", lambda _db: [_rider(i) for i in range(10)])
    monkeypatch.setattr(ps, "load_categories", lambda _db: None)
    ps.clear_caches()
    return db


def test_start_returns_at_once_and_process_fills_in_the_result(tune_db):
    run = runs.start_run(tune_db, started_by="admin")
    assert run["status"] == "running" and "result" not in run
    with pytest.raises(runs.TuningRunError):
        runs.start_run(tune_db, started_by="admin")  # one at a time

    done = runs.process_run(tune_db, run["runId"])
    stored = tune_db.store[f"{runs.COLLECTION}/{run['runId']}"]
    assert done["status"] == stored["status"] == "report"
    assert stored["result"]["status"] == "insufficient_data"
    with pytest.raises(runs.TuningRunError):
        runs.process_run(tune_db, run["runId"])  # never processed twice


def test_a_failing_computation_is_recorded(tune_db, monkeypatch):
    def boom(_db):
        raise RuntimeError("firestore down")

    monkeypatch.setattr(ps, "load_participants", boom)
    run = runs.start_run(tune_db, started_by="admin")
    done = runs.process_run(tune_db, run["runId"])
    assert done["status"] == "failed" and "firestore down" in done["error"]


def test_a_run_killed_with_its_request_is_marked_failed(tune_db):
    old = (datetime.now(timezone.utc) - timedelta(minutes=45)).isoformat()
    tune_db.store[f"{runs.COLLECTION}/r0"] = {"runId": "r0", "status": "running", "createdAt": old}
    expired = runs.list_runs(tune_db)[0]
    assert expired["status"] == "failed" and "time limit" in expired["error"]  # shown on the same poll
    assert runs.start_run(tune_db, started_by="admin")["status"] == "running"  # no longer blocked


def test_tune_routes(tune_db, monkeypatch):
    from flask import Flask
    from routes import admin_predictor_routes as routes
    from routes.admin import admin_bp

    monkeypatch.setattr(routes, "db", tune_db)
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True, "email": "a@example.com"})
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    client = app.test_client()

    started = client.post("/admin/predictor/tune", json={}).get_json()
    assert started["status"] == "running"
    processed = client.post(f"/admin/predictor/tune/{started['runId']}/process", json={}).get_json()
    assert processed == {"runId": started["runId"], "status": "report"}
    assert client.post(f"/admin/predictor/tune/{started['runId']}/process", json={}).status_code == 400
