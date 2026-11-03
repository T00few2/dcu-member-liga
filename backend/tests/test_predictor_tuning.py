"""Predictor tuning: eval set, cross-validation, search, and tuning runs."""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import predictor_service as ps  # noqa: E402
from services import predictor_tuning as pt  # noqa: E402
from services import predictor_tuning_runs as runs  # noqa: E402
from services import velo_predictor as vp  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402

STRAVA_UNDER_READS = 0.88  # outdoor power meter reads 12% lower than the trainer


def _rider(i: int, *, rides: int = 30) -> dict:
    kg = 60 + (i * 7) % 32
    wkg20 = 2.3 + ((i * 37) % 100) / 100 * 2.6
    noise = ((i * 53) % 41) - 20
    velo = round(380 + wkg20 * 370 + noise)
    return {
        "name": f"R{i}", "zwiftId": str(1000 + i), "userDocId": f"doc{i}",
        "weightInGrams": kg * 1000,
        "cp5s": round(kg * wkg20 * 3.6), "cp1min": round(kg * wkg20 * 1.8),
        "cp5min": round(kg * wkg20 * 1.18), "cp20min": round(kg * wkg20 * 1.04),
        "racingScore": 300 + i, "rating": velo - 5, "max30Rating": velo,
        "zwiftActivityCount": rides, "ligaCategory": None,
    }


def _curves(participants: list[dict], factor: float = STRAVA_UNDER_READS, days=(90,)):
    store = {}
    for p in participants:
        for d in days:
            store[(p["userDocId"], d)] = {
                "curve": {
                    "w5": p["cp5s"] * factor, "w60": p["cp1min"] * factor,
                    "w300": p["cp5min"] * factor, "w1200": p["cp20min"] * factor,
                },
                "activityCount": 20,
            }
    return lambda doc_id, d: store.get((doc_id, d))


def test_reliable_velo_needs_rides_and_a_stable_rating():
    p = _rider(1)
    assert pt.reliable_velo(p, 15) == p["max30Rating"]
    assert pt.reliable_velo({**p, "zwiftActivityCount": 5}, 15) is None
    assert pt.reliable_velo({**p, "rating": p["max30Rating"] * 0.7}, 15) is None
    assert pt.reliable_velo({**p, "max30Rating": "N/A"}, 15) is None


def test_eval_set_keeps_only_riders_with_a_cached_strava_curve():
    participants = [_rider(i) for i in range(10)]
    read = _curves(participants[:6])
    riders = pt.build_eval_set(participants, read, min_rides=15)
    assert [r.zwiftId for r in riders] == [p["zwiftId"] for p in participants[:6]]
    assert set(riders[0].strava) == {90}


def test_folds_are_disjoint_and_cover_every_rider():
    participants = [_rider(i) for i in range(23)]
    riders = pt.build_eval_set(participants, _curves(participants), min_rides=15)
    folds = pt.folds_for(riders, 5)
    ids = [i for f in folds for i in f]
    assert len(ids) == len(set(ids)) == 23


def test_fitted_strava_scale_recovers_the_under_reading():
    participants = [_rider(i) for i in range(30)]
    riders = pt.build_eval_set(participants, _curves(participants), min_rides=15)
    scale = pt.fit_strava_scale(riders, 90)
    assert scale["wkg20m"] == pytest.approx(1 / STRAVA_UNDER_READS, abs=0.02)


def test_tuning_finds_the_outdoor_correction_and_reports_changed_riders():
    participants = [_rider(i) for i in range(60)]
    riders = pt.build_eval_set(participants, _curves(participants), min_rides=15)
    current = vp.PredictorConfig()

    result = pt.tune(participants, riders, current, min_riders=40)

    assert result.status == "improved"
    assert result.improvementPP >= pt.MIN_IMPROVEMENT_PP
    assert result.best["score"]["divisionAccuracy"] > result.current["score"]["divisionAccuracy"]
    assert result.best["config"]["stravaPowerScale"]["wkg20m"] > 1.05
    assert result.changedRiders, "the riders whose division would change are listed"


