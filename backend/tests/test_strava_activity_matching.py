from __future__ import annotations

import os
import sys
from datetime import timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording import strava as strava_match
from services.dual_recording.time_series import _parse_event_start_iso


ZWIFT_START = "2026-09-17T16:57:08Z"
ZWIFT_DURATION = 4849
EVENT_START_NAIVE = "2026-09-17T19:00"


def _act(activity_id, name, start, duration, sport="Ride"):
    return {
        "id": activity_id,
        "name": name,
        "startDate": start,
        "durationSec": duration,
        "sport": sport,
        "averageWatts": 200,
    }


def _times_watts(n=180):
    times = list(range(n))
    watts = [180.0 + (i % 20) for i in times]
    return times, watts


def _patch_activities(monkeypatch, activities, scores):
    monkeypatch.setattr(
        strava_match.strava_service,
        "get_activities_for_matching",
        lambda *_args, **_kwargs: activities,
    )

    def _fake_score(*, activity, **_kwargs):
        return scores.get(str(activity.get("id")))

    monkeypatch.setattr(strava_match, "_compute_similarity_score_for_activity", _fake_score)


def _match(zwift_started_at=ZWIFT_START, event_start_iso=EVENT_START_NAIVE):
    times, watts = _times_watts()
    return strava_match._match_strava_activity(
        "rider-1",
        None,
        zwift_started_at,
        ZWIFT_DURATION,
        times,
        watts,
        event_start_iso,
    )


def test_naive_event_start_is_copenhagen_not_utc():
    dt = _parse_event_start_iso("2026-09-17T19:00")
    assert dt is not None
    assert dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-09-17T17:00:00Z"


def test_zulu_event_start_stays_utc():
    dt = _parse_event_start_iso("2026-09-17T17:00:10Z")
    assert dt is not None
    assert dt.strftime("%Y-%m-%dT%H:%M:%SZ") == "2026-09-17T17:00:10Z"


def test_picks_dual_recording_not_outdoor_or_zwift_export(monkeypatch):
    """Morten-style: outdoor + dual + Zwift upload overlapping the same evening."""
    outdoor = _act(1, "Cykeltur om aftenen", "2026-09-17T16:46:19Z", 6753)
    dual = _act(2, "Cykeltur om aftenen", "2026-09-17T17:01:44Z", 4876)
    export = _act(3, "Zwift - Race: 3. Division", "2026-09-17T17:02:19Z", 4856)
    _patch_activities(
        monkeypatch,
        [outdoor, dual, export],
        {"1": 0.231174, "2": 0.974309, "3": 1.0},
    )

    matched, chosen_id, debug = _match()
    assert chosen_id == "2"
    assert matched["name"] == "Cykeltur om aftenen"
    assert debug["selectionReason"] == "lowest_similarity"
    by_id = {c["activityId"]: c for c in debug["candidates"]}
    assert by_id["1"]["belowSimilarityFloor"] is True
    assert by_id["3"]["excludedAsExport"] is True
    assert by_id["2"]["selected"] is True


def test_lowest_similarity_still_prefers_dual_over_zwift_upload(monkeypatch):
    dual = _act(10, "DCU e-serie løb 1 - Dual recording", "2026-09-17T16:59:18Z", 4400)
    export = _act(11, "Zwift - Race: 1. Division", "2026-09-17T17:00:10Z", 4401)
    _patch_activities(monkeypatch, [dual, export], {"10": 0.86, "11": 1.0})

    matched, chosen_id, debug = strava_match._match_strava_activity(
        "rider-1",
        None,
        "2026-09-17T17:00:10Z",
        4400,
        *_times_watts(),
        "2026-09-17T19:00",
    )
    assert chosen_id == "10"
    assert debug["selectionReason"] == "lowest_similarity"
    assert matched["name"].startswith("DCU e-serie")


def test_ignores_later_outdoor_ride_when_event_start_is_naive_local(monkeypatch):
    """Emil-style: evening outdoor ride overlaps a UTC-misread 19:00, not the race."""
    dual = _act(20, "Cykeltur om aftenen", "2026-09-17T16:59:18Z", 4400)
    later_outdoor = _act(21, "Cykeltur om aftenen", "2026-09-17T18:20:09Z", 4455)
    export = _act(22, "Zwift - Race: 1. Division", "2026-09-17T17:00:10Z", 4401)
    _patch_activities(
        monkeypatch,
        [dual, later_outdoor, export],
        {"20": 0.88, "21": 0.05, "22": 1.0},
    )

    _matched, chosen_id, debug = strava_match._match_strava_activity(
        "rider-1",
        None,
        "2026-09-17T17:00:10Z",
        4400,
        *_times_watts(),
        "2026-09-17T19:00",
    )
    assert chosen_id == "20"
    assert debug["anchorUsed"] == "zwift_start"
    later = next(c for c in debug["candidates"] if c["activityId"] == "21")
    assert later["meaningful"] is False


def test_does_not_select_unrelated_ride_as_only_overlap(monkeypatch):
    outdoor = _act(30, "Cykeltur om aftenen", "2026-09-17T18:20:09Z", 4455)
    _patch_activities(monkeypatch, [outdoor], {"30": 0.05})

    matched, chosen_id, debug = strava_match._match_strava_activity(
        "rider-1",
        None,
        "2026-09-17T18:20:09Z",
        4400,
        *_times_watts(),
        None,
    )
    assert matched is None
    assert chosen_id is None
    assert debug["selectionReason"] == "no_similar_candidate"
