import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.results.zwift_fetcher import ZwiftFetcher


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
        sprint_segment_ids={sprint_seg, climb_seg},
        route_segment_ids_ordered=[],
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
    fetcher = ZwiftFetcher(zwift_service=None)
    subgroup_start = datetime(2026, 5, 13, 17, 0, 0, tzinfo=timezone.utc)
    entry = {
        "activityData": {"durationInMilliseconds": 2668000},  # 44:28
        "_officialSegmentResult": {"endDate": "2026-05-13T17:49:01Z"},
    }

    assert fetcher._resolve_finish_time_ms(entry, subgroup_start) == 2941000


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
        sprint_segment_ids={"seg-a"},
        route_segment_ids_ordered=["seg-a", "seg-a"],
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
            sprint_segment_ids={"seg-a"},
            route_segment_ids_ordered=[],
            route_segments=[],
            configured_sprints=[{"id": "seg-a", "count": 1, "lap": 1, "direction": "forward"}],
        )
    except RuntimeError as exc:
        assert "deterministically resolve finish segment" in str(exc)
    else:
        assert False, "Expected RuntimeError when deterministic route mapping is unavailable"
