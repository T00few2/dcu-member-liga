"""Tests for dual-recording candidate scope and public visibility."""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording.scope import (  # noqa: E402
    dual_recording_opted_in,
    is_dr_candidate,
    public_dr_row_visible,
)
from services.dual_recording_admin_core import collect_dr_candidates_for_race  # noqa: E402
from routes.users_profile_routes import (  # noqa: E402
    _assemble_profile_dr_verifications,
    _parse_dr_doc_path,
    _profile_dr_summary,
)


def _doc(doc_id: str, data: dict, exists: bool = True) -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.exists = exists
    snap.to_dict.return_value = data
    return snap


def _make_db(users: dict[str, dict], trainers: list[dict], verification_cats: list[str]) -> MagicMock:
    user_snaps = {zid: _doc(zid, payload) for zid, payload in users.items()}

    users_col = MagicMock()
    users_col.document.side_effect = lambda zid: MagicMock(get=lambda: user_snaps.get(str(zid), _doc(str(zid), {}, exists=False)))

    trainers_col = MagicMock()
    trainers_col.stream.return_value = [_doc(f"t{i}", t) for i, t in enumerate(trainers)]

    settings_ref = MagicMock()
    settings_ref.get.return_value = _doc(
        "settings",
        {
            "ligaCategories": [
                {"name": name, "requiresVerification": True} for name in verification_cats
            ]
            + [{"name": "Emerald", "requiresVerification": False}],
        },
    )
    league_col = MagicMock()
    league_col.document.return_value = settings_ref

    db = MagicMock()
    db.collection.side_effect = lambda name: {
        "users": users_col,
        "trainers": trainers_col,
        "league": league_col,
    }[name]
    return db


def test_public_dr_row_visible_legacy_and_opt_in() -> None:
    assert public_dr_row_visible({"status": "failed"}) is True
    assert public_dr_row_visible({"status": "failed", "source": "mandatory"}) is True
    assert public_dr_row_visible({"status": "passed", "source": "opt_in"}) is True
    assert public_dr_row_visible({"status": "failed", "source": "opt_in"}) is False
    assert public_dr_row_visible({"status": "missing_strava", "source": "opt_in"}) is False


def test_opt_in_flag() -> None:
    assert dual_recording_opted_in({"dualRecordingOptIn": True}) is True
    assert dual_recording_opted_in({"dualRecordingOptIn": False}) is False
    assert dual_recording_opted_in({}) is False


def test_collect_mandatory_and_opt_in(monkeypatch: pytest.MonkeyPatch) -> None:
    users = {
        "1": {"equipment": {"trainer": "Cheap Trainer"}, "dualRecordingOptIn": False},
        "2": {"equipment": {"trainer": "Kickr"}, "dualRecordingOptIn": True},
        "3": {"equipment": {"trainer": "Kickr"}, "dualRecordingOptIn": False},
    }
    trainers = [
        {"name": "Cheap Trainer", "normalizedName": "cheap trainer", "dualRecordingRequired": True},
        {"name": "Kickr", "normalizedName": "kickr", "dualRecordingRequired": False},
    ]
    db = _make_db(users, trainers, ["Diamond"])
    race = {
        "results": {
            "Diamond": [{"zwiftId": "1", "name": "Mandatory", "activityId": "a1"}],
            "Emerald": [
                {"zwiftId": "2", "name": "OptIn", "activityId": "a2"},
                {"zwiftId": "3", "name": "Neither", "activityId": "a3"},
            ],
        }
    }
    candidates = collect_dr_candidates_for_race(db, race)
    by_id = {c["zwiftId"]: c for c in candidates}
    assert set(by_id) == {"1", "2"}
    assert by_id["1"]["source"] == "mandatory"
    assert by_id["2"]["source"] == "opt_in"


def test_is_dr_candidate_mandatory_wins() -> None:
    users = {
        "1": {"equipment": {"trainer": "Cheap Trainer"}, "dualRecordingOptIn": True},
    }
    trainers = [
        {"name": "Cheap Trainer", "normalizedName": "cheap trainer", "dualRecordingRequired": True},
    ]
    db = _make_db(users, trainers, ["Diamond"])
    included, source = is_dr_candidate(
        db,
        "1",
        category="Diamond",
        user_data=users["1"],
        verification_cats={"Diamond"},
    )
    assert included is True
    assert source == "mandatory"


def test_parse_dr_doc_path() -> None:
    assert _parse_dr_doc_path("archives/season1/races/r9/dr_verifications/1001") == ("season1", "r9")
    assert _parse_dr_doc_path("races/r9/dr_verifications/1001") == (None, "r9")
    assert _parse_dr_doc_path("") == (None, None)


def _dr_snap(path: str, data: dict, doc_id: str = "1") -> MagicMock:
    snap = MagicMock()
    snap.id = doc_id
    snap.to_dict.return_value = data
    snap.reference.path = path
    return snap


def test_profile_dr_summary_archive_path() -> None:
    snap = _dr_snap(
        "archives/season1/races/r9/dr_verifications/1001",
        {"zwiftId": "1001", "status": "failed", "source": "opt_in", "verifiedAt": "2026-02-01"},
        "1001",
    )
    row = _profile_dr_summary(snap)
    assert row["archiveId"] == "season1"
    assert row["raceId"] == "r9"
    assert row["source"] == "opt_in"


def test_assemble_profile_dr_live_and_archived_no_50_cap() -> None:
    docs = [
        _dr_snap(
            "races/live-1/dr_verifications/1",
            {"zwiftId": "1", "status": "passed", "verifiedAt": "2026-06-01T00:00:00+00:00"},
        )
    ]
    for i in range(55):
        docs.append(
            _dr_snap(
                f"archives/s1/races/old-{i}/dr_verifications/1",
                {
                    "zwiftId": "1",
                    "status": "passed",
                    "verifiedAt": f"2025-01-{(i % 28) + 1:02d}T00:00:00+00:00",
                },
            )
        )

    live_doc = _doc("live-1", {"name": "Live Race"})
    archive_doc = _doc("s1", {"name": "Season One"})
    archive_races = {f"old-{i}": _doc(f"old-{i}", {"name": f"Old {i}"}) for i in range(55)}

    races_col = MagicMock()
    races_col.document.side_effect = lambda rid: MagicMock(get=lambda: live_doc if rid == "live-1" else _doc(rid, {}, exists=False))

    archive_races_col = MagicMock()
    archive_races_col.document.side_effect = lambda rid: MagicMock(get=lambda: archive_races.get(rid, _doc(rid, {}, exists=False)))

    archive_root = MagicMock()
    archive_root.get.return_value = archive_doc
    archive_root.collection.return_value = archive_races_col

    archives_col = MagicMock()
    archives_col.document.return_value = archive_root

    db = MagicMock()
    db.collection.side_effect = lambda name: {"races": races_col, "archives": archives_col}[name]

    rows = _assemble_profile_dr_verifications(docs, db)
    assert len(rows) == 56
    live = next(r for r in rows if r.get("raceId") == "live-1")
    assert live["raceName"] == "Live Race"
    archived = next(r for r in rows if r.get("raceId") == "old-0")
    assert archived["archiveId"] == "s1"
    assert archived["raceName"] == "Old 0"
    assert archived["archiveName"] == "Season One"
