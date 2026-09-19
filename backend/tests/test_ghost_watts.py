import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording.time_series import analyze_ghost_watts, analyze_sticky_watts


def _series(n: int, watts: float | int, cadence: float | int):
    times = list(range(n))
    w = [watts] * n
    c = [cadence] * n
    return times, w, c


def test_ghost_watts_clean_coast_to_zero_is_ok():
    times = list(range(80))
    watts = [200] * 60 + [0] * 20
    cadence = [90] * 60 + [0] * 20
    result = analyze_ghost_watts(times, watts, cadence)
    assert result["insufficientCadence"] is False
    assert result["suspicious"] is False
    assert result["ghostEvents"] == 0
    assert result["ghostSeconds"] == 0


def test_ghost_watts_flags_raised_floor_while_coasting():
    times = list(range(80))
    watts = [200] * 50 + [20] * 30
    cadence = [90] * 50 + [0] * 30
    result = analyze_ghost_watts(times, watts, cadence)
    assert result["insufficientCadence"] is False
    assert result["suspicious"] is True
    assert result["ghostEvents"] == 1
    assert result["ghostSeconds"] == 30
    assert result["medianGhostWatts"] == 20.0
    assert result["maxGhostWatts"] == 20


def test_ghost_watts_missing_cadence_is_not_suspicious():
    times, watts, _ = _series(60, 200, 90)
    result = analyze_ghost_watts(times, watts, [])
    assert result["insufficientCadence"] is True
    assert result["suspicious"] is False


def test_ghost_watts_all_zero_cadence_with_active_power_is_insufficient():
    times, watts, cadence = _series(60, 220, 0)
    result = analyze_ghost_watts(times, watts, cadence)
    assert result["insufficientCadence"] is True
    assert result["suspicious"] is False


def test_ghost_watts_excludes_sticky_plateau_from_floor():
    # 5s identical 250W hold (sticky) at cadence 0, then true 0W coast.
    times = list(range(80))
    watts = [200] * 40 + [250] * 5 + [0] * 35
    cadence = [90] * 40 + [0] * 40
    gw = analyze_ghost_watts(times, watts, cadence)
    sw = analyze_sticky_watts(times, watts)
    assert sw["suspicious"] is True
    assert sw["preZeroEvents"] >= 1
    assert gw["insufficientCadence"] is False
    assert gw["suspicious"] is False
    assert gw["medianGhostWatts"] == 0.0


def test_ghost_watts_short_blips_do_not_flag():
    times = list(range(70))
    watts = [200] * 60 + [20, 20, 0, 0, 20, 20, 0, 0, 20, 20]
    cadence = [90] * 60 + [0] * 10
    result = analyze_ghost_watts(times, watts, cadence)
    assert result["ghostEvents"] == 0
    assert result["suspicious"] is False


def test_sticky_watts_pre_zero_pattern_flags():
    times = list(range(40))
    watts = [180, 181, 179] + [250] * 4 + [8] + [0] * 4 + [190] * 5 + [250] * 4 + [5] + [180] * 13
    result = analyze_sticky_watts(times, watts)
    assert result["preZeroEvents"] >= 2
    assert result["suspicious"] is True


def test_sticky_watts_varying_power_is_ok():
    times = list(range(30))
    watts = [200 + (i % 7) for i in range(30)]
    result = analyze_sticky_watts(times, watts)
    assert result["suspicious"] is False
    assert result["preZeroEvents"] == 0
