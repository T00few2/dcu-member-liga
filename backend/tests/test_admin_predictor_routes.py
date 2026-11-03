"""Admin predictor endpoints and the Strava power-curve cache."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import admin_predictor_routes as routes  # noqa: E402
from routes.admin import admin_bp  # noqa: E402
from services import predictor_service as ps  # noqa: E402
from services import strava_power_curve as spc  # noqa: E402
from services import velo_predictor as vp  # noqa: E402


class FakeSnap:
    def __init__(self, data):
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        return dict(self._data) if self._data is not None else None


class FakeDoc:
    def __init__(self, store, path):
        self.store = store
        self.path = path

    def get(self):
        return FakeSnap(self.store.get(self.path))

    def set(self, data, merge=False):
        if merge and self.path in self.store:
            self.store[self.path] = {**self.store[self.path], **data}
        else:
            self.store[self.path] = dict(data)


class FakeCollection:
    def __init__(self, store, name):
        self.store = store
        self.name = name

    def document(self, doc_id):
        return FakeDoc(self.store, f"{self.name}/{doc_id}")


class FakeDb:
    def __init__(self):
        self.store: dict[str, dict] = {}

    def collection(self, name):
        return FakeCollection(self.store, name)


def _participants(n=25):
    rows = []
    for i in range(n):
        kg = 62 + (i * 5) % 30
        wkg20 = 2.5 + (i * 0.13) % 2.2
        rows.append({
            "name": f"R{i}", "zwiftId": str(100 + i), "weightInGrams": kg * 1000,
            "cp5s": round(kg * wkg20 * 3.7), "cp1min": round(kg * wkg20 * 1.9),
            "cp5min": round(kg * wkg20 * 1.2), "cp20min": round(kg * wkg20 * 1.05),
            "racingScore": 300, "max30Rating": round(500 + wkg20 * 350 + (i % 5) * 7),
            "ligaCategory": None,
        })
    return rows


@pytest.fixture
def fake_db(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(routes, "db", db)
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True, "email": "admin@example.com"})
    monkeypatch.setattr(ps, "load_participants", lambda _db: _participants())
    monkeypatch.setattr(ps, "load_categories", lambda _db: None)
    ps.clear_caches()
    return db


@pytest.fixture
def client():
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    return app.test_client()


def test_model_returns_fit_and_every_riders_prediction(client, fake_db):
    res = client.post("/admin/predictor/model", json={})
    assert res.status_code == 200
    body = res.get_json()
    assert body["model"]["n"] == 25
    assert body["config"]["features"]["wkg20m"] is True
    assert {f["key"] for f in body["features"]} == set(vp.FEATURE_BY_KEY)
    assert set(body["predictions"]) == {str(100 + i) for i in range(25)}
    assert body["predictions"]["100"]["velo"] > 0


def test_model_previews_an_unsaved_config(client, fake_db):
    features = {k: False for k in vp.DEFAULT_FEATURES}
    features["wkg20m"] = True
    res = client.post("/admin/predictor/model", json={"config": {"features": features}})
    assert res.get_json()["model"]["activeFeatureKeys"] == ["wkg20m"]
    assert "predictor_settings/current" not in fake_db.store  # preview never saves


def test_predict_batches_rows_and_applies_strava_settings(client, fake_db):
    fake_db.store["predictor_settings/current"] = {"config": {"minStravaActivities": 4}}
    inputs = {"weightKg": 75, "racingScore": 0, "wkg5s": 12, "wkg1m": 6.5, "wkg5m": 4.4, "wkg20m": 3.7}
    res = client.post("/admin/predictor/predict", json={"rows": [
        {"id": "zwift", "inputs": inputs},
        {"id": "strava", "inputs": inputs, "source": "strava", "activityCount": 2},
        {"no": "id"},
    ]})
    preds = res.get_json()["predictions"]
    assert set(preds) == {"zwift", "strava"}
    assert preds["zwift"]["velo"] == preds["strava"]["velo"]
    assert preds["strava"]["confidence"] == "low"


def test_predict_rejects_a_non_list(client, fake_db):
    assert client.post("/admin/predictor/predict", json={"rows": "x"}).status_code == 400


def test_save_keeps_history_and_rollback_restores(client, fake_db):
    first = {k: False for k in vp.DEFAULT_FEATURES}
    first["wkg20m"] = True
    assert client.post("/admin/predictor/config", json={"config": {"features": first}}).status_code == 200
    second = dict(first, wkg5m=True)
    client.post("/admin/predictor/config", json={"config": {"features": second, "regression": "ridge",
                                                             "ridgeLambda": 0.1}})

    saved = fake_db.store["predictor_settings/current"]
    assert saved["config"]["regression"] == "ridge"
    assert saved["config"]["features"] == second
    assert saved["history"][0]["config"]["features"] == first
    assert saved["history"][0]["replacedBy"] == "admin@example.com"

    res = client.post("/admin/predictor/config", json={"rollbackIndex": 0})
    assert res.status_code == 200
    assert fake_db.store["predictor_settings/current"]["config"]["features"] == first
    assert fake_db.store["predictor_settings/current"]["config"]["regression"] == "ols"
    # league/settings is world-readable: admin emails and reasons must never land there.
    assert "league/settings" not in fake_db.store

    got = client.get("/admin/predictor/config").get_json()
    assert got["config"]["features"] == first
    assert len(got["history"]) == 3


def test_legacy_public_feature_map_is_used_until_the_first_save(client, fake_db):
    legacy = {k: False for k in vp.DEFAULT_FEATURES}
    legacy["wkg20m"] = True
    fake_db.store["league/settings"] = {"predictorFeatures": legacy}
    assert client.get("/admin/predictor/config").get_json()["config"]["features"] == legacy

    client.post("/admin/predictor/config", json={"config": {"features": dict(legacy, wkg5m=True)}})

    assert fake_db.store["league/settings"] == {"predictorFeatures": legacy}  # untouched
    got = client.get("/admin/predictor/config").get_json()
    assert got["config"]["features"]["wkg5m"] is True
    assert got["history"][0]["config"]["features"] == legacy


def test_save_refuses_an_empty_feature_set(client, fake_db):
    res = client.post("/admin/predictor/config", json={"config": {"features": {k: False for k in vp.DEFAULT_FEATURES}}})
    assert res.status_code == 400


def test_rollback_index_out_of_range(client, fake_db):
    assert client.post("/admin/predictor/config", json={"rollbackIndex": 3}).status_code == 400


def test_non_admin_is_refused(client, monkeypatch):
    from authz import AuthzError

    def deny(_req):
        raise AuthzError("Forbidden", 403)

    monkeypatch.setattr(routes, "require_admin", deny)
    assert client.post("/admin/predictor/model", json={}).status_code == 403


# --- Strava curve cache ------------------------------------------------------


def _strava(activities):
    service = MagicMock()
    service.get_power_activities.return_value = activities
    return service


def test_curve_is_fetched_once_and_then_served_from_cache():
    db = FakeDb()
    service = _strava([{"id": 1}, {"id": 2}])
    compute = MagicMock(return_value={"w5": 900, "w1200": 280})

    first = spc.get_strava_power_curve(db, service, "u1", 90, compute_curve=compute)
    second = spc.get_strava_power_curve(db, service, "u1", 90, compute_curve=compute)

    assert first["cached"] is False and second["cached"] is True
    assert second["curve"] == {"w5": 900.0, "w1200": 280.0}
    assert second["activityCount"] == 2
    assert compute.call_count == 1


def test_stale_cache_is_refetched_but_cache_only_mode_never_fetches():
    db = FakeDb()
    old = (datetime.now(timezone.utc) - timedelta(hours=30)).isoformat()
    db.store["strava_power_curves/u1_90"] = {"curve": {"w5": 1.0}, "activityCount": 1, "computedAt": old}
    service = _strava([{"id": 1}])
    compute = MagicMock(return_value={"w5": 2.0})

    cache_only = spc.get_strava_power_curve(db, service, "u1", 90, compute_curve=compute, allow_fetch=False)
    assert cache_only["curve"] == {"w5": 1.0}
    assert compute.call_count == 0

    fresh = spc.get_strava_power_curve(db, service, "u1", 90, compute_curve=compute)
    assert fresh["curve"] == {"w5": 2.0}
    assert spc.get_strava_power_curve(db, service, "u2", 90, compute_curve=compute, allow_fetch=False) is None


def test_curve_rejects_unknown_window():
    with pytest.raises(ValueError):
        spc.get_strava_power_curve(FakeDb(), _strava([]), "u1", 45, compute_curve=MagicMock())
