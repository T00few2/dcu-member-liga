import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from routes.integration import _activity_count_in_range, _power_profile_to_firestore


def test_activity_count_from_nested_cp_best_efforts():
    source = {
        'cpBestEfforts': {
            'pointsWatts': {'60': {'value': 300}},
            'activityCountInRange': 14,
        }
    }
    assert _activity_count_in_range(source) == 14


def test_activity_count_from_top_level_snapshot():
    assert _activity_count_in_range({'activityCountInRange': 9}) == 9


def test_activity_count_missing_or_invalid():
    assert _activity_count_in_range(None) is None
    assert _activity_count_in_range({}) is None
    assert _activity_count_in_range({'cpBestEfforts': []}) is None
    assert _activity_count_in_range({'activityCountInRange': True}) is None


def test_power_profile_to_firestore_copies_activity_count():
    mapped = _power_profile_to_firestore({
        'zftp': 250,
        'cpBestEfforts': {'activityCountInRange': 22},
        'relevantCpEfforts': [],
    })
    assert mapped['activityCountInRange'] == 22
    assert mapped['zftp'] == 250
