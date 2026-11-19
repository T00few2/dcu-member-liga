"""Sign in with Zwift, email verification and the signup email rule."""

from __future__ import annotations

import copy
import datetime
import itertools
import os
import sys
from types import SimpleNamespace
from urllib.parse import parse_qs, urlparse

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import integration  # noqa: E402
from routes import users_profile_routes as profile_routes  # noqa: E402
from services import email_verification, zwift_signin  # noqa: E402


# ---------------------------------------------------------------------------
# Minimal in-memory Firestore
# ---------------------------------------------------------------------------

_clock = itertools.count(1)


class _Snap:
    def __init__(self, ref, data, update_time):
        self.reference = ref
        self.id = ref.id
        self._data = data
        self.exists = data is not None
        self.update_time = update_time

    def to_dict(self):
        return copy.deepcopy(self._data) if self._data is not None else None


class _DocRef:
    def __init__(self, db, collection, doc_id):
        self._db = db
        self._collection = collection
        self.id = doc_id

    @property
    def _key(self):
        return (self._collection, self.id)

    def get(self, **_kwargs):
        data, ts = self._db.store.get(self._key, (None, None))
        return _Snap(self, copy.deepcopy(data), ts)

    def set(self, data, merge=False):
        data = _resolve_sentinels(data)
        current = self._db.store.get(self._key, (None, None))[0]
        if merge and current is not None:
            merged = copy.deepcopy(current)
            _deep_merge(merged, data)
            data = merged
        self._db.store[self._key] = (copy.deepcopy(data), next(_clock))

    def update(self, data):
        current = self._db.store.get(self._key, (None, None))[0]
        if current is None:
            raise KeyError("not found")
        current = copy.deepcopy(current)
        current.update(_resolve_sentinels(data))
        self._db.store[self._key] = (current, next(_clock))

    def delete(self, option=None):
        if option is not None:
            current_ts = self._db.store.get(self._key, (None, None))[1]
            if current_ts != option.last_update_time:
                raise RuntimeError("FailedPrecondition")
        self._db.store.pop(self._key, None)


def _resolve_sentinels(value):
    from firebase_admin import firestore

    if value is firestore.SERVER_TIMESTAMP:
        return datetime.datetime.now(datetime.timezone.utc)
    if isinstance(value, dict):
        return {k: _resolve_sentinels(v) for k, v in value.items()}
    return value


def _deep_merge(target, src):
    for key, value in src.items():
        if isinstance(value, dict) and isinstance(target.get(key), dict):
            _deep_merge(target[key], value)
        else:
            target[key] = copy.deepcopy(value)


class _Query:
    def __init__(self, db, collection, field, value):
        self._db, self._collection, self._field, self._value = db, collection, field, value
        self._limit = None

    def limit(self, n):
        self._limit = n
        return self

    def stream(self):
        out = []
        for (coll, doc_id), (data, _ts) in list(self._db.store.items()):
            if coll == self._collection and data and data.get(self._field) == self._value:
                out.append(_DocRef(self._db, coll, doc_id).get())
        return out[: self._limit] if self._limit else out


class _Collection:
    def __init__(self, db, name):
        self._db, self._name = db, name

    def document(self, doc_id):
        return _DocRef(self._db, self._name, str(doc_id))

    def where(self, field, op, value):
        assert op == "=="
        return _Query(self._db, self._name, field, value)

    def stream(self):
        return [
            _DocRef(self._db, coll, doc_id).get()
            for (coll, doc_id), (data, _ts) in list(self._db.store.items())
            if coll == self._name and data is not None
        ]


class FakeDB:
    def __init__(self):
        self.store = {}

    def collection(self, name):
        return _Collection(self, name)

    def write_option(self, last_update_time=None):
        return SimpleNamespace(last_update_time=last_update_time)

    def doc(self, collection, doc_id):
        return self.store.get((collection, str(doc_id)), (None, None))[0]


# ---------------------------------------------------------------------------
# Fake firebase_admin.auth
# ---------------------------------------------------------------------------


class _UserNotFound(Exception):
    pass


