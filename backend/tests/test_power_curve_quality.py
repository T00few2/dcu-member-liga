import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import pytest

from services.power_curve_quality import (
    clean_durations_above,
    corrected_watts,
    is_padded_effort,
    marginal_watts,
    points_watts,
)


def _curve(points: dict) -> dict:
    return {
        "cpBestEfforts": {
            "pointsWatts": {
                str(d): {"value": w, "date": "2026-08-07T12:03:26.747Z"}
                for d, w in points.items()
            }
        }
    }


# ---------------------------------------------------------------------------
# points_watts
# ---------------------------------------------------------------------------

def test_points_watts_flattens_duration_keys_to_ints():
    assert points_watts(_curve({1: 1873, 5: 1124, 1200: 286})) == {
        1: 1873.0, 5: 1124.0, 1200: 286.0
    }


def test_points_watts_returns_empty_for_shapes_it_cannot_read():
    assert points_watts(None) == {}
    assert points_watts({}) == {}
    # models.py types cpBestEfforts as a list; the documented shape is a dict.
    assert points_watts({"cpBestEfforts": []}) == {}
    assert points_watts({"cpBestEfforts": {"pointsWatts": None}}) == {}


def test_points_watts_skips_unusable_points():
    raw = {
        "cpBestEfforts": {
            "pointsWatts": {
                "5": {"value": 1124},
                "10": {"value": None},
                "15": "not-a-point",
                "notanumber": {"value": 300},
                "20": {"value": 0},
                "25": {"value": -5},
            }
        }
    }
    assert points_watts(raw) == {5: 1124.0}


# ---------------------------------------------------------------------------
# marginal_watts
# ---------------------------------------------------------------------------

def test_marginal_watts_is_the_power_added_by_extending_the_window():
    # 4s at 1000W = 4000J; 5s at 900W = 4500J. The fifth second carried 500W.
    assert marginal_watts({4: 1000, 5: 900}, 5) == 500.0


def test_marginal_watts_needs_a_shorter_point_to_compare_against():
    assert marginal_watts({5: 900}, 5) is None
    assert marginal_watts({5: 900, 15: 700}, 5) is None
    assert marginal_watts({}, 5) is None
    assert marginal_watts({5: 0}, 5) is None


# ---------------------------------------------------------------------------
# is_padded_effort
# ---------------------------------------------------------------------------

def test_detects_the_real_world_three_second_spike():
    # Verbatim from a production profile: three seconds pinned at exactly 1873W,
    # then nothing. Work is flat from 3s on, so 5s is a diluted artefact.
    points = points_watts(_curve({1: 1873, 2: 1873, 3: 1873, 4: 1405, 5: 1124}))

    assert marginal_watts(points, 5) < 1.0
    assert is_padded_effort(points, 5) is True


def test_accepts_a_real_sprint_that_decays_smoothly():
    points = points_watts(_curve({1: 1150, 2: 1120, 3: 1060, 4: 1000, 5: 940}))

    assert is_padded_effort(points, 5) is False


def test_accepts_an_effort_whose_final_second_merely_fades():
    # 4s at 1000W = 4000J, 5s at 940W = 4700J: the last second held 700W.
    assert is_padded_effort({4: 1000, 5: 940}, 5) is False


def test_cannot_judge_without_a_shorter_point_so_keeps_the_value():
    assert is_padded_effort({5: 1124}, 5) is False
    assert is_padded_effort({}, 5) is False


def test_threshold_is_tunable():
    # Fifth second at 300W against a 900W average: a quarter is 225W, so 300W
    # passes the default but fails a stricter ratio.
    points = {4: 1050, 5: 900}

    assert marginal_watts(points, 5) == 300.0
    assert is_padded_effort(points, 5) is False
    assert is_padded_effort(points, 5, min_marginal_ratio=0.5) is True


def test_flags_a_window_whose_extra_seconds_went_backwards():
    # Rounding can make work shrink slightly; that is still padding.
    assert is_padded_effort({4: 1405, 5: 1120}, 5) is True


def test_guard_generalises_to_other_durations():
    points = points_watts(_curve({10: 800, 15: 533}))

    # 10s at 800W = 8000J, 15s at 533W = 7995J: seconds 11-15 carried nothing.
    assert is_padded_effort(points, 15) is True


# ---------------------------------------------------------------------------
# corrected_watts
# ---------------------------------------------------------------------------

def test_rebuilds_the_real_world_spike_close_to_the_measured_value():
    # Rider 15690's stored curve. Strava independently measured 907.3W over the
    # same window from the raw streams, so the estimate should land near it.
    points = points_watts(_curve({
        1: 1873, 2: 1873, 3: 1873, 4: 1405, 5: 1124,
        10: 826, 15: 773, 20: 655, 25: 604, 30: 563,
    }))

    corrected = corrected_watts(points, 5)

    assert corrected == pytest.approx(925.2, abs=0.5)
    assert abs(corrected - 907.3) / 907.3 < 0.05


def test_correction_never_exceeds_the_reported_maximum():
    # Reported 5s is a max over every window, spike included, so the real effort
    # cannot be above it however steep the local slope looks.
    points = {5: 900, 10: 890, 15: 700}

    assert corrected_watts(points, 5) == 900.0


def test_correction_never_falls_below_the_next_clean_effort():
    # The best 10s window contains a 5s window at least as hard.
    points = {5: 1124, 10: 826, 15: 830}

    assert corrected_watts(points, 5) == 826.0


def test_correction_uses_only_the_two_nearest_clean_points():
    # The aerobic tail is far steeper; including it would oversteepen the slope
    # and push the 5s estimate up against the reported ceiling.
    near = {5: 1124, 10: 826, 15: 773}
    with_tail = {**near, 1200: 286, 2400: 273}

    assert corrected_watts(near, 5) == pytest.approx(corrected_watts(with_tail, 5))


def test_correction_falls_back_to_the_floor_with_a_single_clean_anchor():
    assert corrected_watts({5: 1124, 10: 826}, 5) == 826.0


def test_correction_falls_back_to_the_floor_on_a_non_decaying_curve():
    # p1 <= p2 gives a non-positive exponent; the floor still holds.
    points = {5: 1124, 10: 800, 15: 820}

    assert corrected_watts(points, 5) == 800.0


def test_correction_returns_none_without_a_clean_anchor():
    assert corrected_watts({4: 1405, 5: 1124}, 5) is None
    assert corrected_watts({}, 5) is None
    assert corrected_watts({5: 0, 10: 800}, 5) is None


def test_clean_durations_above_skips_padded_neighbours():
    points = points_watts(_curve({5: 1124, 10: 800, 15: 533, 20: 500}))

    # 15s is itself padded (10s at 800W = 8000J, 15s at 533W = 7995J).
    assert clean_durations_above(points, 5) == [10, 20]
