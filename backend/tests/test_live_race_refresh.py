"""
Route tests for public live-race provisional refresh endpoint.
"""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

from flask import Flask
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import live_race  # noqa: E402


def _doc(doc_id: str, data: dict, exists: bool = True) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = exists
    doc.to_dict.return_value = data
    return doc


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


def _setup_db(
    monkeypatch: pytest.MonkeyPatch,
    *,
    active_race_id: str | None,
    race_data: dict | None,
    race_exists: bool = True,
) -> MagicMock:
    db = MagicMock()
    monkeypatch.setattr(live_race, "db", db)

    state_ref = MagicMock()
    if active_race_id:
        state_ref.get.return_value = _doc("active", {"raceId": active_race_id})
    else:
        state_ref.get.return_value = _doc("active", {}, exists=False)

    race_ref = MagicMock()
    if race_data is not None and race_exists:
        race_ref.get.return_value = _doc("race-1", race_data)
    else:
        race_ref.get.return_value = _doc("race-1", {}, exists=False)

    def _collection(name: str) -> MagicMock:
        if name == "liveRaceState":
            col = MagicMock()
            col.document.return_value = state_ref
            return col
        if name == "races":
            col = MagicMock()
            col.document.return_value = race_ref
            return col
        return MagicMock()

    db.collection.side_effect = _collection
    return db


def test_refresh_noop_when_no_active_race(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    _setup_db(monkeypatch, active_race_id=None, race_data=None)

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    assert response.get_json() == {"status": "noop"}


def test_refresh_noop_when_finalized(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    _setup_db(
        monkeypatch,
        active_race_id="race-1",
        race_data={
            "resultsPhase": "finalized",
            "date": now.isoformat(),
        },
    )

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    assert response.get_json() == {"status": "noop"}


def test_refresh_skipped_on_cooldown(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    recent = now - timedelta(seconds=10)
    _setup_db(
        monkeypatch,
        active_race_id="race-1",
        race_data={
            "resultsPhase": "provisional",
            "date": now.isoformat(),
            "provisionalUpdatedAt": recent.isoformat(),
            "resultsAutomation": {"pollingIntervalSeconds": 30},
        },
    )

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    body = response.get_json()
    assert body["status"] == "skipped"
    assert "nextEligibleAt" in body


def test_refresh_updated_when_eligible(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    db = _setup_db(
        monkeypatch,
        active_race_id="race-1",
        race_data={
            "resultsPhase": "provisional",
            "date": now.isoformat(),
            "resultsAutomation": {"pollingIntervalSeconds": 30},
        },
    )
    monkeypatch.setattr(live_race, "get_zwift_service", lambda: MagicMock())
    monkeypatch.setattr(live_race, "get_zwift_game_service", lambda: MagicMock())

    class _Processor:
        def __init__(self, _db, _zwift, _game) -> None:
            pass

        def process_race_results(self, race_id: str, **kwargs):
            assert race_id == "race-1"
            assert kwargs["results_phase"] == "provisional"
            assert kwargs["fetch_mode"] == "finishers"
            assert kwargs["category_filter"] == "All"
            return {"A": []}

    monkeypatch.setattr(live_race, "ResultsProcessor", _Processor)

    updated_at = now.isoformat()
    race_ref = db.collection("races").document.return_value
    race_ref.get.side_effect = [
        _doc("race-1", {
            "resultsPhase": "provisional",
            "date": now.isoformat(),
            "resultsAutomation": {"pollingIntervalSeconds": 30},
        }),
        _doc("race-1", {
            "resultsPhase": "provisional",
            "provisionalUpdatedAt": updated_at,
        }),
    ]

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    body = response.get_json()
    assert body["status"] == "updated"
    assert body["provisionalUpdatedAt"] == updated_at
    assert "nextEligibleAt" in body


def test_refresh_noop_past_safety_window(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    now = datetime.now(timezone.utc)
    old_start = now - timedelta(hours=5)
    _setup_db(
        monkeypatch,
        active_race_id="race-1",
        race_data={
            "resultsPhase": "provisional",
            "date": old_start.isoformat(),
            "resultsAutomation": {"windowDurationMinutes": 180},
        },
    )

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    assert response.get_json() == {"status": "noop"}


def test_refresh_honors_short_configured_window(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A configured 60-min window must stop refresh at 1h, not at the 4h hard cap.

    Regression for the original max(configured, MAX) bug that silently ignored short
    windowDurationMinutes values.
    """
    now = datetime.now(timezone.utc)
    old_start = now - timedelta(minutes=90)
    _setup_db(
        monkeypatch,
        active_race_id="race-1",
        race_data={
            "resultsPhase": "provisional",
            "date": old_start.isoformat(),
            "resultsAutomation": {"windowDurationMinutes": 60},
        },
    )

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    assert response.get_json() == {"status": "noop"}


def test_polling_interval_clamped_to_floor(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A maliciously/accidentally tiny pollingIntervalSeconds is clamped server-side."""
    now = datetime.now(timezone.utc)
    recent = now - timedelta(seconds=5)
    _setup_db(
        monkeypatch,
        active_race_id="race-1",
        race_data={
            "resultsPhase": "provisional",
            "date": now.isoformat(),
            "provisionalUpdatedAt": recent.isoformat(),
            "resultsAutomation": {"pollingIntervalSeconds": 1},
        },
    )

    with app.test_request_context("/live-race/active/results/refresh", method="POST"):
        response, status = live_race.refresh_active_race_results()

    assert status == 200
    body = response.get_json()
    # 5s elapsed < MIN floor of 10s → must skip, despite config saying 1s
    assert body["status"] == "skipped"
