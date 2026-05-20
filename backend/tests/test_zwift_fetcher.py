import os
import sys
from datetime import datetime, timezone

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


def test_filter_finish_entries_does_not_treat_first_sprint_as_finish_before_finish_crossing():
    fetcher = ZwiftFetcher(zwift_service=None)
    entries = [_entry("r1", "seg-sprint", 100, 1000)]

    filtered = fetcher._filter_finish_entries(
        entries=entries,
        route_segments=[
            {"id": "seg-sprint", "count": 1, "lap": 1, "direction": "forward"},
            {"id": "seg-finish", "count": 1, "lap": 1, "direction": "forward"},
        ],
        configured_sprints=[{"id": "seg-sprint", "count": 1, "lap": 1, "direction": "forward"}],
    )

    assert filtered == []


def test_filter_finish_entries_excludes_unconfigured_sprint_named_route_arches():
    fetcher = ZwiftFetcher(zwift_service=None)
    entries = [_entry("r1", "seg-acropolis", 100, 1000)]

    filtered = fetcher._filter_finish_entries(
        entries=entries,
        route_segments=[
            {"id": "seg-grade", "name": "The Grade", "count": 1, "lap": 1, "direction": "forward"},
            {"id": "seg-acropolis", "name": "Acropolis Sprint", "count": 1, "lap": 1, "direction": "forward"},
        ],
        configured_sprints=[{"id": "seg-mayan", "count": 1, "lap": 1, "direction": "forward"}],
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
