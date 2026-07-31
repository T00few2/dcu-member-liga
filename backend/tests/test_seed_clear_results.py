"""
Clearing seeded results must drop event-level finalized ("Afsluttet") status.

Run with:  pytest backend/tests/test_seed_clear_results.py -v
"""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import seed  # noqa: E402


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


def _race_snap(race_id: str, data: dict) -> MagicMock:
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = data
    return snap


def test_clear_seed_results_unfinalizes_parent_event(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = MagicMock()
    race_ref = MagicMock()
    race_ref.get.return_value = _race_snap(
        "r1",
        {
            "resultsSource": "seed",
            "stageRaceId": "e1",
            "resultsPhase": "finalized",
            "results": {"A": []},
        },
    )
    db.collection.return_value.document.return_value = race_ref

    monkeypatch.setattr(seed, "verify_admin_auth", lambda: None)
    monkeypatch.setattr(seed, "db", db)
    monkeypatch.setattr(
        seed,
        "load_races_by_id",
        lambda _db: {
            "r1": {"id": "r1", "stageRaceId": "e1", "resultsSource": "seed"},
        },
    )
    monkeypatch.setattr(
        seed,
        "load_stage_races",
        lambda _db: [
            {
                "id": "e1",
                "seasonClass": "wt_classic",
                "resultsPhase": "finalized",
                "bestRacesCount": 1,
            }
        ],
    )

    unfinalize_calls: list[str] = []

    def _unfinalize(_db, event):
        unfinalize_calls.append(str(event.get("id")))
        return {**event, "resultsPhase": "provisional", "finalizedAt": None}

    monkeypatch.setattr(seed, "unfinalize_event", _unfinalize)
    monkeypatch.setattr(seed, "recompute_and_save_event_gc", lambda *a, **k: {})

    processor = MagicMock()
    monkeypatch.setattr(seed, "ResultsProcessor", lambda *a, **k: processor)

    settings_doc = MagicMock()
    settings_doc.exists = True
    settings_doc.to_dict.return_value = {}

    # league/settings get() used after race updates
    def _collection(name: str):
        col = MagicMock()
        if name == "races":
            col.document.return_value = race_ref
            return col
        if name == "league":
            col.document.return_value.get.return_value = settings_doc
            return col
        return MagicMock()

    db.collection.side_effect = _collection

    with app.test_request_context(
        "/admin/seed/results",
        method="DELETE",
        json={"raceIds": ["r1"]},
    ):
        response, status = seed.clear_seed_results()

    assert status == 200
    body = response.get_json()
    assert body["cleared"] == ["r1"]
    assert unfinalize_calls == ["e1"]
    processor.save_league_standings.assert_called_once()
