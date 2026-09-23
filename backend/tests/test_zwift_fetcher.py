import os
import sys
from datetime import datetime, timezone
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.results.zwift_fetcher import ZwiftFetcher
from services.results.errors import FinishSegmentResolutionError
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


def test_filter_finish_entries_all_sprints_uses_last_route_crossing_instance():
    fetcher = ZwiftFetcher(zwift_service=None)
    sprint_seg = "sprint-seg"
    climb_seg = "climb-seg"

    entries = [
        _entry("r1", sprint_seg, 100, 1000),
        _entry("r1", sprint_seg, 200, 2000),
        _entry("r1", climb_seg, 250, 2000),
        _entry("r2", sprint_seg, 110, 1100),
        _entry("r2", sprint_seg, 210, 2100),
        _entry("r2", climb_seg, 260, 2100),
    ]

    filtered = fetcher._filter_finish_entries(
        entries=entries,
        route_segments=[
            {"id": sprint_seg, "count": 1, "lap": 1, "direction": "forward"},
            {"id": sprint_seg, "count": 2, "lap": 1, "direction": "forward"},
            {"id": climb_seg, "count": 1, "lap": 1, "direction": "forward"},
        ],
        configured_sprints=[
            {"id": sprint_seg, "count": 1, "lap": 1, "direction": "forward"},
            {"id": sprint_seg, "count": 2, "lap": 1, "direction": "forward"},
            {"id": climb_seg, "count": 1, "lap": 1, "direction": "forward"},
        ],
    )
    selected_ids = {str((e.get("profileData") or {}).get("id")) for e in filtered}

    assert selected_ids == {"r1", "r2"}
    assert {e["_officialSegmentResult"]["endWorldTime"] for e in filtered} == {250, 260}


def test_filter_finish_entries_uses_last_banner_even_when_it_is_a_configured_sprint():
    """Finish must not jump earlier past later selected sprints."""
    fetcher = ZwiftFetcher(zwift_service=None)
    early = "early-unticked"
    late_sprint = "late-sprint"

    entries = [
        _entry("r1", early, 100, 1000),
        _entry("r1", late_sprint, 200, 2000),
        _entry("r2", early, 110, 1100),
        _entry("r2", late_sprint, 210, 2100),
    ]

    filtered = fetcher._filter_finish_entries(
        entries=entries,
        route_segments=[
            {"id": early, "count": 1, "lap": 1, "direction": "forward"},
            {"id": late_sprint, "count": 1, "lap": 1, "direction": "forward"},
        ],
        configured_sprints=[
            {"id": late_sprint, "count": 1, "lap": 1, "direction": "forward"},
        ],
    )

    selected = {
        str((e.get("profileData") or {}).get("id")): int(
            (e.get("_officialSegmentResult") or {}).get("endWorldTime", 0)
        )
        for e in filtered
    }
    assert selected == {"r1": 200, "r2": 210}



def test_resolve_finish_time_prefers_end_date_delta_over_segment_duration():
    subgroup_start = datetime(2026, 5, 13, 17, 0, 0, tzinfo=timezone.utc)
    entry = {
        "activityData": {"durationInMilliseconds": 2668000},  # 44:28
        "_officialSegmentResult": {"endDate": "2026-05-13T17:49:01Z"},
    }

    assert resolve_finish_time_ms(entry, subgroup_start) == 2941000


def test_filter_finish_entries_uses_route_instances_over_id_guessing():
    fetcher = ZwiftFetcher(zwift_service=None)
    entries = [
        _entry("simon", "seg-a", 100, 1000),
        _entry("simon", "seg-a", 200, 2000),
        _entry("nikolaj", "seg-a", 110, 1100),
        _entry("nikolaj", "seg-a", 210, 2100),
    ]

    filtered = fetcher._filter_finish_entries(
        entries=entries,
        route_segments=[
            {"id": "seg-a", "count": 1, "lap": 1, "direction": "forward"},
            {"id": "seg-a", "count": 2, "lap": 1, "direction": "forward"},
        ],
        configured_sprints=[{"id": "seg-a", "count": 1, "direction": "forward"}],
    )

    selected = {
        str((e.get("profileData") or {}).get("id")): int(
            (e.get("_officialSegmentResult") or {}).get("endWorldTime", 0)
        )
        for e in filtered
    }
    assert selected == {"simon": 200, "nikolaj": 210}


def test_filter_finish_entries_raises_when_route_instances_missing():
    fetcher = ZwiftFetcher(zwift_service=None)
    entries = [_entry("r1", "seg-a", 100, 1000)]

    try:
        fetcher._filter_finish_entries(
            entries=entries,
            route_segments=[],
            configured_sprints=[{"id": "seg-a", "count": 1, "lap": 1, "direction": "forward"}],
        )
    except FinishSegmentResolutionError as exc:
        assert "deterministically resolve finish segment" in str(exc)
    else:
        assert False, "Expected FinishSegmentResolutionError when deterministic route mapping is unavailable"


