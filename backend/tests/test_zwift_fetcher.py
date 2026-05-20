import os
import sys
from datetime import datetime, timedelta, timezone

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


def test_resolve_finish_time_prefers_world_time_delta_over_end_date_and_segment_duration():
    subgroup_start = datetime(2026, 5, 13, 17, 0, 0, tzinfo=timezone.utc)
    finish_dt = subgroup_start + timedelta(minutes=49, seconds=1)
    entry = {
        "activityData": {"durationInMilliseconds": 2668000},  # 44:28
        "_officialSegmentResult": {
            "endWorldTime": int(finish_dt.timestamp()),
            "endDate": "2026-05-13T17:48:00Z",
        },
    }

    assert resolve_finish_time_ms(entry, subgroup_start) == 2941000


def test_resolve_finish_time_supports_world_time_in_milliseconds():
    subgroup_start = datetime(2026, 5, 13, 17, 0, 0, tzinfo=timezone.utc)
    finish_dt = subgroup_start + timedelta(minutes=49, seconds=1)
    entry = {
        "activityData": {"durationInMilliseconds": 2668000},  # 44:28
        "_officialSegmentResult": {
            "endWorldTime": int(finish_dt.timestamp() * 1000),
        },
    }

    assert resolve_finish_time_ms(entry, subgroup_start) == 2941000


def test_resolve_finish_time_parses_end_date_with_numeric_timezone_without_ms():
    subgroup_start = datetime(2026, 5, 20, 17, 0, 0, tzinfo=timezone.utc)
    entry = {
        "activityData": {"durationInMilliseconds": 278579},
        "_officialSegmentResult": {
            # World time may not align with Unix epoch; should then fall back to endDate.
            "endWorldTime": 365281266848,
            "endDate": "2026-05-20T17:55:33+0000",
        },
    }

    assert resolve_finish_time_ms(entry, subgroup_start) == 3333000


def test_resolve_finish_time_never_falls_back_to_segment_duration():
    subgroup_start = datetime(2026, 5, 20, 17, 0, 0, tzinfo=timezone.utc)
    entry = {
        "activityData": {"durationInMilliseconds": 278579},
        "_officialSegmentResult": {
            "endWorldTime": 0,
            "endDate": "",
        },
    }

    assert resolve_finish_time_ms(entry, subgroup_start) == 0


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
