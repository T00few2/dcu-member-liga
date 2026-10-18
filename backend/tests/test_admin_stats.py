"""
Route tests for the admin league stats endpoint, focused on the trainer
breakdowns (per liga category and dual-recording requirement).

Run with:
  pytest backend/tests/test_admin_stats.py -v
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

from flask import Flask
import pytest


sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import admin_stats  # noqa: E402


def _doc(doc_id: str, data: dict, exists: bool = True) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.exists = exists
    doc.to_dict.return_value = data
    return doc


def _user(doc_id: str, category: str, trainer: str | None) -> MagicMock:
    equipment = {"trainer": trainer} if trainer is not None else {}
    return _doc(
        doc_id,
        {
            "registration": {"status": "complete"},
            "ligaCategory": {"autoAssigned": {"category": category}},
            "equipment": equipment,
        },
    )


def _make_db(
    users: list[MagicMock],
    trainers: list[MagicMock],
    settings: dict,
    signups: list[MagicMock] | None = None,
) -> MagicMock:
    users_col = MagicMock()
    users_col.stream.return_value = users

    trainers_col = MagicMock()
    trainers_col.stream.return_value = trainers

    settings_ref = MagicMock()
    settings_ref.get.return_value = _doc("settings", settings)
    league_col = MagicMock()
    league_col.document.return_value = settings_ref

    db = MagicMock()
    db.collection.side_effect = lambda name: {
        "users": users_col,
        "trainers": trainers_col,
        "league": league_col,
    }[name]
    db.collection_group.return_value.stream.return_value = signups or []
    return db


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


@pytest.fixture
def stats(app: Flask, monkeypatch: pytest.MonkeyPatch) -> dict:
    monkeypatch.setattr(admin_stats, "require_admin", lambda _req: None)

    users = [
        _user("u1", "Diamond", "Wahoo Kickr Core"),
        _user("u2", "Diamond", "wahoo  kickr core"),   # same trainer, sloppy spelling
        _user("u3", "Diamond", "Tacx Neo 2T"),
        _user("u4", "Gold", "Wahoo Kickr Core"),
        _user("u5", "Gold", "Stages Bike 20"),         # not in the trainers catalog
        _user("u6", "Gold", None),                     # no trainer registered
    ]
    trainers = [
        _doc("t1", {"name": "Wahoo Kickr Core", "normalizedName": "wahoo kickr core",
                    "status": "approved", "dualRecordingRequired": True}),
        _doc("t2", {"name": "Tacx Neo 2T", "status": "approved", "dualRecordingRequired": False}),
    ]
    settings = {"ligaCategories": [{"name": "Diamond"}, {"name": "Gold"}]}

    monkeypatch.setattr(admin_stats, "db", _make_db(users, trainers, settings))

    with app.test_request_context("/admin/stats"):
        response = admin_stats.get_league_stats()

    return response.get_json()


def test_trainer_distribution_carries_dual_recording_bucket(stats: dict) -> None:
    by_name = {t["trainer"]: t for t in stats["trainerDistribution"]}

    assert by_name["Wahoo Kickr Core"]["count"] == 2
    assert by_name["Wahoo Kickr Core"]["dualRecording"] == "required"
    # Display labels keep the stored spelling, but the catalog lookup normalises.
    assert by_name["wahoo  kickr core"]["dualRecording"] == "required"
    assert by_name["Tacx Neo 2T"]["dualRecording"] == "notRequired"
    # Catalog lookup misses and missing equipment both fall back to unknown.
    assert by_name["Stages Bike 20"]["dualRecording"] == "unknown"
    assert by_name["Unknown"]["dualRecording"] == "unknown"


def test_trainer_by_category_splits_per_kategori(stats: dict) -> None:
    by_category = {row["category"]: row for row in stats["trainerByCategory"]}

    assert [row["category"] for row in stats["trainerByCategory"]] == ["Diamond", "Gold"]
    assert by_category["Diamond"]["total"] == 3
    assert {t["trainer"]: t["count"] for t in by_category["Diamond"]["trainers"]} == {
        "Wahoo Kickr Core": 1,
        "wahoo  kickr core": 1,
        "Tacx Neo 2T": 1,
    }
    assert {t["trainer"]: t["count"] for t in by_category["Gold"]["trainers"]} == {
        "Wahoo Kickr Core": 1,
        "Stages Bike 20": 1,
        "Unknown": 1,
    }


def test_dual_recording_distribution_overall(stats: dict) -> None:
    assert stats["dualRecordingDistribution"] == [
        {"bucket": "required", "count": 3},
        {"bucket": "notRequired", "count": 1},
        {"bucket": "unknown", "count": 2},
    ]


def test_dual_recording_by_category(stats: dict) -> None:
    assert stats["dualRecordingByCategory"] == [
        {"category": "Diamond", "required": 2, "notRequired": 1, "unknown": 0, "total": 3},
        {"category": "Gold", "required": 1, "notRequired": 0, "unknown": 2, "total": 3},
    ]


def test_race_growth_empty_without_signups(stats: dict) -> None:
    assert stats["raceGrowth"] == []


def test_race_growth_is_cumulative_per_race(app: Flask, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(admin_stats, "require_admin", lambda _req: None)
    monkeypatch.setattr(
        admin_stats,
        "db",
        _make_db([], [], {"ligaCategories": []}, signups=[
            _doc("s1", {
                "raceId": "r1",
                "status": "registered",
                "signedUpAt": "2026-04-03T10:00:00+00:00",
                "club": "Club A",
            }),
            _doc("s2", {
                "raceId": "r1",
                "status": "pending",
                "signedUpAt": "2026-04-03T18:00:00+00:00",
                "club": "Club B",
            }),
            _doc("s3", {
                "raceId": "r1",
                "status": "registered",
                "signedUpAt": "2026-04-05T10:00:00+00:00",
                "club": "Club A",
            }),
            # Failed attempts are not on the roster.
            _doc("s4", {
                "raceId": "r1",
                "status": "failed",
                "signedUpAt": "2026-04-04T10:00:00+00:00",
                "club": "Club C",
            }),
            # Missing timestamp cannot be placed on the curve.
            _doc("s5", {
                "raceId": "r1",
                "status": "registered",
                "club": "Club D",
            }),
            _doc("s6", {
                "raceId": "r2",
                "status": "registered",
                "signedUpAt": "2026-05-01T08:00:00+00:00",
                "club": "",
            }),
        ]),
    )

    with app.test_request_context("/admin/stats"):
        response = admin_stats.get_league_stats()

    by_race = {row["raceId"]: row["series"] for row in response.get_json()["raceGrowth"]}
    assert by_race["r1"] == [
        {"date": "2026-04-03", "signups": 2, "clubs": 2},
        {"date": "2026-04-05", "signups": 3, "clubs": 2},
    ]
    assert by_race["r2"] == [
        {"date": "2026-05-01", "signups": 1, "clubs": 0},
    ]
