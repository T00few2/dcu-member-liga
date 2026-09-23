import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.results.zwift_fetcher import ZwiftFetcher
from services.results.finish_time import resolve_finish_time_ms


def _entry(rider_id: str, segment_id: str, end_world_time: int, duration_ms: int) -> dict:
    return {
        "profileData": {"id": rider_id},
        "activityData": {"durationInMilliseconds": duration_ms},
        "_officialSegmentResult": {
            "segmentId": segment_id,
            "endWorldTime": end_world_time,
            "endDate": "2026-05-06T17:00:00Z",
        },
    }


def _official_payload(user_id: str, duration_ms: int, activity_id: str = "act-1") -> dict:
    return {
        "entries": [
            {
                "userId": user_id,
                "activityData": {
                    "activityId": activity_id,
                    "durationInMilliseconds": duration_ms,
                },
                "criticalP": {},
            }
        ],
        "totalEntryCount": 1,
    }


def test_resolve_finish_time_prefers_end_date_delta_over_segment_duration():
    subgroup_start = datetime(2026, 5, 13, 17, 0, 0, tzinfo=timezone.utc)
    entry = {
        "activityData": {"durationInMilliseconds": 2668000},  # 44:28
        "_officialSegmentResult": {"endDate": "2026-05-13T17:49:01Z"},
    }

    assert resolve_finish_time_ms(entry, subgroup_start) == 2941000


def test_fetch_segment_efforts_uses_prefetched_crossings():
    fetcher = ZwiftFetcher(zwift_service=None)
    entries = [
        {
            "profileData": {"id": "uuid-r1"},
            "activityData": {"durationInMilliseconds": 9999},
            "_officialSegmentResult": {
                "segmentId": "seg-a",
                "userId": "uuid-r1",
                "durationInMilliseconds": 12345,
                "endWorldTime": 444,
                "avgWatts": 321,
            },
        },
        {
            "profileData": {"id": "uuid-r1"},
            "activityData": {"durationInMilliseconds": 8888},
            "_officialSegmentResult": {
                "segmentId": "seg-b",
                "userId": "uuid-r1",
                "durationInMilliseconds": 54321,
                "endWorldTime": 555,
                "avgWatts": 222,
            },
        },
    ]

    efforts = fetcher.fetch_segment_efforts(
        segment_ids={"seg-a"},
        start_time=datetime(2026, 5, 13, 17, 0, 0, tzinfo=timezone.utc),
        end_time=datetime(2026, 5, 13, 20, 0, 0, tzinfo=timezone.utc),
        subgroup_id="sub-1",
        registered_riders={"uuid-r1": {"zwiftId": "182972"}},
        all_results_raw=entries,
    )

    assert set(efforts.keys()) == {"seg-a"}
    assert efforts["seg-a"] == [{
        "athleteId": "182972",
        "elapsed": 12345,
        "worldTime": 444,
        "avgPower": 321,
    }]


def test_last_race_lap_banner_is_final_champs_instance():
    from services.results.finish_selector import last_race_lap_banner

    route_segments = [
        {"id": "1056322864", "lap": 1, "count": 1, "name": "Champs-Élysées"},
        {"id": "1056322864", "lap": 2, "count": 2, "name": "Champs-Élysées"},
        {"id": "1055881124", "lap": 3, "count": 3, "name": "Montmartre KOM"},
        {"id": "-9223372035804541048", "lap": 3, "count": 3, "name": "Tchou Tchou Sprint"},
        {"id": "1056322864", "lap": 3, "count": 3, "name": "Champs-Élysées"},
    ]
    assert last_race_lap_banner(route_segments) == ("1056322864", 3)


def test_finish_banner_instance_missing_when_earlier_fal_crossings_exist():
    from services.results.finish_selector import (
        finish_banner_instance_missing,
        last_race_lap_banner,
    )

    route_segments = [
        {"id": "champs", "lap": 1, "count": 1},
        {"id": "champs", "lap": 2, "count": 2},
        {"id": "tchou", "lap": 3, "count": 3},
        {"id": "champs", "lap": 3, "count": 3},
    ]
    crossings = [
        _entry("uuid-daniel", "champs", 100, 1000),
        _entry("uuid-daniel", "champs", 200, 2000),
        _entry("uuid-daniel", "tchou", 180, 1800),
    ]
    intended = last_race_lap_banner(route_segments)
    assert intended == ("champs", 3)
    assert finish_banner_instance_missing(intended, crossings) is True


def test_fetch_finishers_uses_official_race_results():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = _official_payload(
        "uuid-daniel", 4450000
    )
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {
            "zwiftId": "661768",
            "name": "Daniel lyhne",
            "club": "Danish Zwift Racers",
        },
    }

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        all_results_raw=[_entry("uuid-daniel", "tchou", 100, 3661000)],
    )

    assert len(finishers) == 1
    assert finishers[0]["zwiftId"] == "661768"
    assert finishers[0]["finishTime"] == 4450000
    assert finishers[0]["activityId"] == "act-1"
    assert finishers[0]["club"] == "Danish Zwift Racers"
    zwift.get_subgroup_race_results.assert_called_once_with("7340599")
    zwift.get_event_results.assert_not_called()


def test_fetch_finishers_ignores_segment_crossings_when_official_times_exist():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = _official_payload(
        "uuid-daniel", 4237154
    )
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }
    crossings = [
        _entry("uuid-daniel", "lutece", 100, 1000),
        _entry("uuid-daniel", "tchou", 180, 3663792),
        _entry("uuid-daniel", "1056322864", 300, 3661000),
    ]

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        all_results_raw=crossings,
    )

    assert len(finishers) == 1
    assert finishers[0]["finishTime"] == 4237154
    zwift.get_event_results.assert_not_called()


def test_fetch_finishers_returns_empty_when_official_unavailable():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.side_effect = RuntimeError("race-results down")
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        all_results_raw=[
            _entry("uuid-daniel", "champs", 300, 3661000),
        ],
    )

    assert finishers == []
    zwift.get_event_results.assert_not_called()


def test_fetch_finishers_returns_empty_when_official_has_no_entries():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = {
        "entries": [],
        "totalEntryCount": 0,
    }
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        all_results_raw=[
            _entry("uuid-daniel", "tchou", 180, 3663792),
        ],
    )

    assert finishers == []
    zwift.get_event_results.assert_not_called()
