import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.zwiftracing import floor_max30_with_current, zwift_racing_fields_from_payload


def test_floor_max30_uses_current_when_zr_max30_is_zero():
    assert floor_max30_with_current(2137, 0) == 2137


def test_floor_max30_keeps_higher_zr_max30():
    assert floor_max30_with_current(2137, 2200) == 2200


def test_floor_max30_uses_current_when_max30_missing():
    assert floor_max30_with_current(2137, "N/A") == 2137
    assert floor_max30_with_current(2137.4, None) == 2137.4


def test_floor_max30_leaves_max30_when_current_missing():
    assert floor_max30_with_current("N/A", 0) == 0
    assert floor_max30_with_current(None, 2200) == 2200


def test_zwift_racing_fields_floor_max30_from_payload():
    fields = zwift_racing_fields_from_payload({
        "race": {
            "current": {"rating": 2137},
            "max30": {"rating": 0},
            "max90": {"rating": 2142},
        },
        "phenotype": {"value": "Puncheur"},
    })
    assert fields["currentRating"] == 2137
    assert fields["max30Rating"] == 2137
    assert fields["max90Rating"] == 2142
    assert fields["phenotype"] == "Puncheur"


def test_zwift_racing_fields_unwrap_data_wrapper():
    fields = zwift_racing_fields_from_payload({
        "data": {
            "race": {
                "current": {"rating": 1800},
                "max30": {"rating": 1900},
                "max90": {"rating": 1910},
            },
            "phenotype": {"value": "Sprinter"},
        }
    })
    assert fields["currentRating"] == 1800
    assert fields["max30Rating"] == 1900
    assert fields["max90Rating"] == 1910
    assert fields["phenotype"] == "Sprinter"
