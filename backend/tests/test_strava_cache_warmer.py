"""Filling the Strava curve cache for predictor tuning, a couple of riders at a time."""
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
from services import strava_cache_warmer as warmer  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402


def _rider(i, *, strava=True, rides=30, velo=1200):
    return {
        "zwiftId": str(i), "userDocId": f"doc{i}", "hasStrava": strava,
        "rating": velo, "max30Rating": velo, "zwiftActivityCount": rides,
    }


def _fresh(hours=1):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _strava():
    service = MagicMock()
    service.get_power_activities.return_value = [{"id": 1}, {"id": 2}]
    return service


def test_only_reliable_riders_with_strava_are_eligible():
    riders = [_rider(1), _rider(2, strava=False), _rider(3, rides=3), _rider(4, velo="N/A")]
    assert [r["zwiftId"] for r in warmer.eligible_riders(riders, 15)] == ["1"]


def test_status_counts_fresh_curves_and_lists_never_cached_first():
    db = FakeDb()
    db.store["strava_power_curves/doc1_90"] = {"curve": {"w5": 1}, "computedAt": _fresh()}
    db.store["strava_power_curves/doc2_90"] = {"curve": {"w5": 1}, "computedAt": _fresh(hours=24 * 40)}
    riders = [_rider(1), _rider(2), _rider(3)]

    status = warmer.cache_status(db, riders, min_rides=15, days=90)

    assert status["eligible"] == 3
    assert status["cached"] == 1
    assert [r["zwiftId"] for r in status["missing"]] == ["3", "2"]  # stale one after never-cached


def test_warm_fetches_at_most_two_riders_per_call():
    db = FakeDb()
    compute = MagicMock(return_value={"w5": 900.0})
    riders = [_rider(i) for i in range(5)]

    first = warmer.warm(db, _strava(), riders, min_rides=15, days=90, compute_curve=compute)

    assert len(first["warmed"]) == 2
    assert first["remaining"] == 3
    assert first["cached"] == 2
    assert compute.call_count == 2

    for _ in range(3):
        warmer.warm(db, _strava(), riders, min_rides=15, days=90, compute_curve=compute)
    done = warmer.warm(db, _strava(), riders, min_rides=15, days=90, compute_curve=compute)
    assert done["warmed"] == [] and done["remaining"] == 0 and done["cached"] == 5
    assert compute.call_count == 5  # a full cache costs no further Strava requests


def test_a_failing_rider_does_not_stop_the_batch():
    db = FakeDb()
    service = _strava()
    service.get_power_activities.side_effect = [RuntimeError("Strava 429"), [{"id": 1}]]
    result = warmer.warm(db, service, [_rider(1), _rider(2)], min_rides=15, days=90,
                         compute_curve=MagicMock(return_value={"w5": 1.0}))
    assert result["failed"] == ["1"]
    assert [w["zwiftId"] for w in result["warmed"]] == ["2"]


# --- Routes -------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(routes, "db", db)
    monkeypatch.setattr(routes, "strava_service", _strava())
    monkeypatch.setattr(routes, "_compute_strava_power_curve", MagicMock(return_value={"w5": 1.0}))
    monkeypatch.setattr(ps, "load_participants", lambda _db: [_rider(i) for i in range(3)])
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    return app.test_client()


def test_scheduler_token_can_warm(client, monkeypatch):
    monkeypatch.setattr(routes, "require_scheduler", lambda _req: None)
    res = client.post("/admin/predictor/strava-cache/warm", json={})
    assert res.status_code == 200
    body = res.get_json()
    assert len(body["warmed"]) == 2 and body["remaining"] == 1 and body["minEvalRiders"] == 40


def test_warm_without_scheduler_token_needs_admin(client, monkeypatch):
    from authz import AuthzError

    def deny(_req):
        raise AuthzError("Forbidden", 403)

    monkeypatch.setattr(routes, "require_scheduler", deny)
    monkeypatch.setattr(routes, "require_admin", deny)
    assert client.post("/admin/predictor/strava-cache/warm", json={}).status_code == 403

    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True})
    assert client.post("/admin/predictor/strava-cache/warm", json={}).status_code == 200


def test_status_endpoint(client, monkeypatch):
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True})
    body = client.get("/admin/predictor/strava-cache/status").get_json()
    assert body == {"days": 90, "eligible": 3, "cached": 0, "remaining": 3, "minEvalRiders": 40}
