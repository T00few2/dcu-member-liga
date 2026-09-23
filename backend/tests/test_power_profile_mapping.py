import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from routes.integration import _activity_count_in_range, _power_profile_to_firestore, _competition_metrics_to_profile


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


def test_competition_metrics_preserves_drop_level_when_achievements_missing():
    mapped = _competition_metrics_to_profile(
        {'ftp': 200},
        {'weight': 70},
        {'dropLevel': 112, 'achievementLevel': 11202},
    )
    assert mapped['dropLevel'] == 112
    assert mapped['achievementLevel'] == 11202
    assert mapped['ftp'] == 200


def test_competition_metrics_preserves_game_client():
    mapped = _competition_metrics_to_profile(
        {'ftp': 200},
        {'weight': 70},
        {
            'gameClientUserAgent': 'CNL (Windows 10)',
            'gameClientPlatform': 'windows',
            'canEnterUnlockCode': True,
        },
    )
    assert mapped['gameClientPlatform'] == 'windows'
    assert mapped['canEnterUnlockCode'] is True


def test_competition_metrics_keeps_male_and_does_not_invent_it():
    mapped = _competition_metrics_to_profile({'ftp': 200}, {'male': False}, None)
    assert mapped['male'] is False
    kept = _competition_metrics_to_profile({'ftp': 200}, {}, {'male': True})
    assert kept['male'] is True
    missing = _competition_metrics_to_profile({'ftp': 200}, {}, None)
    assert 'male' not in missing


def test_competition_metrics_reads_official_achievements():
    mapped = _competition_metrics_to_profile(
        {},
        {'achievements': {'achievementLevel': 42, 'totalExperiencePoints': 10}},
        {'dropLevel': 1},
    )
    assert mapped['dropLevel'] == 42
    assert mapped['totalExperiencePoints'] == 10