class FakeAuth:
    UserNotFoundError = _UserNotFound

    def __init__(self):
        self.users = {}

    def get_user(self, uid):
        if uid not in self.users:
            raise _UserNotFound(uid)
        return self.users[uid]

    def create_user(self, uid, display_name=None, **_kwargs):
        self.users[uid] = SimpleNamespace(uid=uid, display_name=display_name, provider_data=[])
        return self.users[uid]

    def create_custom_token(self, uid):
        return f"custom-token-for-{uid}".encode()


class FakeZwiftService:
    def __init__(self, profile):
        self.profile = profile
        self.authorize_calls = []

    def build_authorize_url(self, state, prompt_login=False):
        self.authorize_calls.append(state)
        return f"https://zwift.test/auth?state={state}"

    def exchange_code_for_tokens(self, code):
        if code == "bad":
            return 400, {}
        return 200, {"access_token": "at", "refresh_token": "rt", "scope": "activity profile:read"}

    def get_profile(self, **_kwargs):
        return self.profile

    def get_power_profile(self, _token):
        return None

    def subscribe_activity(self, _t):
        return 200, {}

    subscribe_racing_score = subscribe_activity
    subscribe_power_curve = subscribe_activity


PROFILE = {"id": 123456, "userId": "uuid-abc", "firstName": "Anna", "lastName": "Rytter", "competitionMetrics": {}}


@pytest.fixture
def env(monkeypatch):
    db = FakeDB()
    fake_auth = FakeAuth()
    zwift = FakeZwiftService(dict(PROFILE))
    monkeypatch.setattr(integration, "db", db)
    monkeypatch.setattr(profile_routes, "db", db)
    monkeypatch.setattr(zwift_signin, "auth", fake_auth)
    monkeypatch.setattr(integration, "get_zwift_service", lambda: zwift)
    monkeypatch.setattr(integration, "FRONTEND_URL", "https://front.test")
    monkeypatch.setattr(integration, "upsert_from_token_response", lambda *a, **k: None)
    monkeypatch.setattr(integration, "append_weight_history_entry", lambda *a, **k: None)
    monkeypatch.setattr(integration, "ensure_drop_level_fields", lambda _id, prof: prof)
    monkeypatch.setattr(integration, "allow", lambda *a, **k: True)
    # resolve_user_doc_id_from_auth_uid uses services.zwift_tokens.db
    from services import zwift_tokens
    monkeypatch.setattr(zwift_tokens, "db", db)
    return SimpleNamespace(db=db, auth=fake_auth, zwift=zwift, app=Flask(__name__))


def _start_signin(env, intent="register"):
    with env.app.test_request_context("/auth/zwift/start", method="POST", json={"intent": intent}):
        resp, status = integration.zwift_signin_start()
    assert status == 200
    return env.zwift.authorize_calls[-1]


def _callback(env, state, code="good"):
    with env.app.test_request_context(f"/zwift/callback?code={code}&state={state}"):
        resp = integration.zwift_callback()
    return resp


def _redirect_params(resp):
    assert resp.status_code == 302
    url = urlparse(resp.headers["Location"])
    assert url.path == "/auth/zwift"
    return {k: v[0] for k, v in parse_qs(url.query).items()}


def _exchange(env, code):
    with env.app.test_request_context("/auth/zwift/exchange", method="POST", json={"code": code}):
        return integration.zwift_signin_exchange()


# ---------------------------------------------------------------------------
# Sign-in flow
# ---------------------------------------------------------------------------


def test_new_rider_signin_creates_zwift_uid_and_user_doc(env):
    state = _start_signin(env)
    assert env.db.doc("zwift_oauth_states", state)["mode"] == "signin"

    params = _redirect_params(_callback(env, state))
    assert "code" in params

    assert "zwift_123456" in env.auth.users
    assert env.auth.users["zwift_123456"].display_name == "Anna Rytter"
    user = env.db.doc("users", "123456")
    assert user["authUid"] == "zwift_123456"
    assert user["zwiftId"] == "123456"
    assert user["connections"]["zwift"]["connected"] is True
    assert env.db.doc("auth_mappings", "zwift_123456")["zwiftId"] == "123456"
    assert env.db.doc("zwift_oauth_states", state) is None

    resp, status = _exchange(env, params["code"])
    assert status == 200
    assert resp.get_json() == {"customToken": "custom-token-for-zwift_123456", "intent": "register"}


