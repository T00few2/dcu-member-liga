"""Route tests for the participant power fields that feed the vELO predictor.

Run with:
  pytest backend/tests/test_participants_power_fields.py -v
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

from flask import Flask
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import users_stats_routes  # noqa: E402
from routes.users import users_bp  # noqa: E402


def _points(points: dict) -> dict:
    return {str(d): {"value": w, "date": "2026-08-07T12:03:26.747Z"} for d, w in points.items()}


def _relevant(efforts: dict) -> list:
    return [{"duration": d, "watts": w} for d, w in efforts.items()]


def _user(zwift_id: str, zwift_profile: dict, power_curve: dict) -> MagicMock:
    user = MagicMock()
    user.id = zwift_id
    user.name = f"Rider {zwift_id}"
    user.zwift_id = zwift_id
    user.club = "Danish Zwift Racers"
    user._data = {
        "zwiftProfile": zwift_profile,
        "zwiftPowerCurve": power_curve,
        "zwiftRacing": {},
        "ligaCategory": None,
    }
    return user


@pytest.fixture
def app() -> Flask:
    application = Flask(__name__)
    application.register_blueprint(users_bp)
    return application


def _fetch(app: Flask, monkeypatch: pytest.MonkeyPatch, users: list) -> list:
    monkeypatch.setattr(users_stats_routes, "verify_user_token", lambda _req: {"uid": "tester"})
    monkeypatch.setattr(users_stats_routes, "db", MagicMock())
    monkeypatch.setattr(users_stats_routes, "_load_liga_settings", lambda _db: {})
    monkeypatch.setattr(users_stats_routes, "_resolve_categories", lambda _s: [])
    monkeypatch.setattr(users_stats_routes, "serialize_liga_category", lambda *_a, **_k: None)

    service = MagicMock()
    service.get_all_participants.return_value = users
    monkeypatch.setattr(users_stats_routes, "UserService", service)

    client = app.test_client()
    response = client.get("/participants", headers={"Authorization": "Bearer t"})
    assert response.status_code == 200
    return response.get_json()["participants"]


def test_prefers_the_competition_weight_zwift_divides_by(app, monkeypatch):
    # Zwift computes its own wattsKg from competitionMetrics weightInGrams, so
    # preferring it keeps our W/kg equal to what the rider sees in Zwift.
    rider = _user(
        "15690",
        {"weight": 76500, "weightInGrams": 77105},
        {"relevantCpEfforts": _relevant({60: 482})},
    )

    [participant] = _fetch(app, monkeypatch, [rider])

    assert participant["weightInGrams"] == 77105
    assert participant["male"] is None


def test_falls_back_to_profile_weight_when_competition_weight_is_missing(app, monkeypatch):
    rider = _user("1", {"weight": 76500}, {"relevantCpEfforts": _relevant({60: 482})})

    [participant] = _fetch(app, monkeypatch, [rider])

    assert participant["weightInGrams"] == 76500


def test_repairs_a_padded_5s_effort_and_keeps_the_other_durations(app, monkeypatch):
    # Real profile data: a 3-second spike at exactly 1873W padded out to 5s.
    rider = _user(
        "15690",
        {"weightInGrams": 77105},
        {
            "cpBestEfforts": {
                "pointsWatts": _points({
                    1: 1873, 2: 1873, 3: 1873, 4: 1405, 5: 1124,
                    10: 826, 15: 773, 20: 655, 25: 604, 30: 563,
                }),
            },
            "relevantCpEfforts": _relevant({5: 1124, 60: 482, 300: 368, 1200: 286}),
        },
    )

    [participant] = _fetch(app, monkeypatch, [rider])

    assert participant["cp5s"] == 925
    assert participant["cp5sEstimated"] is True
    assert participant["cp1min"] == 482
    assert participant["cp5min"] == 368
    assert participant["cp20min"] == 286


def test_keeps_a_5s_effort_backed_by_a_real_sprint(app, monkeypatch):
    rider = _user(
        "2",
        {"weightInGrams": 77105},
        {
            "cpBestEfforts": {
                "pointsWatts": _points({1: 1150, 2: 1120, 3: 1060, 4: 1000, 5: 940}),
            },
            "relevantCpEfforts": _relevant({5: 940, 60: 482}),
        },
    )

    [participant] = _fetch(app, monkeypatch, [rider])

    assert participant["cp5s"] == 940
    assert participant["cp5sEstimated"] is False


def test_keeps_a_5s_effort_when_the_curve_cannot_be_judged(app, monkeypatch):
    # No cpBestEfforts stored: nothing to check against, so the value stands.
    rider = _user("3", {"weightInGrams": 77105}, {"relevantCpEfforts": _relevant({5: 940})})

    [participant] = _fetch(app, monkeypatch, [rider])

    assert participant["cp5s"] == 940


def test_padding_in_one_rider_does_not_leak_into_the_next(app, monkeypatch):
    padded = _user(
        "a",
        {"weightInGrams": 70000},
        {
            "cpBestEfforts": {"pointsWatts": _points({4: 1405, 5: 1124, 10: 826, 15: 773})},
            "relevantCpEfforts": _relevant({5: 1124}),
        },
    )
    clean = _user(
        "b",
        {"weightInGrams": 70000},
        {
            "cpBestEfforts": {"pointsWatts": _points({4: 1000, 5: 940})},
            "relevantCpEfforts": _relevant({5: 940}),
        },
    )

    first, second = _fetch(app, monkeypatch, [padded, clean])

    assert first["cp5s"] == 925
    assert first["cp5sEstimated"] is True
    assert second["cp5s"] == 940
    assert second["cp5sEstimated"] is False


def test_drops_a_padded_5s_effort_only_when_nothing_clean_anchors_it(app, monkeypatch):
    # Whole short end is spike; no clean longer point to extrapolate from.
    rider = _user(
        "4",
        {"weightInGrams": 70000},
        {
            "cpBestEfforts": {"pointsWatts": _points({4: 1405, 5: 1124})},
            "relevantCpEfforts": _relevant({5: 1124}),
        },
    )

    [participant] = _fetch(app, monkeypatch, [rider])

    assert participant["cp5s"] is None
    assert participant["cp5sEstimated"] is True
