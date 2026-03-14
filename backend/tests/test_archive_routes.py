"""
Route tests for archive/reset and archive read endpoints.

Run with:
  pytest backend/tests/test_archive_routes.py -v
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

from flask import Flask
import pytest


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import admin_season, league  # noqa: E402


class _Ts:
    def __init__(self, value: float) -> None:
        self._value = value

    def timestamp(self) -> float:
        return self._value


def _doc(doc_id: str, data: dict, exists: bool = True) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = exists
    doc.to_dict.return_value = data
    return doc


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


def test_archive_season_requires_name(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_season, "require_admin", lambda _req: None)
    monkeypatch.setattr(admin_season, "db", MagicMock())

    with app.test_request_context("/admin/archive-season", method="POST", json={}):
        response, status = admin_season.archive_season()

    assert status == 400
    assert response.get_json()["message"] == "name is required"


def test_archive_season_snapshots_settings_standings_and_races(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(admin_season, "require_admin", lambda _req: None)
    monkeypatch.setattr(admin_season.uuid, "uuid4", lambda: "archive-fixed-id")

    db = MagicMock()
    monkeypatch.setattr(admin_season, "db", db)

    league_col = MagicMock()
    races_col = MagicMock()
    archives_col = MagicMock()

    settings_ref = MagicMock()
    standings_ref = MagicMock()
    settings_ref.get.return_value = _doc("settings", {"bestRacesCount": 3})
    standings_ref.get.return_value = _doc("standings", {"standings": {"A": [{"zwiftId": "1"}]}})
    league_col.document.side_effect = lambda doc_id: settings_ref if doc_id == "settings" else standings_ref

    race1 = _doc("race-1", {"name": "Race 1", "date": "2026-01-01"})
    race2 = _doc("race-2", {"name": "Race 2", "date": "2026-01-08"})
    races_col.stream.return_value = [race1, race2]

    archive_ref = MagicMock()
    archives_col.document.return_value = archive_ref
    archive_races_col = MagicMock()
    archive_ref.collection.return_value = archive_races_col
    archive_race1_ref = MagicMock()
    archive_race2_ref = MagicMock()
    archive_races_col.document.side_effect = (
        lambda doc_id: archive_race1_ref if doc_id == "race-1" else archive_race2_ref
    )

    def _collection(name: str) -> MagicMock:
        return {
            "league": league_col,
            "races": races_col,
            "archives": archives_col,
        }[name]

    db.collection.side_effect = _collection

    with app.test_request_context(
        "/admin/archive-season", method="POST", json={"name": "Spring League 2026"}
    ):
        response, status = admin_season.archive_season()

    assert status == 200
    payload = response.get_json()
    assert payload["archiveId"] == "archive-fixed-id"
    assert payload["raceCount"] == 2

    archive_ref.set.assert_called_once()
    written_archive = archive_ref.set.call_args.args[0]
    assert written_archive["name"] == "Spring League 2026"
    assert written_archive["settings"] == {"bestRacesCount": 3}
    assert written_archive["standings"] == {"A": [{"zwiftId": "1"}]}
    assert written_archive["raceCount"] == 2

    archive_race1_ref.set.assert_called_once_with({"name": "Race 1", "date": "2026-01-01"})
    archive_race2_ref.set.assert_called_once_with({"name": "Race 2", "date": "2026-01-08"})


def test_reset_season_deletes_races_and_clears_standings(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(admin_season, "require_admin", lambda _req: None)
    db = MagicMock()
    monkeypatch.setattr(admin_season, "db", db)

    races_col = MagicMock()
    league_col = MagicMock()
    db.collection.side_effect = lambda name: {"races": races_col, "league": league_col}[name]

    race_ref_1 = MagicMock()
    race_ref_2 = MagicMock()
    race_doc_1 = _doc("race-1", {})
    race_doc_2 = _doc("race-2", {})
    race_doc_1.reference = race_ref_1
    race_doc_2.reference = race_ref_2
    races_col.stream.return_value = [race_doc_1, race_doc_2]

    batch = MagicMock()
    db.batch.return_value = batch

    standings_ref = MagicMock()
    league_col.document.return_value = standings_ref

    with app.test_request_context("/admin/reset-season", method="POST"):
        response, status = admin_season.reset_season()

    assert status == 200
    payload = response.get_json()
    assert payload["racesDeleted"] == 2
    batch.delete.assert_any_call(race_ref_1)
    batch.delete.assert_any_call(race_ref_2)
    batch.commit.assert_called_once()
    standings_ref.set.assert_called_once_with(
        {"standings": {}, "updatedAt": admin_season.firestore.SERVER_TIMESTAMP},
        merge=False,
    )


def test_list_archives_returns_sorted_archive_summaries(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = MagicMock()
    monkeypatch.setattr(league, "db", db)

    archives_col = MagicMock()
    db.collection.return_value = archives_col
    archives_col.stream.return_value = [
        _doc("old", {"name": "Old", "archivedAt": _Ts(100), "raceCount": 2}),
        _doc("new", {"name": "New", "archivedAt": _Ts(200), "raceCount": 3}),
    ]

    with app.test_request_context("/archives", method="GET"):
        response, status = league.list_archives()

    assert status == 200
    payload = response.get_json()
    assert [a["id"] for a in payload["archives"]] == ["new", "old"]
    assert payload["archives"][0]["raceCount"] == 3


def test_get_archive_returns_archive_details_and_sorted_race_summaries(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = MagicMock()
    monkeypatch.setattr(league, "db", db)

    archives_col = MagicMock()
    db.collection.return_value = archives_col
    archive_ref = MagicMock()
    archives_col.document.return_value = archive_ref
    archive_ref.get.return_value = _doc(
        "arc-1",
        {
            "name": "Season A",
            "archivedAt": _Ts(321),
            "settings": {"bestRacesCount": 3},
            "standings": {"A": []},
        },
    )

    races_subcol = MagicMock()
    archive_ref.collection.return_value = races_subcol
    races_subcol.stream.return_value = [
        _doc("r2", {"name": "R2", "date": "2026-03-02", "results": {"A": []}}),
        _doc("r1", {"name": "R1", "date": "2026-03-01", "results": {}}),
    ]

    with app.test_request_context("/archives/arc-1", method="GET"):
        response, status = league.get_archive("arc-1")

    assert status == 200
    payload = response.get_json()
    assert payload["id"] == "arc-1"
    assert payload["name"] == "Season A"
    assert [r["id"] for r in payload["races"]] == ["r1", "r2"]
    assert payload["races"][1]["hasResults"] is True


def test_get_archive_returns_404_when_missing(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    db = MagicMock()
    monkeypatch.setattr(league, "db", db)
    archives_col = MagicMock()
    db.collection.return_value = archives_col
    archive_ref = MagicMock()
    archives_col.document.return_value = archive_ref
    archive_ref.get.return_value = _doc("missing", {}, exists=False)

    with app.test_request_context("/archives/missing", method="GET"):
        response, status = league.get_archive("missing")

    assert status == 404
    assert response.get_json()["message"] == "Archive not found"


def test_get_archive_race_returns_race_payload(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    db = MagicMock()
    monkeypatch.setattr(league, "db", db)
    archives_col = MagicMock()
    db.collection.return_value = archives_col
    archive_ref = MagicMock()
    archives_col.document.return_value = archive_ref
    races_subcol = MagicMock()
    archive_ref.collection.return_value = races_subcol
    race_ref = MagicMock()
    races_subcol.document.return_value = race_ref
    race_ref.get.return_value = _doc("r9", {"name": "Archived Race"})

    with app.test_request_context("/archives/a1/races/r9", method="GET"):
        response, status = league.get_archive_race("a1", "r9")

    assert status == 200
    payload = response.get_json()
    assert payload["race"]["id"] == "r9"
    assert payload["race"]["name"] == "Archived Race"


def test_get_archive_race_returns_404_when_missing(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    db = MagicMock()
    monkeypatch.setattr(league, "db", db)
    archives_col = MagicMock()
    db.collection.return_value = archives_col
    archive_ref = MagicMock()
    archives_col.document.return_value = archive_ref
    races_subcol = MagicMock()
    archive_ref.collection.return_value = races_subcol
    race_ref = MagicMock()
    races_subcol.document.return_value = race_ref
    race_ref.get.return_value = _doc("r404", {}, exists=False)

    with app.test_request_context("/archives/a1/races/r404", method="GET"):
        response, status = league.get_archive_race("a1", "r404")

    assert status == 404
    assert response.get_json()["message"] == "Race not found"
