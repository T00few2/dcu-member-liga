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
from services.schema_validation import CURRENT_SCHEMA_VERSION  # noqa: E402


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
    doc.reference = MagicMock()
    doc.reference.collections.return_value = []
    return doc


def _race_doc_with_dr(
    race_id: str,
    race_data: dict,
    dr_docs: list[tuple[str, dict]],
) -> MagicMock:
    race = _doc(race_id, race_data)
    race_ref = MagicMock()
    race.reference = race_ref

    dr_col = MagicMock()
    nested = []
    for dr_id, dr_data in dr_docs:
        nested_doc = _doc(dr_id, dr_data)
        nested_doc.reference = MagicMock()
        nested.append(nested_doc)
    dr_col.id = "dr_verifications"
    dr_col.stream.return_value = nested
    race_ref.collections.return_value = [dr_col]
    return race


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


def test_archive_season_snapshots_settings_standings_races_and_dr(
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
    standings_ref.get.return_value = _doc(
        "standings",
        {"schemaVersion": 1, "standings": {"A": [{"zwiftId": "1"}]}},
    )
    league_col.document.side_effect = (
        lambda doc_id: settings_ref if doc_id == "settings" else standings_ref
    )

    race1 = _race_doc_with_dr(
        "race-1",
        {"name": "Race 1", "date": "2026-01-01"},
        [("z1", {"zwiftId": "z1", "status": "passed"})],
    )
    race2 = _race_doc_with_dr(
        "race-2",
        {"name": "Race 2", "date": "2026-01-08"},
        [
            ("z2", {"zwiftId": "z2", "status": "failed"}),
            ("z3", {"zwiftId": "z3", "status": "passed"}),
        ],
    )
    races_col.stream.return_value = [race1, race2]

    archive_ref = MagicMock()
    archives_col.document.return_value = archive_ref
    archive_races_col = MagicMock()
    archive_ref.collection.return_value = archive_races_col

    archive_race_refs: dict[str, MagicMock] = {}
    archive_dr_sets: list[tuple[str, dict]] = []

    def _archive_race_document(doc_id: str) -> MagicMock:
        if doc_id not in archive_race_refs:
            race_ref = MagicMock()
            dr_dest = MagicMock()
            race_ref.collection.return_value = dr_dest

            def _dr_document(dr_id: str) -> MagicMock:
                dr_ref = MagicMock()
                dr_ref.id = dr_id

                def _capture_set(data: dict) -> None:
                    archive_dr_sets.append((dr_id, data))

                dr_ref.set.side_effect = _capture_set
                return dr_ref

            dr_dest.document.side_effect = _dr_document
            archive_race_refs[doc_id] = race_ref
        return archive_race_refs[doc_id]

    archive_races_col.document.side_effect = _archive_race_document

    batch = MagicMock()
    db.batch.return_value = batch

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
    assert payload["drVerificationCount"] == 3

    assert archive_ref.set.call_count == 1
    written_archive = archive_ref.set.call_args.args[0]
    assert written_archive["name"] == "Spring League 2026"
    assert written_archive["settings"] == {"bestRacesCount": 3}
    assert written_archive["standings"] == {"A": [{"zwiftId": "1"}]}
    assert written_archive["raceCount"] == 2
    assert written_archive["drVerificationCount"] == 0
    archive_ref.update.assert_called_once_with({"drVerificationCount": 3})

    # Parent races + 3 DR docs queued via batch.set
    assert batch.set.call_count == 5
    set_payloads = [call.args[1] for call in batch.set.call_args_list]
    assert {"name": "Race 1", "date": "2026-01-01"} in set_payloads
    assert {"name": "Race 2", "date": "2026-01-08"} in set_payloads
    assert {"zwiftId": "z1", "status": "passed"} in set_payloads
    assert {"zwiftId": "z2", "status": "failed"} in set_payloads
    assert {"zwiftId": "z3", "status": "passed"} in set_payloads
    batch.commit.assert_called()


def test_reset_season_deletes_races_dr_clears_standings_and_live_state(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(admin_season, "require_admin", lambda _req: None)
    db = MagicMock()
    monkeypatch.setattr(admin_season, "db", db)

    races_col = MagicMock()
    league_col = MagicMock()
    live_col = MagicMock()

    def _collection(name: str) -> MagicMock:
        return {
            "races": races_col,
            "league": league_col,
            "liveRaceState": live_col,
        }[name]

    db.collection.side_effect = _collection

    race_doc_1 = _race_doc_with_dr(
        "race-1",
        {},
        [("z1", {"zwiftId": "z1"})],
    )
    race_doc_2 = _race_doc_with_dr(
        "race-2",
        {},
        [("z2", {"zwiftId": "z2"}), ("z3", {"zwiftId": "z3"})],
    )
    races_col.stream.return_value = [race_doc_1, race_doc_2]

    batch = MagicMock()
    db.batch.return_value = batch

    standings_ref = MagicMock()
    league_col.document.return_value = standings_ref
    live_ref = MagicMock()
    live_col.document.return_value = live_ref

    with app.test_request_context("/admin/reset-season", method="POST"):
        response, status = admin_season.reset_season()

    assert status == 200
    payload = response.get_json()
    assert payload["racesDeleted"] == 2
    assert payload["nestedDocsDeleted"] == 3

    # 3 DR docs + 2 race parents
    assert batch.delete.call_count == 5
    batch.delete.assert_any_call(race_doc_1.reference)
    batch.delete.assert_any_call(race_doc_2.reference)
    batch.commit.assert_called()

    standings_payload = standings_ref.set.call_args.args[0]
    assert standings_payload["standings"] == {}
    assert standings_payload["schemaVersion"] == CURRENT_SCHEMA_VERSION
    assert standings_ref.set.call_args.kwargs["merge"] is False

    live_payload = live_ref.set.call_args.args[0]
    assert live_payload["raceId"] is None
    assert live_payload["manualDisabled"] is True
    assert live_payload["activatedBy"] == "season_reset"
    assert live_ref.set.call_args.kwargs["merge"] is False


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


def test_get_archive_race_dr_verifications_returns_nested_docs(
    app: Flask, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setattr(league, "verify_user_token", lambda _req: {"uid": "u1"})
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
    race_ref.get.return_value = _doc("r1", {"name": "Sprint"})

    dr_col = MagicMock()
    race_ref.collection.return_value = dr_col
    dr_col.stream.return_value = [
        _doc("z1", {"status": "passed", "zwiftId": "z1"}),
        _doc("z2", {"status": "failed"}),
    ]

    with app.test_request_context("/archives/a1/races/r1/dr-verifications", method="GET"):
        response, status = league.get_archive_race_dr_verifications("a1", "r1")

    assert status == 200
    payload = response.get_json()
    assert len(payload["verifications"]) == 2
    assert payload["verifications"][0]["zwiftId"] == "z1"
    assert payload["verifications"][1]["zwiftId"] == "z2"
