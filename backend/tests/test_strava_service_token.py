"""Service Strava token refresh is single-flight and reusable across instances."""
import os
import sys
from types import SimpleNamespace
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.strava import StravaService


class _Snap:
    def __init__(self, data):
        self.exists = data is not None
        self._data = data or {}

    def to_dict(self):
        return dict(self._data)


class _Ref:
    def __init__(self):
        self.data = None

    def get(self, transaction=None):
        return _Snap(self.data)

    def set(self, payload, merge=True):
        if self.data is None or not merge:
            self.data = {}
        self.data.update(payload)


class _Tx:
    def set(self, ref, payload, merge=True):
        ref.set(payload, merge=merge)


class _DB:
    def __init__(self, ref):
        self.ref = ref

    def collection(self, _name):
        return self

    def document(self, _name):
        return self.ref

    def transaction(self):
        return _Tx()


def _identity(fn):
    return fn


def _service(monkeypatch, ref=None):
    monkeypatch.setattr("services.strava.firestore", SimpleNamespace(transactional=_identity))
    return StravaService(_DB(ref or _Ref()))


def test_reuses_stored_access_token_without_calling_strava(monkeypatch):
    ref = _Ref()
    ref.data = {
        "access_token": "access-live",
        "refresh_token": "refresh-1",
        "expires_at": time.time() + 3600,
    }
    svc = _service(monkeypatch, ref)
    called = {"n": 0}

    def _post(*_args, **_kwargs):
        called["n"] += 1
        raise AssertionError("Strava refresh should not run")

    monkeypatch.setattr("services.strava.requests", SimpleNamespace(post=_post))
    assert svc._get_service_token() == "access-live"
    assert called["n"] == 0


def test_waiter_uses_token_saved_by_the_lock_holder(monkeypatch):
    ref = _Ref()
    ref.data = {"refresh_token": "refresh-1", "expires_at": 0}
    svc = _service(monkeypatch, ref)
    monkeypatch.setattr(svc, "_claim_refresh_lock", lambda: None)
    monkeypatch.setattr("services.strava.time.sleep", lambda _seconds: None)

    reads = {"n": 0}

    def _read():
        reads["n"] += 1
        if reads["n"] == 1:
            return {"refresh_token": "refresh-1", "expires_at": 0}
        return {
            "access_token": "access-from-peer",
            "refresh_token": "refresh-2",
            "expires_at": time.time() + 3600,
        }

    monkeypatch.setattr(svc, "_read_service_token_doc", _read)
    monkeypatch.setattr(
        "services.strava.requests",
        SimpleNamespace(post=lambda *_args, **_kwargs: (_ for _ in ()).throw(AssertionError("waiter must not refresh"))),
    )
    assert svc._get_service_token() == "access-from-peer"


def test_rejected_refresh_retries_the_token_a_peer_saved(monkeypatch):
    ref = _Ref()
    ref.data = {"refresh_token": "refresh-old", "expires_at": 0}
    svc = _service(monkeypatch, ref)
    monkeypatch.setattr(svc, "_claim_refresh_lock", lambda: int(time.time()) + 20)
    released = {}
    monkeypatch.setattr(svc, "_release_refresh_lock", lambda until: released.setdefault("until", until))

    class _Res:
        def __init__(self, status, payload):
            self.status_code = status
            self.content = b"1"
            self._payload = payload

        def json(self):
            return self._payload

    calls = []

    def _post(_url, data=None, **_kwargs):
        calls.append(data["refresh_token"])
        if data["refresh_token"] == "refresh-old":
            ref.data = {
                "refresh_token": "refresh-new",
                "expires_at": 0,
            }
            return _Res(400, {"errors": [{"code": "invalid"}]})
        return _Res(200, {
            "access_token": "access-new",
            "refresh_token": "refresh-newer",
            "expires_at": time.time() + 3600,
        })

    monkeypatch.setattr("services.strava.requests", SimpleNamespace(post=_post))
    assert svc._get_service_token() == "access-new"
    assert calls == ["refresh-old", "refresh-new"]
    assert ref.data["refresh_token"] == "refresh-newer"
    assert ref.data["access_token"] == "access-new"
    assert ref.data["refresh_lock_until"] == 0


def test_same_rejected_token_is_not_sent_twice(monkeypatch):
    ref = _Ref()
    ref.data = {"refresh_token": "refresh-dead", "expires_at": 0}
    svc = _service(monkeypatch, ref)
    monkeypatch.setattr(svc, "_claim_refresh_lock", lambda: int(time.time()) + 20)
    monkeypatch.setattr(svc, "_release_refresh_lock", lambda _until: None)

    class _Res:
        status_code = 400
        content = b"1"

        def json(self):
            return {"errors": [{"code": "invalid"}]}

    calls = {"n": 0}

    def _post(*_args, **_kwargs):
        calls["n"] += 1
        return _Res()

    monkeypatch.setattr("services.strava.requests", SimpleNamespace(post=_post))
    assert svc._get_service_token() is None
    assert calls["n"] == 1


def test_claim_does_not_steal_an_active_lock(monkeypatch):
    ref = _Ref()
    ref.data = {"refresh_lock_until": time.time() + 30, "refresh_token": "refresh-1"}
    svc = _service(monkeypatch, ref)
    assert svc._claim_refresh_lock() is None
    assert ref.data["refresh_token"] == "refresh-1"


def test_release_does_not_clear_a_newer_lock(monkeypatch):
    ref = _Ref()
    ref.data = {"refresh_lock_until": 500}
    svc = _service(monkeypatch, ref)
    svc._release_refresh_lock(100)
    assert ref.data["refresh_lock_until"] == 500
    svc._release_refresh_lock(500)
    assert ref.data["refresh_lock_until"] == 0