def test_login_code_is_single_use(env):
    params = _redirect_params(_callback(env, _start_signin(env)))
    _, status = _exchange(env, params["code"])
    assert status == 200
    resp, status = _exchange(env, params["code"])
    assert status == 400
    assert resp.get_json()["code"] == "invalid_code"


def test_login_code_expires(env):
    params = _redirect_params(_callback(env, _start_signin(env)))
    ref = env.db.collection("zwift_login_codes").document(params["code"])
    data = ref.get().to_dict()
    data["expiresAt"] = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
    ref.set(data)
    resp, status = _exchange(env, params["code"])
    assert status == 400
    assert resp.get_json()["code"] == "expired_code"


def test_repeat_login_reuses_same_uid(env):
    _callback(env, _start_signin(env, "login"))
    _callback(env, _start_signin(env, "login"))
    assert list(env.auth.users) == ["zwift_123456"]


def test_existing_google_rider_keeps_their_uid(env):
    env.db.collection("users").document("123456").set(
        {"authUid": "google-uid-1", "zwiftId": "123456", "email": "anna@example.com",
         "registration": {"status": "complete"}}
    )
    env.auth.users["google-uid-1"] = SimpleNamespace(uid="google-uid-1", provider_data=[{"providerId": "google.com"}])

    params = _redirect_params(_callback(env, _start_signin(env, "login")))
    resp, _ = _exchange(env, params["code"])
    assert resp.get_json()["customToken"] == "custom-token-for-google-uid-1"
    assert "zwift_123456" not in env.auth.users
    user = env.db.doc("users", "123456")
    assert user["authUid"] == "google-uid-1"
    assert user["email"] == "anna@example.com"
    assert user["registration"]["status"] == "complete"


def test_google_draft_doc_keyed_by_uid_is_found_by_zwift_id(env):
    env.db.collection("users").document("google-uid-2").set({"authUid": "google-uid-2", "zwiftId": "123456"})
    env.auth.users["google-uid-2"] = SimpleNamespace(uid="google-uid-2", provider_data=[{"providerId": "google.com"}])

    params = _redirect_params(_callback(env, _start_signin(env)))
    resp, _ = _exchange(env, params["code"])
    assert resp.get_json()["customToken"] == "custom-token-for-google-uid-2"
    assert env.db.doc("users", "123456") is None
    assert env.db.doc("users", "google-uid-2")["connections"]["zwift"]["connected"] is True
    # No zwiftId mapping pointing at a non-existent users/123456 doc.
    assert "zwiftId" not in env.db.doc("auth_mappings", "google-uid-2")


def test_signin_cancelled_at_zwift_redirects_with_error(env):
    state = _start_signin(env)
    with env.app.test_request_context(f"/zwift/callback?error=access_denied&state={state}"):
        resp = integration.zwift_callback()
    assert _redirect_params(resp) == {"error": "access_denied"}


def test_signin_token_exchange_failure_redirects_with_error(env):
    params = _redirect_params(_callback(env, _start_signin(env), code="bad"))
    assert params == {"error": "token_exchange_failed"}
    assert env.auth.users == {}


def test_connect_flow_for_logged_in_user_still_works(env):
    env.db.collection("zwift_oauth_states").document("s1").set(
        {"uid": "google-uid-3", "createdAt": datetime.datetime.now(datetime.timezone.utc)}
    )
    resp = _callback(env, "s1")
    assert resp.status_code == 302
    assert resp.headers["Location"] == "https://front.test/register?zwift=connected"
    assert env.db.doc("users", "google-uid-3")["zwiftId"] == "123456"
    assert env.auth.users == {}


def test_deauthorize_blocked_when_zwift_is_only_login(env, monkeypatch):
    env.auth.create_user(uid="zwift_123456")
    monkeypatch.setattr(integration, "verify_user_token", lambda _r: {"uid": "zwift_123456"})
    with env.app.test_request_context("/zwift/deauthorize", method="POST"):
        resp, status = integration.zwift_deauthorize()
    assert status == 409
    assert resp.get_json()["code"] == "zwift_is_login_method"


# ---------------------------------------------------------------------------
# Email verification
# ---------------------------------------------------------------------------


