"""Filling the Strava curve cache for predictor tuning, a couple of riders at a time."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import admin_predictor_routes as routes  # noqa: E402
from routes.admin import admin_bp  # noqa: E402
from services import predictor_service as ps  # noqa: E402
from services import strava_cache_warmer as warmer  # noqa: E402
from services import strava_rate  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402


def _rider(i, *, strava=True, rides=30, velo=1200):
    return {
        "zwiftId": str(i), "userDocId": f"doc{i}", "hasStrava": strava,
        "rating": velo, "max30Rating": velo, "zwiftActivityCount": rides,
    }


def _fresh(hours=1):
    return (datetime.now(timezone.utc) - timedelta(hours=hours)).isoformat()


def _strava():
    service = MagicMock()
    service.get_power_activities.return_value = [{"id": 1}, {"id": 2}]
    return service


def test_only_reliable_riders_with_strava_are_eligible():
    riders = [_rider(1), _rider(2, strava=False), _rider(3, rides=3), _rider(4, velo="N/A")]
    assert [r["zwiftId"] for r in warmer.eligible_riders(riders, 15)] == ["1"]


def test_status_counts_fresh_curves_and_lists_never_cached_first():
    db = FakeDb()
    db.store["strava_power_curves/doc1_90"] = {"curve": {"w5": 1}, "computedAt": _fresh()}
    db.store["strava_power_curves/doc2_90"] = {"curve": {"w5": 1}, "computedAt": _fresh(hours=24 * 40)}
    riders = [_rider(1), _rider(2), _rider(3)]

    status = warmer.cache_status(db, riders, min_rides=15, days=90)

    assert status["eligible"] == 3
    assert status["cached"] == 1
    assert [r["zwiftId"] for r in status["missing"]] == ["3", "2"]  # stale one after never-cached


def test_riders_without_power_rides_do_not_count_as_cached():
    db = FakeDb()
    service = MagicMock()
    service.get_power_activities.return_value = []  # Strava connected, no power meter rides
    riders = [_rider(1)]

    result = warmer.warm(db, service, riders, min_rides=15, days=90, compute_curve=MagicMock())
    assert result["cached"] == 0 and result["noPowerData"] == 1 and result["remaining"] == 0

    again = warmer.warm(db, service, riders, min_rides=15, days=90, compute_curve=MagicMock())
    assert again["warmed"] == []  # not retried within a week
    assert service.get_power_activities.call_count == 1

    db.store["strava_power_curves/doc1_90"]["computedAt"] = _fresh(hours=24 * 8)
    status = warmer.cache_status(db, riders, min_rides=15, days=90)
    assert [r["zwiftId"] for r in status["missing"]] == ["1"]  # retried after a week


@pytest.fixture(autouse=True)
def _fresh_rate_state():
    strava_rate.clear()
    yield
    strava_rate.clear()


def test_warm_fetches_at_most_ten_riders_per_call():
    db = FakeDb()
    compute = MagicMock(return_value={"w5": 900.0})
    riders = [_rider(i) for i in range(12)]

    first = warmer.warm(db, _strava(), riders, min_rides=15, days=90, compute_curve=compute)

    assert len(first["warmed"]) == 10
    assert first["remaining"] == 2
    assert first["cached"] == 10
    assert compute.call_count == 10
    assert db.store[f"{warmer.LAST_WARM_COLLECTION}/{warmer.LAST_WARM_DOC}"]["warmed"] == 10

    warmer.warm(db, _strava(), riders, min_rides=15, days=90, compute_curve=compute)
    done = warmer.warm(db, _strava(), riders, min_rides=15, days=90, compute_curve=compute)
    assert done["warmed"] == [] and done["remaining"] == 0 and done["cached"] == 12
    assert compute.call_count == 12  # a full cache costs no further Strava requests


def test_a_failing_rider_does_not_stop_the_batch():
    db = FakeDb()
    service = _strava()
    service.get_power_activities.side_effect = [RuntimeError("Strava 429"), [{"id": 1}]]
    result = warmer.warm(db, service, [_rider(1), _rider(2)], min_rides=15, days=90,
                         compute_curve=MagicMock(return_value={"w5": 1.0}))
    assert result["failed"] == ["1"]
    assert [w["zwiftId"] for w in result["warmed"]] == ["2"]


# --- Routes -------------------------------------------------------------------


@pytest.fixture
def client(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(routes, "db", db)
    monkeypatch.setattr(routes, "strava_service", _strava())
    monkeypatch.setattr(routes, "_compute_strava_power_curve", MagicMock(return_value={"w5": 1.0}))
    monkeypatch.setattr(ps, "load_participants", lambda _db: [_rider(i) for i in range(3)])
    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    return app.test_client()


def test_scheduler_token_can_warm(client, monkeypatch):
    monkeypatch.setattr(routes, "require_scheduler", lambda _req: None)
    res = client.post("/admin/predictor/strava-cache/warm", json={})
    assert res.status_code == 200
    body = res.get_json()
    assert body["warmed"] == 3 and body["remaining"] == 0 and body["minEvalRiders"] == 40
    assert body["rateLimited"] is False
    assert "zwiftId" not in res.get_data(as_text=True)  # scheduler logs are public: counts only


def test_warm_without_scheduler_token_needs_admin(client, monkeypatch):
    from authz import AuthzError

    def deny(_req):
        raise AuthzError("Forbidden", 403)

    monkeypatch.setattr(routes, "require_scheduler", deny)
    monkeypatch.setattr(routes, "require_admin", deny)
    assert client.post("/admin/predictor/strava-cache/warm", json={}).status_code == 403

    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True})
    assert client.post("/admin/predictor/strava-cache/warm", json={}).status_code == 200


def test_status_endpoint(client, monkeypatch):
    monkeypatch.setattr(routes, "require_admin", lambda _req: {"admin": True})
    body = client.get("/admin/predictor/strava-cache/status").get_json()
    usage = body.pop("stravaUsage")
    assert body.pop("lastWarm") is None
    assert body == {"days": 90, "eligible": 3, "cached": 0, "noPowerData": 0, "remaining": 3, "minEvalRiders": 40}
    assert usage["cacheBudgetFraction"] == 0.75 and usage["known"] is False


# --- Strava rate budget ------------------------------------------------------------


NOW = datetime(2026, 11, 3, 14, 40, tzinfo=timezone.utc)


def _usage(u15, uday, at=NOW, l15=300, lday=3000):
    return {"limit15": l15, "limitDay": lday, "usage15": u15, "usageDay": uday, "at": at.isoformat()}


def test_headers_are_recorded_and_windows_reset():
    strava_rate.record({"X-ReadRateLimit-Limit": "300,3000", "X-ReadRateLimit-Usage": "12,345"}, now=NOW)
    snap = strava_rate.snapshot()
    assert strava_rate.current_usage(snap, NOW) == {
        "limit15": 300, "limitDay": 3000, "usage15": 12, "usageDay": 345, "known": True}
    # Next quarter hour: 15-minute counter resets, daily does not.
    assert strava_rate.current_usage(snap, NOW + timedelta(minutes=10))["usage15"] == 0
    assert strava_rate.current_usage(snap, NOW + timedelta(minutes=10))["usageDay"] == 345
    # Next UTC day: both reset.
    assert strava_rate.current_usage(snap, NOW + timedelta(hours=10))["usageDay"] == 0
    strava_rate.record(None)
    strava_rate.record({"X-ReadRateLimit-Usage": "garbage"})
    assert strava_rate.snapshot() == snap  # bad or missing headers are ignored


def test_budget_keeps_half_of_both_limits_free():
    assert strava_rate.within_budget(_usage(80, 1000), 60, 0.5, NOW)          # 140 <= 150, 1060 <= 1500
    assert not strava_rate.within_budget(_usage(100, 1000), 60, 0.5, NOW)     # 160 > 150 in 15 min
    assert not strava_rate.within_budget(_usage(0, 1450), 60, 0.5, NOW)       # daily share used up
    assert strava_rate.within_budget({}, 60, 0.5, NOW)  # nothing known yet: one rider to learn limits


def test_warm_stops_when_the_budget_is_used(monkeypatch):
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = _usage(0, 2249)  # 75% of 3,000 is 2,250
    compute = MagicMock(return_value={"w5": 1.0})
    result = warmer.warm(db, _strava(), [_rider(i) for i in range(3)], min_rides=15, days=90,
                         compute_curve=compute, now=lambda: NOW)
    assert result["rateLimited"] is True and result["warmed"] == [] and compute.call_count == 0


def test_warm_learns_usage_from_responses_and_stops_mid_batch():
    db = FakeDb()
    service = MagicMock()

    def activities(*_a, **_k):
        # Each Strava response reports the app's usage; this one nearly fills the 15-min share (225).
        strava_rate.record({"X-ReadRateLimit-Limit": "300,3000", "X-ReadRateLimit-Usage": "224,500"}, now=NOW)
        return [{"id": 1}]

    service.get_power_activities.side_effect = activities
    result = warmer.warm(db, service, [_rider(i) for i in range(3)], min_rides=15, days=90,
                         compute_curve=MagicMock(return_value={"w5": 1.0}), now=lambda: NOW)
    assert len(result["warmed"]) == 1 and result["rateLimited"] is True
    assert db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"]["usage15"] == 224  # shared with other instances


def test_older_usage_never_overwrites_newer_usage():
    db = FakeDb()
    key = f"{strava_rate.COLLECTION}/{strava_rate.DOC}"
    db.store[key] = _usage(10, 1400, at=NOW)
    # This instance last saw Strava 30 minutes earlier, with lower usage.
    strava_rate.record({"X-ReadRateLimit-Limit": "300,3000", "X-ReadRateLimit-Usage": "5,600"},
                       now=NOW - timedelta(minutes=30))
    assert strava_rate.persist(db) is False
    assert db.store[key]["usageDay"] == 1400

    strava_rate.record({"X-ReadRateLimit-Limit": "300,3000", "X-ReadRateLimit-Usage": "20,1450"},
                       now=NOW + timedelta(minutes=1))
    assert strava_rate.persist(db) is True
    assert db.store[key]["usageDay"] == 1450


def test_a_paused_run_does_not_write_usage(monkeypatch):
    db = FakeDb()
    key = f"{strava_rate.COLLECTION}/{strava_rate.DOC}"
    db.store[key] = _usage(0, 2249, at=NOW)  # shared doc: daily share used up
    strava_rate.record({"X-ReadRateLimit-Limit": "300,3000", "X-ReadRateLimit-Usage": "0,100"},
                       now=NOW - timedelta(minutes=30))  # this instance's older reading
    writes = []
    monkeypatch.setattr(strava_rate, "persist", lambda _db: writes.append(1))
    result = warmer.warm(db, _strava(), [_rider(1)], min_rides=15, days=90,
                         compute_curve=MagicMock(), now=lambda: NOW)
    assert result["rateLimited"] is True and result["warmed"] == []
    assert writes == [] and db.store[key]["usageDay"] == 2249


# --- One warm-up at a time ---------------------------------------------------------


def test_a_second_warm_up_waits_while_one_is_running():
    db = FakeDb()
    lock = f"{warmer.LOCK_COLLECTION}/{warmer.LOCK_DOC}"
    db.store[lock] = {"owner": "other", "at": NOW.isoformat()}  # e.g. Cloud Scheduler mid-run
    service = _strava()
    result = warmer.warm(db, service, [_rider(1)], min_rides=15, days=90,
                         compute_curve=MagicMock(), now=lambda: NOW + timedelta(minutes=2))
    assert result["busy"] is True and result["warmed"] == []
    service.get_power_activities.assert_not_called()
    assert db.store[lock]["owner"] == "other"  # the running warm-up keeps its lock


def test_a_stale_lock_is_taken_over_and_released_afterwards():
    db = FakeDb()
    lock = f"{warmer.LOCK_COLLECTION}/{warmer.LOCK_DOC}"
    db.store[lock] = {"owner": "killed", "at": (NOW - timedelta(minutes=30)).isoformat()}
    result = warmer.warm(db, _strava(), [_rider(1)], min_rides=15, days=90,
                         compute_curve=MagicMock(return_value={"w5": 1.0}), now=lambda: NOW)
    assert result["busy"] is False and len(result["warmed"]) == 1
    assert lock not in db.store  # released for the next call


def test_busy_route_returns_counts_only(client, monkeypatch):
    monkeypatch.setattr(routes, "require_scheduler", lambda _req: None)
    routes.db.store[f"{warmer.LOCK_COLLECTION}/{warmer.LOCK_DOC}"] = {
        "owner": "other", "at": datetime.now(timezone.utc).isoformat()}
    body = client.post("/admin/predictor/strava-cache/warm", json={}).get_json()
    assert body == {"busy": True, "warmed": 0, "rateLimited": False}


def test_lock_is_claimed_inside_a_transaction(monkeypatch):
    """With a real Firestore client the read-check-write runs as one transaction."""
    from firebase_admin import firestore

    monkeypatch.setattr(firestore, "transactional", lambda fn: fn, raising=False)  # run the body directly
    db = FakeDb()
    writes = []

    class Tx:
        def set(self, ref, data):
            writes.append(data)
            ref.set(data)

    db.transaction = lambda: Tx()
    lock = f"{warmer.LOCK_COLLECTION}/{warmer.LOCK_DOC}"

    assert warmer._acquire_lock(db, "a", NOW) is True
    assert writes == [{"owner": "a", "at": NOW.isoformat()}]
    assert warmer._acquire_lock(db, "b", NOW + timedelta(minutes=1)) is False  # held
    assert warmer._acquire_lock(db, "c", NOW + timedelta(minutes=30)) is True  # stale: taken over
    assert db.store[lock]["owner"] == "c"


# --- The app's own request count (Strava's header undercounts) -----------------------


def test_every_strava_get_is_counted(monkeypatch):
    from services import strava as strava_mod

    monkeypatch.setattr(strava_mod.requests, "get", lambda *a, **k: MagicMock(headers={}))
    for _ in range(3):
        strava_mod._strava_get("https://www.strava.com/api/v3/athlete/activities")
    counts = strava_rate.pending()
    assert sum(counts["day"].values()) == 3 and sum(counts["quarter"].values()) == 3


def test_own_count_wins_over_a_low_header():
    strava_rate.record({"X-ReadRateLimit-Limit": "300,3000", "X-ReadRateLimit-Usage": "10,75"}, now=NOW)
    for _ in range(120):
        strava_rate.count_request(NOW)
    usage = strava_rate.current_usage(strava_rate.snapshot(), NOW)
    assert usage["usage15"] == 120 and usage["usageDay"] == 120
    assert not strava_rate.within_budget(strava_rate.snapshot(), 120, 0.75, NOW)  # 240 > 225


def test_persist_adds_counts_from_every_instance_and_resets_per_window():
    db = FakeDb()
    key = f"{strava_rate.COLLECTION}/{strava_rate.DOC}"
    for _ in range(5):
        strava_rate.count_request(NOW)
    assert strava_rate.persist(db, now=NOW) is True
    assert strava_rate.pending() == {"day": {}, "quarter": {}}
    for _ in range(3):  # another instance, same quarter hour
        strava_rate.count_request(NOW)
    strava_rate.persist(db, now=NOW)
    assert db.store[key]["ownCountDay"] == 8 and db.store[key]["ownCount15"] == 8

    later = NOW + timedelta(minutes=20)  # next quarter hour, same day
    strava_rate.count_request(later)
    strava_rate.persist(db, now=later)
    assert db.store[key]["ownCountDay"] == 9 and db.store[key]["ownCount15"] == 1
    usage = strava_rate.current_usage(strava_rate.combined(strava_rate.load(db)), later)
    assert usage["usageDay"] == 9 and usage["usage15"] == 1


def test_a_rider_bigger_than_the_15_minute_share_runs_in_an_empty_window():
    snap = {"limit15": 300, "limitDay": 3000, "usage15": 0, "usageDay": 0, "at": NOW.isoformat()}
    assert strava_rate.within_budget(snap, 400, 0.75, NOW)  # alone in the quarter hour
    busy = {**snap, "usage15": 5}
    assert not strava_rate.within_budget(busy, 400, 0.75, NOW)


def test_warm_checks_each_riders_real_ride_count_before_downloading():
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = {
        "limit15": 300, "limitDay": 3000, "usage15": 0, "usageDay": 0, "at": NOW.isoformat(),
        "ownDay": NOW.strftime("%Y-%m-%d"), "ownCountDay": 100,
        "ownQuarter": strava_rate._quarter_key(NOW), "ownCount15": 100,
    }
    service = MagicMock()
    service.get_power_activities.return_value = [{"id": i} for i in range(150)]  # 100 + 150 > 225
    compute = MagicMock(return_value={"w5": 1.0})
    result = warmer.warm(db, service, [_rider(1)], min_rides=15, days=90, compute_curve=compute,
                         now=lambda: NOW)
    assert result["rateLimited"] is True and result["warmed"] == []
    compute.assert_not_called()  # no streams downloaded; the rider waits for the next window
    assert service.get_power_activities.call_args.kwargs["max_activities"] is None  # every ride


def test_power_activities_without_a_cap_returns_every_ride(monkeypatch):
    from services import strava as strava_mod

    service = strava_mod.StravaService(MagicMock())
    monkeypatch.setattr(service, "_get_valid_token", lambda _r: "token")
    rides = [{"id": i, "type": "Ride", "sport_type": "Ride", "device_watts": True,
              "start_date": f"2026-10-{i % 28 + 1:02d}T10:00:00Z"} for i in range(80)]
    res = MagicMock(status_code=200, headers={})
    res.json.return_value = rides
    monkeypatch.setattr(strava_mod.requests, "get", lambda *a, **k: res)
    after = int(datetime(2026, 9, 1, tzinfo=timezone.utc).timestamp())
    assert len(service.get_power_activities("u1", after)) == 50  # default cap for other callers
    assert len(service.get_power_activities("u1", after, max_activities=None)) == 80


def _usage_doc(own15=0, own_day=0, at=NOW):
    return {
        "limit15": 300, "limitDay": 3000, "usage15": 0, "usageDay": 0, "at": at.isoformat(),
        "ownDay": at.strftime("%Y-%m-%d"), "ownCountDay": own_day,
        "ownQuarter": strava_rate._quarter_key(at), "ownCount15": own15,
    }


def _rides(n):
    return [{"id": i} for i in range(n)]


def test_a_rider_with_many_rides_runs_in_an_empty_quarter_hour_despite_its_own_list_request():
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = _usage_doc()
    service = MagicMock()

    def activities(*_a, **_k):
        strava_rate.count_request(NOW)  # the list request itself counts in this quarter hour
        return _rides(400)  # more than the 225 share on its own

    service.get_power_activities.side_effect = activities
    compute = MagicMock(return_value={"w5": 1.0})
    result = warmer.warm(db, service, [_rider(1)], min_rides=15, days=90, compute_curve=compute,
                         now=lambda: NOW)
    assert [w["activityCount"] for w in result["warmed"]] == [400]
    compute.assert_called_once()


def test_a_heavy_rider_in_a_busy_quarter_hour_is_skipped_and_the_next_rider_still_runs():
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = _usage_doc(own15=10, own_day=10)
    service = MagicMock()
    service.get_power_activities.side_effect = [_rides(400), _rides(20)]
    compute = MagicMock(return_value={"w5": 1.0})
    result = warmer.warm(db, service, [_rider(1), _rider(2)], min_rides=15, days=90,
                         compute_curve=compute, now=lambda: NOW)
    assert [w["zwiftId"] for w in result["warmed"]] == ["2"]  # rider 1 waits for an empty window
    assert result["rateLimited"] is True and compute.call_count == 1


def test_a_normal_rider_that_does_not_fit_still_stops_the_run():
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = _usage_doc(own15=200, own_day=200)
    service = MagicMock()
    service.get_power_activities.side_effect = [_rides(50), _rides(5)]
    result = warmer.warm(db, service, [_rider(1), _rider(2)], min_rides=15, days=90,
                         compute_curve=MagicMock(), now=lambda: NOW)
    assert result["warmed"] == [] and result["rateLimited"] is True
    assert service.get_power_activities.call_count == 1  # budget used: nobody after it is tried


def test_the_daily_cap_still_stops_a_heavy_rider():
    snap = _usage_doc(own_day=2000)
    assert not strava_rate.within_budget(snap, 400, 0.75, NOW, window_used_before=0)  # 2400 > 2250


def test_a_share_sized_rider_runs_in_an_empty_quarter_hour_after_its_own_list_request():
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = _usage_doc()
    service = MagicMock()

    def activities(*_a, **_k):
        strava_rate.count_request(NOW)  # 1 + 225 > 225, although 225 alone fits the share
        return _rides(225)

    service.get_power_activities.side_effect = activities
    compute = MagicMock(return_value={"w5": 1.0})
    result = warmer.warm(db, service, [_rider(1)], min_rides=15, days=90, compute_curve=compute,
                         now=lambda: NOW)
    assert [w["activityCount"] for w in result["warmed"]] == [225]


def test_a_share_sized_rider_in_a_busy_quarter_hour_is_skipped_not_a_stop():
    db = FakeDb()
    db.store[f"{strava_rate.COLLECTION}/{strava_rate.DOC}"] = _usage_doc(own15=10, own_day=10)
    service = MagicMock()
    service.get_power_activities.side_effect = [_rides(224), _rides(20)]
    compute = MagicMock(return_value={"w5": 1.0})
    result = warmer.warm(db, service, [_rider(1), _rider(2)], min_rides=15, days=90,
                         compute_curve=compute, now=lambda: NOW)
    assert [w["zwiftId"] for w in result["warmed"]] == ["2"]
