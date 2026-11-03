"""Faster predictor tooling: ride selection, one-query cache reads, background tuning."""
from __future__ import annotations

import os
import random
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import predictor_service as ps  # noqa: E402
from services import predictor_tuning_runs as runs  # noqa: E402
from services import strava_power_curve as spc  # noqa: E402
from services.dual_recording.time_series import _compute_best_efforts  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402
from tests.test_predictor_research import QueryDb  # noqa: E402
from tests.test_predictor_tuning import _rider  # noqa: E402


# --- ride selection ------------------------------------------------------------------


def _ride(i: int, rng: random.Random) -> tuple[dict, list[float]]:
    """A ride: steady riding plus one hard block and one sprint, like real training data."""
    minutes = rng.choice([30, 45, 60, 90, 120, 180])
    base = rng.uniform(150, 230)
    watts = [base + rng.uniform(-20, 20) for _ in range(minutes * 60)]
    if rng.random() < 0.6:  # some rides have an interval block
        start = rng.randrange(0, len(watts) - 1200)
        effort = rng.uniform(250, 330)
        length = rng.choice([300, 600, 1200])
        for t in range(start, min(len(watts), start + length)):
            watts[t] = effort + rng.uniform(-10, 10)
    if rng.random() < 0.7:  # and a sprint
        start = rng.randrange(0, len(watts) - 30)
        peak = rng.uniform(600, 1100)
        for t in range(start, start + rng.choice([5, 10, 20])):
            watts[t] = peak
    np_watts = (sum(w ** 4 for w in watts) / len(watts)) ** 0.25
    summary = {
        "id": i,
        "startDate": (datetime(2026, 8, 1, tzinfo=timezone.utc) + timedelta(days=i)).isoformat(),
        "maxWatts": max(watts),
        "weightedAverageWatts": round(np_watts),
        "movingTime": len(watts),
    }
    return summary, watts


def test_selected_rides_keep_the_peak_efforts():
    for seed in range(5):
        rng = random.Random(seed)
        rides = [_ride(i, rng) for i in range(45)]
        streams = {s["id"]: w for s, w in rides}
        summaries = [s for s, _ in rides]

        def peaks(chosen):
            best: dict[str, float] = {}
            for s in chosen:
                for k, v in _compute_best_efforts(streams[s["id"]]).items():
                    best[k] = max(best.get(k, 0), v)
            return best

        chosen = spc.select_peak_rides(summaries)
        assert len(chosen) <= 17
        full, picked = peaks(summaries), peaks(chosen)
        for key in ("w5", "w60", "w300", "w1200"):
            assert picked[key] == pytest.approx(full[key], rel=0.03), (seed, key)


def test_few_rides_are_all_kept_and_missing_numbers_fall_back_to_recent():
    rides = [{"id": i, "startDate": f"2026-09-{i + 1:02d}"} for i in range(30)]
    assert len(spc.select_peak_rides(rides[:10])) == 10
    chosen = spc.select_peak_rides(rides)  # no summary power at all
    assert {r["id"] for r in chosen} >= {29, 28, 27}  # the most recent rides are always included


def test_only_selected_streams_are_fetched_but_all_rides_are_counted():
    db = FakeDb()
    service = MagicMock()
    service.get_power_activities.return_value = [
        {"id": i, "startDate": f"2026-09-{i % 28 + 1:02d}", "maxWatts": i, "weightedAverageWatts": i,
         "movingTime": 3600} for i in range(40)]
    compute = MagicMock(return_value={"w5": 900.0})
    entry = spc.get_strava_power_curve(db, service, "u1", 90, compute_curve=compute)
    assert entry["activityCount"] == 40
    assert entry["streamsFetched"] == len(compute.call_args.args[1]) <= 17


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
    assert runs.list_runs(tune_db)[0]["status"] == "failed"
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