@pytest.fixture
def mailer(monkeypatch):
    sent = []
    monkeypatch.setattr(profile_routes, "send_plain_email", lambda **kw: sent.append(kw))
    monkeypatch.setattr(profile_routes, "verify_user_token", lambda _r: {"uid": "zwift_123456"})
    return sent


def _send(env, email):
    with env.app.test_request_context("/profile/email/send-code", method="POST", json={"email": email}):
        return profile_routes.send_email_verification_code()


def _verify(env, code):
    with env.app.test_request_context("/profile/email/verify", method="POST", json={"code": code}):
        return profile_routes.verify_email_code()


def _code_from(mail):
    import re
    return re.search(r"\b(\d{6})\b", mail["message"]).group(1)


def test_email_code_round_trip_marks_user_doc_verified(env, mailer):
    env.db.collection("auth_mappings").document("zwift_123456").set({"zwiftId": "123456"})
    env.db.collection("users").document("123456").set({"authUid": "zwift_123456"})

    resp, status = _send(env, "  Anna@Example.COM ")
    assert status == 200
    assert resp.get_json()["email"] == "anna@example.com"
    assert mailer[0]["to_email"] == "anna@example.com"

    resp, status = _verify(env, _code_from(mailer[0]))
    assert status == 200
    user = env.db.doc("users", "123456")
    assert user["email"] == "anna@example.com"
    assert user["emailVerified"] is True
    assert env.db.doc("email_verifications", "zwift_123456") is None


def test_invalid_email_rejected(env, mailer):
    resp, status = _send(env, "not-an-email")
    assert status == 400
    assert mailer == []


def test_resend_cooldown(env, mailer):
    _send(env, "a@b.dk")
    resp, status = _send(env, "a@b.dk")
    assert status == 429
    assert resp.get_json()["code"] == "cooldown"
    assert len(mailer) == 1


def test_wrong_code_counts_attempts_then_locks(env, mailer):
    _send(env, "a@b.dk")
    real = _code_from(mailer[0])
    wrong = "000000" if real != "000000" else "111111"
    for _ in range(email_verification.MAX_ATTEMPTS):
        _, status = _verify(env, wrong)
        assert status == 400
    resp, status = _verify(env, real)
    assert status == 429
    assert resp.get_json()["code"] == "too_many_attempts"


def test_expired_code_rejected(env, mailer):
    _send(env, "a@b.dk")
    ref = env.db.collection("email_verifications").document("zwift_123456")
    data = ref.get().to_dict()
    data["expiresAt"] = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(seconds=1)
    ref.set(data)
    resp, status = _verify(env, _code_from(mailer[0]))
    assert status == 400
    assert resp.get_json()["code"] == "expired"


def test_smtp_failure_returns_503(env, monkeypatch):
    from utils.email_sender import EmailSendError

    def boom(**_kw):
        raise EmailSendError("down")

    monkeypatch.setattr(profile_routes, "send_plain_email", boom)
    monkeypatch.setattr(profile_routes, "verify_user_token", lambda _r: {"uid": "zwift_123456"})
    resp, status = _send(env, "a@b.dk")
    assert status == 503
    assert env.db.doc("email_verifications", "zwift_123456") is None


# ---------------------------------------------------------------------------
# Signup email rule
# ---------------------------------------------------------------------------


def test_signup_email_prefers_verified_doc_email(env):
    env.db.collection("auth_mappings").document("u1").set({"zwiftId": "1"})
    env.db.collection("users").document("1").set({"email": "verified@x.dk", "emailVerified": True})
    assert profile_routes._signup_email("u1", {"email": "google@x.dk"}) == "verified@x.dk"


def test_signup_email_falls_back_to_token_email(env):
    assert profile_routes._signup_email("u2", {"email": "google@x.dk"}) == "google@x.dk"


def test_signup_without_email_is_rejected(env, monkeypatch):
    monkeypatch.setattr(profile_routes, "verify_user_token", lambda _r: {"uid": "zwift_9"})
    with env.app.test_request_context("/signup", method="POST", json={"name": "A", "club": "X"}):
        resp, status = profile_routes.signup()
    assert status == 400
    assert resp.get_json()["code"] == "email_required"