def test_tuning_does_not_propose_without_enough_data():
    participants = [_rider(i) for i in range(60)]
    riders = pt.build_eval_set(participants[:10], _curves(participants[:10]), min_rides=15)
    result = pt.tune(participants, riders, vp.PredictorConfig(), min_riders=40)
    assert result.status == "insufficient_data"
    assert result.best is None
    assert "Only 10 riders" in result.message


def test_tuning_does_not_propose_when_nothing_is_better():
    participants = [_rider(i) for i in range(60)]
    # Strava reads exactly like Zwift: nothing to correct.
    riders = pt.build_eval_set(participants, _curves(participants, factor=1.0), min_rides=15)
    result = pt.tune(participants, riders, vp.PredictorConfig(), min_riders=40, min_improvement_pp=50)
    assert result.status == "no_improvement"
    assert result.changedRiders == []


def test_past_predicted_placements_are_scored():
    rows = [_rider(i) for i in range(4)]
    rows[0]["ligaCategory"] = {"manualAssignedFrom": "predicted", "predictedVelo": rows[0]["max30Rating"] + 20}
    rows[1]["ligaCategory"] = {"manualAssignedFrom": "predicted", "predictedVelo": rows[1]["max30Rating"] - 600}
    rows[2]["ligaCategory"] = {"manualAssignedFrom": "admin"}
    out = pt.past_prediction_outcomes(rows, min_rides=15)
    assert out["n"] == 2
    assert out["divisionAccuracy"] == 50.0
    assert out["meanBias"] == pytest.approx(-290.0)


# --- Runs ---------------------------------------------------------------------


class _Query:
    def __init__(self, docs):
        self.docs = docs

    def order_by(self, *_a, **_k):
        return self

    def limit(self, n):
        return _Query(self.docs[:n])

    def stream(self):
        return [type("S", (), {"to_dict": lambda self, d=d: d})() for d in self.docs]


@pytest.fixture
def run_db(monkeypatch):
    db = FakeDb()
    participants = [_rider(i) for i in range(60)]
    for p in participants:
        db.store[f"strava_power_curves/{p['userDocId']}_90"] = {
            "curve": _curves([p])(p["userDocId"], 90)["curve"], "activityCount": 20,
        }
    monkeypatch.setattr(ps, "load_participants", lambda _db: participants)
    monkeypatch.setattr(ps, "load_categories", lambda _db: None)
    ps.clear_caches()
    return db


def test_run_is_stored_pending_and_apply_saves_the_config(run_db):
    run = runs.run_tuning(run_db, started_by="admin@example.com")
    assert run["status"] == "pending"
    assert run_db.store[f"{runs.COLLECTION}/{run['runId']}"]["result"]["status"] == "improved"

    applied = runs.apply_run(run_db, run["runId"], decided_by="admin@example.com")

    settings = run_db.store["league/settings"]
    assert settings["predictorConfig"] == applied["config"]
    assert settings["predictorMetrics"]["runId"] == run["runId"]
    assert settings["predictorConfigHistory"][0]["config"] == vp.PredictorConfig().to_dict()
    assert run_db.store[f"{runs.COLLECTION}/{run['runId']}"]["status"] == "applied"
    with pytest.raises(runs.TuningRunError):
        runs.apply_run(run_db, run["runId"], decided_by="admin@example.com")


def test_reject_keeps_the_config(run_db):
    run = runs.run_tuning(run_db, started_by="admin")
    runs.reject_run(run_db, run["runId"], decided_by="admin", note="Not convinced")
    assert "league/settings" not in run_db.store
    assert run_db.store[f"{runs.COLLECTION}/{run['runId']}"]["decisionNote"] == "Not convinced"


def test_report_only_run_cannot_be_applied(run_db, monkeypatch):
    monkeypatch.setattr(ps, "load_participants", lambda _db: [_rider(i) for i in range(5)])
    run = runs.run_tuning(run_db, started_by="admin")
    assert run["status"] == "report"
    with pytest.raises(runs.TuningRunError):
        runs.apply_run(run_db, run["runId"], decided_by="admin")