def test_filter_finish_entries_returns_empty_when_finish_is_resolved_but_no_crossings_yet():
    fetcher = ZwiftFetcher(zwift_service=None)
    entries = [_entry("r1", "seg-a", 100, 1000)]

    filtered = fetcher._filter_finish_entries(
        entries=entries,
        route_segments=[
            {"id": "seg-a", "count": 1, "lap": 1, "direction": "forward"},
            {"id": "seg-a", "count": 2, "lap": 1, "direction": "forward"},
        ],
        configured_sprints=[{"id": "seg-a", "count": 1, "lap": 1, "direction": "forward"}],
    )

    assert filtered == []


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


def test_fetch_finishers_uses_official_times_when_finish_banner_missing():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = {
        "entries": [
            {
                "userId": "uuid-daniel",
                "activityData": {
                    "activityId": "act-1",
                    "durationInMilliseconds": 4450000,
                },
                "criticalP": {},
            }
        ],
        "totalEntryCount": 1,
    }
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne", "club": "Danish Zwift Racers"},
    }
    route_segments = [
        {"id": "tchou", "lap": 3, "count": 3},
        {"id": "champs", "lap": 3, "count": 3},
    ]
    crossings = [
        _entry("uuid-daniel", "tchou", 100, 1000),
    ]

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        route_segments=route_segments,
        all_results_raw=crossings,
    )

    assert len(finishers) == 1
    assert finishers[0]["zwiftId"] == "661768"
    assert finishers[0]["finishTime"] == 4450000
    assert finishers[0]["activityId"] == "act-1"
    assert finishers[0]["club"] == "Danish Zwift Racers"
    zwift.get_subgroup_race_results.assert_called_once_with("7340599")


def test_fetch_finishers_uses_official_times_when_last_champs_instance_missing():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = {
        "entries": [
            {
                "userId": "uuid-daniel",
                "activityData": {
                    "activityId": "act-1",
                    "durationInMilliseconds": 4450000,
                },
                "criticalP": {},
            }
        ],
        "totalEntryCount": 1,
    }
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }
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

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        route_segments=route_segments,
        all_results_raw=crossings,
    )

    assert len(finishers) == 1
    assert finishers[0]["finishTime"] == 4450000
    zwift.get_subgroup_race_results.assert_called_once_with("7340599")


def test_fetch_finishers_uses_official_times_even_when_last_champs_instance_present():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = {
        "entries": [
            {
                "userId": "uuid-daniel",
                "activityData": {
                    "activityId": "act-1",
                    "durationInMilliseconds": 4237154,
                },
                "criticalP": {},
            }
        ],
        "totalEntryCount": 1,
    }
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }
    route_segments = [
        {"id": "champs", "lap": 1, "count": 1},
        {"id": "champs", "lap": 2, "count": 2},
        {"id": "champs", "lap": 3, "count": 3},
    ]
    crossings = [
        _entry("uuid-daniel", "champs", 100, 1000),
        _entry("uuid-daniel", "champs", 200, 2000),
        _entry("uuid-daniel", "champs", 300, 3661000),
    ]

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        route_segments=route_segments,
        all_results_raw=crossings,
    )

    assert len(finishers) == 1
    assert finishers[0]["finishTime"] == 4237154
    zwift.get_subgroup_race_results.assert_called_once_with("7340599")


def test_fetch_finishers_falls_back_to_segment_times_when_official_unavailable():
    zwift = MagicMock()
    zwift.get_subgroup_race_results.side_effect = RuntimeError("race-results down")
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }
    route_segments = [
        {"id": "champs", "lap": 1, "count": 1},
        {"id": "champs", "lap": 2, "count": 2},
        {"id": "champs", "lap": 3, "count": 3},
    ]
    crossings = [
        _entry("uuid-daniel", "champs", 100, 1000),
        _entry("uuid-daniel", "champs", 200, 2000),
        _entry("uuid-daniel", "champs", 300, 3661000),
    ]

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        route_segments=route_segments,
        all_results_raw=crossings,
    )

    assert len(finishers) == 1
    assert finishers[0]["finishTime"] == 3661000


def test_fetch_finishers_does_not_treat_last_sprint_as_finish_when_banner_listed():
    """La Boucle after picker filter: last sprint is Tchou Tchou, finish is Champs."""
    zwift = MagicMock()
    zwift.get_subgroup_race_results.return_value = {
        "entries": [
            {
                "userId": "uuid-daniel",
                "activityData": {
                    "activityId": "act-1",
                    "durationInMilliseconds": 4237154,
                },
                "criticalP": {},
            }
        ],
        "totalEntryCount": 1,
    }
    fetcher = ZwiftFetcher(zwift_service=zwift)
    registered = {
        "uuid-daniel": {"zwiftId": "661768", "name": "Daniel lyhne"},
    }
    route_segments = [
        {"id": "lutece", "lap": 3, "count": 3},
        {"id": "tchou", "lap": 3, "count": 3},
        {"id": "1056322864", "lap": 3, "count": 3, "name": "Champs-Élysées"},
    ]
    crossings = [
        _entry("uuid-daniel", "lutece", 100, 1000),
        _entry("uuid-daniel", "tchou", 180, 3663792),
    ]

    finishers = fetcher.fetch_finishers(
        subgroup_id="7340599",
        event_secret="",
        fetch_mode="finishers",
        registered_riders=registered,
        route_segments=route_segments,
        all_results_raw=crossings,
    )

    assert len(finishers) == 1
    assert finishers[0]["finishTime"] == 4237154
    zwift.get_subgroup_race_results.assert_called_once_with("7340599")
