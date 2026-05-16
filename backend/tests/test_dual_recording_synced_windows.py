from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

# Stub optional heavy modules before importing backend services.
_STUBS = [
    "firebase_admin",
    "firebase_admin.credentials",
    "firebase_admin.firestore",
    "firebase_admin.storage",
    "firebase_admin.auth",
    "google.cloud",
    "google.cloud.firestore",
]
for _s in _STUBS:
    sys.modules.setdefault(_s, MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording import workflows  # noqa: E402


def _stream(stream_type: str, data: list[float | int]) -> dict:
    return {"type": stream_type, "data": data}


def _build_mock_db() -> MagicMock:
    db = MagicMock()
    zwift_doc = MagicMock()
    zwift_doc.exists = True
    zwift_doc.to_dict.return_value = {"data": {"id": "zwift-activity"}}
    (
        db.collection.return_value
        .document.return_value
        .get.return_value
    ) = zwift_doc
    return db


def test_cpdiff_uses_zwift_peak_window_not_strava_independent_peak(monkeypatch):
    """
    Verify synced cpDiff compares Zwift peak window against the same Strava segment.

    Scenario:
    - Zwift 15s best segment is at t=[10..24] around 300W.
    - Strava has a MUCH higher independent 15s peak at t=[25..39] (400W),
      but only ~250W in Zwift's winning window.
    - Expected synced comparison for w15 uses ~250W (same segment), not 400W.
    """
    db = _build_mock_db()

    # 40-second streams at 1 Hz.
    z_times = list(range(40))
    z_watts = [100.0] * 40
    for i in range(10, 25):
        z_watts[i] = 300.0

    s_times = list(range(40))
    s_watts = [100.0] * 40
    for i in range(10, 25):
        s_watts[i] = 250.0
    for i in range(25, 40):
        s_watts[i] = 400.0  # Independent Strava peak outside Zwift's best 15s window.

    fake_zwift_service = MagicMock()
    fake_zwift_service.get_best_power_curve_activity.return_value = {"pointsWatts": {}}

    monkeypatch.setattr(workflows, "get_valid_access_token", lambda *_args, **_kwargs: "token")
    monkeypatch.setattr(workflows, "get_zwift_service", lambda: fake_zwift_service)
    monkeypatch.setattr(
        workflows,
        "_extract_zwift_activity_fields",
        lambda _raw: {
            "startedAt": "2026-05-16T16:00:00Z",
            "durationSec": 39,
            "avgWatts": 200.0,
        },
    )
    monkeypatch.setattr(
        workflows,
        "_fetch_zwift_streams",
        lambda *_args, **_kwargs: ({"time": z_times, "watts": z_watts}, {}),
    )
    monkeypatch.setattr(
        workflows,
        "_match_strava_activity",
        lambda *_args, **_kwargs: (
            {"id": 123, "name": "Strava DR", "startDate": "2026-05-16T16:00:00Z", "durationSec": 39, "averageWatts": 0},
            "123",
            {},
        ),
    )
    monkeypatch.setattr(
        workflows.strava_service,
        "get_activity_streams",
        lambda *_args, **_kwargs: [
            _stream("time", s_times),
            _stream("watts", s_watts),
            _stream("cadence", [90.0] * 40),
            _stream("heartrate", [150.0] * 40),
            _stream("altitude", [50.0] * 40),
        ],
    )
    monkeypatch.setattr(
        workflows,
        "_trim_strava_streams",
        lambda *_args, **_kwargs: (
            {
                "time": s_times,
                "watts": s_watts,
                "cadence": [90.0] * 40,
                "heartrate": [150.0] * 40,
                "altitude": [50.0] * 40,
            },
            0,
            "power_mse_no_shift",
            0,
        ),
    )

    result = workflows._compute_dual_recording_for_rider(
        db=db,
        user_doc_id="10001",
        zwift_activity_id="zwift-activity",
        event_start_iso=None,
        strava_activity_id=None,
    )

    cp_diff = result["comparison"]["cpDiff"]
    row_w15 = next(row for row in cp_diff if row["key"] == "w15")

    # Zwift is anchored at its own best 15s window (~300 W).
    assert row_w15["zwift"] == 300.0
    # Strava value must come from the SAME Zwift-selected 15s segment (~250 W),
    # not Strava's independent 15s best (~400 W).
    assert row_w15["strava"] == 250.0
    assert row_w15["diffW"] == 50.0

