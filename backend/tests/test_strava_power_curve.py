import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

import services.strava as strava_module
from services.dual_recording.time_series import (
    _compute_best_efforts,
    _resample_power_to_1hz,
    _resample_to_1hz,
)


# ---------------------------------------------------------------------------
# Resampling
# ---------------------------------------------------------------------------

def test_resample_power_matches_dense_1hz_stream():
    times = list(range(10))
    watts = [100, 110, 120, 130, 140, 150, 160, 170, 180, 190]

    assert _resample_power_to_1hz(times, watts) == [float(w) for w in watts]


def test_resample_power_interpolates_short_gaps():
    # Sample every 3s — smart recording while still riding.
    times = [0, 3, 6]
    watts = [100, 200, 200]

    assert _resample_power_to_1hz(times, watts) == pytest.approx(
        [100.0, 133.0 + 1 / 3, 166.0 + 2 / 3, 200.0, 200.0, 200.0, 200.0]
    )


def test_resample_power_zero_fills_a_stop_instead_of_inventing_watts():
    # 300s of riding, a 600s traffic-light stop the device did not record, then more riding.
    times = list(range(0, 300)) + [900, 901, 902]
    watts = [250] * 300 + [250, 250, 250]

    w_1hz = _resample_power_to_1hz(times, watts)

    assert len(w_1hz) == 903
    assert w_1hz[299] == 250.0
    # The unrecorded stop contributes nothing.
    assert all(v == 0.0 for v in w_1hz[300:900])
    assert w_1hz[900] == 250.0


def test_stop_does_not_inflate_a_20_minute_best_effort():
    # 15 min at 300W, an unrecorded 15 min stop, then 15 min at 300W.
    times = list(range(0, 900)) + list(range(1800, 2700))
    watts = [300] * 1800

    interpolated = _compute_best_efforts(_resample_to_1hz(times, watts), durations=(1200,))
    gap_aware = _compute_best_efforts(_resample_power_to_1hz(times, watts), durations=(1200,))

    # The old resampler reads the stop as 20 minutes of steady 300W.
    assert interpolated["w1200"] == 300.0
    # Only 900s of the 1200s window can carry power.
    assert gap_aware["w1200"] == 225.0


def test_resamplers_treat_null_samples_as_zero():
    times = [0, 1, 2, 3]
    watts = [200, None, 200, 200]

    assert _resample_power_to_1hz(times, watts) == [200.0, 0.0, 200.0, 200.0]
    assert _resample_to_1hz(times, watts) == [200.0, 0.0, 200.0, 200.0]


def test_resample_power_handles_empty_and_mismatched_streams():
    assert _resample_power_to_1hz([], []) == []
    assert _resample_power_to_1hz([0, 1, 2], [100]) == [100.0]


# ---------------------------------------------------------------------------
# Activity listing
# ---------------------------------------------------------------------------

class _FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        return self._payload


def _activity(index, days_ago, device_watts=True, sport='VirtualRide'):
    start = datetime.now(timezone.utc) - timedelta(days=days_ago)
    return {
        'id': index,
        'name': f'Activity {index}',
        'start_date': start.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'device_watts': device_watts,
        'sport_type': sport,
    }


def _service_with_activities(monkeypatch, pages):
    """Return (service, calls) wired to serve `pages` in order from requests.get."""
    service = strava_module.StravaService(db=None)
    monkeypatch.setattr(service, '_get_valid_token', lambda rider_id: 'token')

    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append(params or {})
        payload = pages[len(calls) - 1] if len(calls) <= len(pages) else []
        return _FakeResponse(payload)

    monkeypatch.setattr(strava_module.requests, 'get', fake_get)
    return service, calls


def test_get_power_activities_keeps_the_most_recent_rides(monkeypatch):
    # 60 rides spread over the window, newest first as Strava returns them.
    page = [_activity(i, days_ago=i + 1) for i in range(60)]
    service, calls = _service_with_activities(monkeypatch, [page])

    after_ts = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp())
    result = service.get_power_activities('rider', after_ts, max_activities=50)

    assert len(result) == 50
    # Newest 50, not the oldest 50 an `after`-ordered page would have returned.
    assert [a['id'] for a in result] == list(range(50))
    # `after` is never sent, so Strava keeps its newest-first ordering.
    assert 'after' not in calls[0]
    assert calls[0]['per_page'] == 200


def test_get_power_activities_excludes_rides_without_a_power_meter(monkeypatch):
    page = [
        _activity(1, days_ago=1, device_watts=True),
        _activity(2, days_ago=2, device_watts=False, sport='Run'),
        _activity(3, days_ago=3, device_watts=True),
    ]
    service, _ = _service_with_activities(monkeypatch, [page])

    after_ts = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp())
    result = service.get_power_activities('rider', after_ts)

    assert [a['id'] for a in result] == [1, 3]


def test_get_power_activities_does_not_count_non_power_activities_against_the_cap(monkeypatch):
    page = [_activity(i, days_ago=i + 1, device_watts=(i % 2 == 0)) for i in range(20)]
    service, _ = _service_with_activities(monkeypatch, [page])

    after_ts = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp())
    result = service.get_power_activities('rider', after_ts, max_activities=10)

    assert len(result) == 10
    assert all(a['id'] % 2 == 0 for a in result)


def test_get_power_activities_stops_at_the_window_start(monkeypatch):
    page = [_activity(1, days_ago=10), _activity(2, days_ago=200)]
    service, calls = _service_with_activities(monkeypatch, [page])

    after_ts = int((datetime.now(timezone.utc) - timedelta(days=90)).timestamp())
    result = service.get_power_activities('rider', after_ts)

    assert [a['id'] for a in result] == [1]
    assert len(calls) == 1


def test_get_power_activities_pages_back_with_a_before_cursor(monkeypatch):
    first = [_activity(i, days_ago=i + 1) for i in range(200)]
    second = [_activity(200, days_ago=201)]
    service, calls = _service_with_activities(monkeypatch, [first, second])

    after_ts = int((datetime.now(timezone.utc) - timedelta(days=365)).timestamp())
    result = service.get_power_activities('rider', after_ts, max_activities=250)

    assert len(calls) == 2
    assert 'before' not in calls[0]
    assert calls[1]['before'] == min(
        int(datetime.strptime(a['start_date'], '%Y-%m-%dT%H:%M:%SZ')
            .replace(tzinfo=timezone.utc).timestamp())
        for a in first
    )
    assert len(result) == 201


def test_get_power_activities_returns_empty_without_a_token(monkeypatch):
    service = strava_module.StravaService(db=None)
    monkeypatch.setattr(service, '_get_valid_token', lambda rider_id: None)

    assert service.get_power_activities('rider', 0) == []


def test_get_power_activities_returns_what_it_has_on_a_failed_page(monkeypatch):
    service = strava_module.StravaService(db=None)
    monkeypatch.setattr(service, '_get_valid_token', lambda rider_id: 'token')

    calls = []

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append(params or {})
        if len(calls) == 1:
            return _FakeResponse([_activity(i, days_ago=i + 1) for i in range(200)])
        return _FakeResponse({'message': 'Rate Limit Exceeded'}, status_code=429)

    monkeypatch.setattr(strava_module.requests, 'get', fake_get)

    after_ts = int((datetime.now(timezone.utc) - timedelta(days=365)).timestamp())
    result = service.get_power_activities('rider', after_ts, max_activities=250)

    assert len(result) == 200
