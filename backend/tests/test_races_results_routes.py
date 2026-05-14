"""
Route tests for results refresh/finalize lifecycle endpoints.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

from flask import Flask
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import races  # noqa: E402


def _doc(doc_id: str, data: dict, exists: bool = True) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = exists
    doc.to_dict.return_value = data
    return doc


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


def test_refresh_results_accepts_phase_and_returns_lifecycle_metadata(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(races, "verify_admin_auth", lambda: None)

    db = MagicMock()
    monkeypatch.setattr(races, "db", db)
    monkeypatch.setattr(races, "_lock_categories_for_race", lambda _race_id: None)
    monkeypatch.setattr(races, "get_zwift_service", lambda: MagicMock())
    monkeypatch.setattr(races, "get_zwift_game_service", lambda: MagicMock())

    race_ref = MagicMock()
    race_ref.get.return_value = _doc(
        "race-1",
        {
            "resultsPhase": "provisional",
            "provisionalUpdatedAt": "2026-05-14T18:00:00Z",
            "finalizedAt": None,
            "finalizeRunId": None,
        },
    )
    races_col = MagicMock()
    races_col.document.return_value = race_ref
    db.collection.side_effect = lambda name: races_col if name == "races" else MagicMock()

    class _Processor:
        def __init__(self, _db, _zwift, _game) -> None:
            pass

        def process_race_results(self, race_id: str, **kwargs):
            assert race_id == "race-1"
            assert kwargs["results_phase"] == "provisional"
            assert kwargs["fetch_mode"] == "finishers"
            return {"A": []}

    monkeypatch.setattr(races, "ResultsProcessor", _Processor)

    with app.test_request_context(
        "/races/race-1/results/refresh",
        method="POST",
        json={"source": "finishers", "phase": "provisional", "categoryFilter": "All"},
    ):
        response, status = races.refresh_results("race-1")

    assert status == 200
    body = response.get_json()
    assert body["resultsPhase"] == "provisional"
    assert body["provisionalUpdatedAt"] == "2026-05-14T18:00:00Z"


def test_finalize_results_uses_finalize_phase_and_run_id(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(races, "verify_admin_auth", lambda: None)

    db = MagicMock()
    monkeypatch.setattr(races, "db", db)
    monkeypatch.setattr(races, "_lock_categories_for_race", lambda _race_id: None)
    monkeypatch.setattr(races, "get_zwift_service", lambda: MagicMock())
    monkeypatch.setattr(races, "get_zwift_game_service", lambda: MagicMock())

    race_ref = MagicMock()
    race_ref.get.return_value = _doc(
        "race-1",
        {
            "resultsPhase": "finalized",
            "provisionalUpdatedAt": "2026-05-14T18:00:00Z",
            "finalizedAt": "2026-05-14T19:00:00Z",
            "finalizeRunId": "manual-run",
        },
    )
    races_col = MagicMock()
    races_col.document.return_value = race_ref
    db.collection.side_effect = lambda name: races_col if name == "races" else MagicMock()

    class _Processor:
        def __init__(self, _db, _zwift, _game) -> None:
            pass

        def process_race_results(self, race_id: str, **kwargs):
            assert race_id == "race-1"
            assert kwargs["results_phase"] == "finalized"
            assert kwargs["finalize_run_id"] == "manual-run"
            return {"A": []}

    monkeypatch.setattr(races, "ResultsProcessor", _Processor)

    with app.test_request_context(
        "/races/race-1/results/finalize",
        method="POST",
        json={"finalizeRunId": "manual-run"},
    ):
        response, status = races.finalize_results("race-1")

    assert status == 200
    body = response.get_json()
    assert body["resultsPhase"] == "finalized"
    assert body["finalizeRunId"] == "manual-run"


def test_finalize_pending_races_runs_only_eligible_races(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(races, "require_scheduler", lambda _req: None)
    monkeypatch.setattr(races, "verify_admin_auth", lambda: None)
    monkeypatch.setattr(races, "_lock_categories_for_race", lambda _race_id: None)
    monkeypatch.setattr(races, "get_zwift_service", lambda: MagicMock())
    monkeypatch.setattr(races, "get_zwift_game_service", lambda: MagicMock())

    db = MagicMock()
    monkeypatch.setattr(races, "db", db)

    race_docs = [
        _doc("race-eligible", {"name": "eligible"}),
        _doc("race-skip", {"name": "skip"}),
    ]
    races_col = MagicMock()
    races_col.stream.return_value = race_docs
    db.collection.side_effect = lambda name: races_col if name == "races" else MagicMock()

    monkeypatch.setattr(
        races,
        "_should_auto_finalize_race",
        lambda race_data, _now: race_data.get("name") == "eligible",
    )

    called: list[str] = []

    class _Processor:
        def __init__(self, _db, _zwift, _game) -> None:
            pass

        def process_race_results(self, race_id: str, **kwargs):
            called.append(race_id)
            assert kwargs["results_phase"] == "finalized"
            return {"A": []}

    monkeypatch.setattr(races, "ResultsProcessor", _Processor)

    with app.test_request_context("/admin/races/results/finalize-pending", method="POST"):
        response, status = races.finalize_pending_races()

    assert status == 200
    body = response.get_json()
    assert called == ["race-eligible"]
    assert body["finalized"] == 1
    assert body["skipped"] == 1
