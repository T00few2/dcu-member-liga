"""Direct and FIT dual recordings: validation, windows, and source selection."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

_STUBS = [
    "firebase_admin",
    "firebase_admin.credentials",
    "firebase_admin.firestore",
    "firebase_admin.storage",
    "firebase_admin.auth",
    "google.cloud",
    "google.cloud.firestore",
]
for _name in _STUBS:
    sys.modules.setdefault(_name, MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording import submitted, workflows  # noqa: E402
from services.dual_recording.submitted import SubmittedRecordingError  # noqa: E402


def test_missing_method_is_strava():
    assert submitted.normalize_method(None) == "strava"
    assert submitted.normalize_method("nope") == "strava"
    assert submitted.normalize_method("direct") == "direct"


def test_samples_require_power_and_heart_rate():
    start = 1_700_000_000_000
    try:
        submitted.samples_to_streams([
            {"t": start, "watts": 200, "cadence": 90, "hr": None},
            {"t": start + 1000, "watts": 210, "cadence": 91, "hr": None},
        ])
    except SubmittedRecordingError as exc:
        assert "puls" in exc.message
    else:
        raise AssertionError("expected missing heart rate")


def test_summary_and_replacement_window():
    start = 1_700_000_000_000
    streams = submitted.samples_to_streams([
        {"t": start, "watts": 100, "cadence": 80, "hr": 120, "trainerWatts": 110},
        {"t": start + 10_000, "watts": 200, "cadence": 90, "hr": 140, "trainerWatts": 190},
    ])
    summary = submitted.summarize_streams(streams)
    assert summary["avgPower"] == 150.0
    assert summary["avgHr"] == 130.0
    assert summary["durationSec"] == 10
    assert summary["powerCoveragePct"] > 0

    slot = datetime(2026, 5, 20, 17, 0, tzinfo=timezone.utc)
    assert submitted.upload_allowed(
        kind="direct", start=slot, now=slot - timedelta(hours=47), verification_status=None,
    )
    assert not submitted.upload_allowed(
        kind="upload", start=slot, now=slot - timedelta(hours=1), verification_status=None,
    )
    assert submitted.upload_allowed(
        kind="upload", start=slot, now=slot + timedelta(days=20), verification_status="missing_strava",
    )
    assert submitted.upload_allowed(
        kind="upload", start=slot, now=slot + timedelta(days=2), verification_status="passed",
    )


def test_fit_parse_reads_power_and_heart_rate(monkeypatch):
    class FitDataMessage:
        pass

    class Frame(FitDataMessage):
        name = "record"

        def __init__(self, fields):
            self.fields = fields

        def has_field(self, name):
            return name in self.fields

        def get_value(self, name):
            return self.fields[name]

    class FitReader:
        def __init__(self, _raw):
            self._raw = _raw

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

        def __iter__(self):
            t0 = datetime(2026, 5, 20, 17, 0, tzinfo=timezone.utc)
            yield Frame({"timestamp": t0, "power": 180, "heart_rate": 130, "cadence": 85})
            yield Frame({
                "timestamp": t0 + timedelta(seconds=30),
                "power": 220,
                "heart_rate": 150,
                "cadence": 95,
            })

    import types
    fake = types.ModuleType("fitdecode")
    fake.FitDataMessage = FitDataMessage
    fake.FitReader = FitReader
    monkeypatch.setitem(sys.modules, "fitdecode", fake)

    streams = submitted.parse_fit_bytes(b"not-a-real-fit")
    assert streams["watts"] == [180.0, 220.0]
    assert streams["heartrate"] == [130.0, 150.0]
    assert streams["time"] == [0, 30]


def _zwift_ready(monkeypatch):
    db = MagicMock()
    zwift_doc = MagicMock()
    zwift_doc.exists = True
    zwift_doc.to_dict.return_value = {"data": {"id": "zwift-activity"}}
    db.collection.return_value.document.return_value.get.return_value = zwift_doc
    fake_zwift = MagicMock()
    fake_zwift.get_best_power_curve_activity.return_value = {"pointsWatts": {}}
    monkeypatch.setattr(workflows, "get_valid_access_token", lambda *_a, **_k: "token")
    monkeypatch.setattr(workflows, "get_zwift_service", lambda: fake_zwift)
    monkeypatch.setattr(
        workflows,
        "_extract_zwift_activity_fields",
        lambda _raw: {"startedAt": "2026-05-20T17:00:00Z", "durationSec": 30, "avgWatts": 200},
    )
    monkeypatch.setattr(
        workflows,
        "_fetch_zwift_streams",
        lambda *_a, **_k: ({"time": [0, 30], "watts": [200, 200], "cadence": [90, 90]}, {}),
    )
    monkeypatch.setattr(
        workflows,
        "_trim_strava_streams",
        lambda s_times, s_watts, s_cadence, s_hr, s_alt, *_a, **_k: (
            {"time": s_times, "watts": s_watts, "cadence": s_cadence, "heartrate": s_hr, "altitude": s_alt},
            0,
            "submitted",
            0,
        ),
    )
    return db


def test_submitted_file_skips_strava(monkeypatch):
    db = _zwift_ready(monkeypatch)
    called = {"match": False}

    def _boom(*_a, **_k):
        called["match"] = True
        raise AssertionError("Strava should not be fetched")

    monkeypatch.setattr(workflows, "_match_strava_activity", _boom)
    monkeypatch.setattr(
        workflows,
        "load_submitted_recording",
        lambda *_a, **_k: {
            "source": "direct",
            "startedAt": "2026-05-20T17:00:00Z",
            "durationSec": 30,
            "avgPower": 190,
            "streams": {
                "time": [0, 30],
                "watts": [180, 200],
                "cadence": [90, 90],
                "heartrate": [140, 150],
                "altitude": [],
                "startedAt": "2026-05-20T17:00:00Z",
            },
            "trainer": {"name": "Kickr", "avgWatts": 195},
            "broken": False,
        },
    )
    result = workflows._compute_dual_recording_for_rider(
        db, "10001", "zwift-activity", race_id="race-1",
    )
    assert called["match"] is False
    assert result["recordingSource"] == "direct"
    assert result["strava"]["activityId"] is None
    assert result["trainer"]["avgWatts"] == 195


def test_direct_preference_without_a_file_does_not_call_strava(monkeypatch):
    db = _zwift_ready(monkeypatch)
    monkeypatch.setattr(workflows, "load_submitted_recording", lambda *_a, **_k: None)
    monkeypatch.setattr(workflows, "recording_method", lambda *_a, **_k: "direct")
    monkeypatch.setattr(
        workflows,
        "_match_strava_activity",
        lambda *_a, **_k: (_ for _ in ()).throw(AssertionError("Strava should wait")),
    )
    result = workflows._compute_dual_recording_for_rider(
        db, "10001", "zwift-activity", race_id="race-1",
    )
    assert result["awaitingFile"] is True
    assert result["recordingSource"] == "direct"
    assert result["strava"] is None


def test_strava_preference_still_matches_strava(monkeypatch):
    db = _zwift_ready(monkeypatch)
    monkeypatch.setattr(workflows, "load_submitted_recording", lambda *_a, **_k: None)
    monkeypatch.setattr(workflows, "recording_method", lambda *_a, **_k: "strava")
    monkeypatch.setattr(
        workflows,
        "_match_strava_activity",
        lambda *_a, **_k: (
            {"name": "Strava", "startDate": "2026-05-20T17:00:00Z", "durationSec": 30, "averageWatts": 180},
            "55",
            {},
        ),
    )
    monkeypatch.setattr(
        workflows.strava_service,
        "get_activity_streams",
        lambda *_a, **_k: [
            {"type": "time", "data": [0, 30]},
            {"type": "watts", "data": [180, 180]},
            {"type": "cadence", "data": [90, 90]},
            {"type": "heartrate", "data": [140, 140]},
            {"type": "altitude", "data": [1, 1]},
        ],
    )
    result = workflows._compute_dual_recording_for_rider(
        db, "10001", "zwift-activity", race_id="race-1",
    )
    assert result["recordingSource"] == "strava"
    assert result["strava"]["activityId"] == 55
