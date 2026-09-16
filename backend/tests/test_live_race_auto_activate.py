"""Auto-activation window (30 min lead-in) and manualDisabled re-open rules."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timezone, timedelta
from unittest.mock import MagicMock

from flask import Flask
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import live_race  # noqa: E402


ECKD_START = datetime(2026, 9, 17, 17, 0, tzinfo=timezone.utc)  # 19:00 Copenhagen


def _race_doc(doc_id: str, date: datetime | str) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = True
    doc.to_dict.return_value = {"name": doc_id, "date": date}
    return doc


def _setup_races(monkeypatch: pytest.MonkeyPatch, races: list[MagicMock]) -> MagicMock:
    db = MagicMock()
    monkeypatch.setattr(live_race, "db", db)

    state_ref = MagicMock()
    races_col = MagicMock()
    races_col.stream.return_value = races
    races_col.document.side_effect = lambda rid: MagicMock(
        get=lambda: next((d for d in races if d.id == rid), _race_doc(rid, ECKD_START))
    )

    def _collection(name: str) -> MagicMock:
        if name == "liveRaceState":
            col = MagicMock()
            col.document.return_value = state_ref
            return col
        if name == "races":
            return races_col
        return MagicMock()

    db.collection.side_effect = _collection
    return db


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


def test_auto_activate_too_early(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(live_race, "_now_utc", lambda: ECKD_START - timedelta(minutes=31))
    db = _setup_races(monkeypatch, [_race_doc("eckd", ECKD_START.isoformat())])

    assert live_race._auto_activate_if_due() is None
    db.collection("liveRaceState").document("active").set.assert_not_called()


def test_auto_activate_in_lead_in(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(live_race, "_now_utc", lambda: ECKD_START - timedelta(minutes=30))
    db = _setup_races(monkeypatch, [_race_doc("eckd", ECKD_START.isoformat())])

    result = live_race._auto_activate_if_due()
    assert result is not None
    race_id, _data, _at = result
    assert race_id == "eckd"
    payload = db.collection("liveRaceState").document("active").set.call_args.args[0]
    assert payload["raceId"] == "eckd"
    assert payload["activatedBy"] == "auto"
    assert payload["manualDisabled"] is False


def test_auto_activate_after_start(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(live_race, "_now_utc", lambda: ECKD_START + timedelta(minutes=5))
    _setup_races(monkeypatch, [_race_doc("eckd", ECKD_START.isoformat())])

    result = live_race._auto_activate_if_due()
    assert result is not None
    assert result[0] == "eckd"


def test_auto_activate_after_four_hour_window(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(live_race, "_now_utc", lambda: ECKD_START + timedelta(hours=4, seconds=1))
    _setup_races(monkeypatch, [_race_doc("eckd", ECKD_START.isoformat())])

    assert live_race._auto_activate_if_due() is None


def test_disabled_at_skips_current_window(monkeypatch: pytest.MonkeyPatch) -> None:
    """Deactivate during warmup: window already started, do not re-open this race."""
    now = ECKD_START - timedelta(minutes=15)
    monkeypatch.setattr(live_race, "_now_utc", lambda: now)
    _setup_races(monkeypatch, [_race_doc("eckd", ECKD_START.isoformat())])

    disabled_at = ECKD_START - timedelta(minutes=15)
    assert live_race._auto_activate_if_due(disabled_at=disabled_at) is None


def test_disabled_at_allows_later_race(monkeypatch: pytest.MonkeyPatch) -> None:
    """Season reset / deactivate before the next race's window still opens that race."""
    dzr_start = datetime(2026, 10, 22, 17, 0, tzinfo=timezone.utc)
    now = dzr_start - timedelta(minutes=10)
    monkeypatch.setattr(live_race, "_now_utc", lambda: now)
    _setup_races(
        monkeypatch,
        [
            _race_doc("eckd", ECKD_START.isoformat()),
            _race_doc("dzr", dzr_start.isoformat()),
        ],
    )

    disabled_at = datetime(2026, 7, 28, 4, 48, tzinfo=timezone.utc)
    result = live_race._auto_activate_if_due(disabled_at=disabled_at)
    assert result is not None
    assert result[0] == "dzr"


def test_current_manual_disabled_without_activated_at_stays_off(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = _setup_races(monkeypatch, [_race_doc("eckd", ECKD_START.isoformat())])
    state_ref = db.collection("liveRaceState").document("active")
    state_snap = MagicMock()
    state_snap.exists = True
    state_snap.to_dict.return_value = {"raceId": None, "manualDisabled": True}
    state_ref.get.return_value = state_snap
    monkeypatch.setattr(live_race, "_now_utc", lambda: ECKD_START - timedelta(minutes=10))

    with app.test_request_context("/live-race/current"):
        _body, status = live_race.get_live_race_current()

    assert status == 204


def test_current_manual_disabled_reopens_later_race(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    dzr_start = datetime(2026, 10, 22, 17, 0, tzinfo=timezone.utc)
    monkeypatch.setattr(live_race, "_now_utc", lambda: dzr_start - timedelta(minutes=10))
    db = _setup_races(
        monkeypatch,
        [
            _race_doc("eckd", ECKD_START.isoformat()),
            _race_doc("dzr", dzr_start.isoformat()),
        ],
    )
    state_ref = db.collection("liveRaceState").document("active")
    state_snap = MagicMock()
    state_snap.exists = True
    state_snap.to_dict.return_value = {
        "raceId": None,
        "manualDisabled": True,
        "activatedAt": "2026-07-28T04:48:00+00:00",
        "activatedBy": "season_reset",
    }
    state_ref.get.return_value = state_snap

    with app.test_request_context("/live-race/current"):
        body, status = live_race.get_live_race_current()

    assert status == 200
    assert body.get_json()["id"] == "dzr"
