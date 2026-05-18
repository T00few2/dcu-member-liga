import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.results.critical_power import resolve_critical_power


def test_resolve_critical_power_from_points_watts_payload():
    payload = {
        "pointsWatts": {
            "15": {"value": 820},
            "60": {"value": 500},
            "300": {"value": 360},
            "1200": {"value": 310},
        }
    }

    result = resolve_critical_power(payload)

    assert result == {
        "criticalP15Seconds": 820,
        "criticalP1Minute": 500,
        "criticalP5Minutes": 360,
        "criticalP20Minutes": 310,
    }


def test_resolve_critical_power_from_relevant_cp_efforts():
    payload = {
        "relevantCpEfforts": [
            {"duration": 15, "watts": 810},
            {"duration": 60, "watts": 490},
            {"duration": 300, "watts": 355},
            {"duration": 1200, "watts": 300},
        ]
    }

    result = resolve_critical_power(payload)

    assert result == {
        "criticalP15Seconds": 810,
        "criticalP1Minute": 490,
        "criticalP5Minutes": 355,
        "criticalP20Minutes": 300,
    }


def test_resolve_critical_power_requires_all_required_durations():
    payload = {
        "pointsWatts": {
            "15": {"value": 800},
            "60": {"value": 480},
            "300": {"value": 350},
        }
    }

    assert resolve_critical_power(payload) == {}
