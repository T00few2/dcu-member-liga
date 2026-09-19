from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording.strava import _trim_strava_streams  # noqa: E402
from services.dual_recording.time_series import _mse_sync_offset  # noqa: E402


def _late_start_streams(late_sec: int = 1282, total_sec: int = 2000):
    """Zwift ride with a distinctive spike; Strava is the same ride starting late."""
    z_times = list(range(total_sec))
    z_watts = [120.0 + (i % 40) for i in range(total_sec)]
    for i in range(1500, 1530):
        z_watts[i] = 420.0
    s_times = list(range(total_sec - late_sec))
    s_watts = z_watts[late_sec:]
    return z_times, z_watts, s_times, s_watts, late_sec


def test_mse_without_clock_hint_misses_20min_late_start():
    z_times, z_watts, s_times, s_watts, late_sec = _late_start_streams()
    found = _mse_sync_offset(z_times, z_watts, s_times, s_watts, search_sec=600)
    assert found is not None
    assert found != late_sec
    assert abs(found) <= 600


def test_mse_with_clock_hint_finds_20min_late_start():
    z_times, z_watts, s_times, s_watts, late_sec = _late_start_streams()
    found = _mse_sync_offset(
        z_times, z_watts, s_times, s_watts, search_sec=600, hint_offset=late_sec,
    )
    assert found == late_sec


def test_trim_uses_clock_hint_so_late_start_is_not_early_stop():
    z_times, z_watts, s_times, s_watts, late_sec = _late_start_streams()
    trimmed, offset, method, ts_offset = _trim_strava_streams(
        s_times,
        s_watts,
        [90.0] * len(s_times),
        [150.0] * len(s_times),
        [50.0] * len(s_times),
        z_times,
        z_watts,
        "2026-09-17T16:57:08Z",
        "2026-09-17T17:18:30Z",
        1999,
    )
    assert ts_offset == 1282
    assert offset == late_sec
    assert method == "power_mse"
    assert trimmed["time"][0] == late_sec
    assert trimmed["time"][-1] <= 1999
