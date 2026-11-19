"""Changing a rider's email takes the old address off the Zoho standing list."""

from __future__ import annotations

import os
import re
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import utils.zoho_campaigns as campaigns  # noqa: E402
from routes import users_profile_routes as profile_routes  # noqa: E402
from services import email_change  # noqa: E402
from tests.test_zwift_signin import FakeDB  # noqa: E402
from utils.email_sender import EmailSendError  # noqa: E402


@pytest.fixture
def zoho(monkeypatch):
    """Configured Zoho with a standing list; records listunsubscribe calls."""
    calls: list[tuple[str, dict]] = []
    fail_for: set[str] = set()
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_CLIENT_ID", "id")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_CLIENT_SECRET", "secret")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_REFRESH_TOKEN", "refresh")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_FROM_EMAIL", "info@example.com")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_LIST_KEY", "STANDING1")
    monkeypatch.setattr(campaigns, "_access_token_value", lambda: "tok")

    def fake_post(path, fields, token, *, query=True):
        calls.append((path, dict(fields)))
        if path == "json/listunsubscribe":
            address = re.search(r'"Contact Email": "([^"]+)"', fields["contactinfo"]).group(1)
            if address in fail_for:
                raise EmailSendError("boom")
        return {"code": "0", "message": "ok"}

    monkeypatch.setattr(campaigns, "_campaign_post", fake_post)
    return type("Zoho", (), {"calls": calls, "fail_for": fail_for})


def _unsubscribed(zoho) -> list[str]:
    out = []
    for path, fields in zoho.calls:
        if path == "json/listunsubscribe":
            assert fields["listkey"] == "STANDING1"
            assert query_is_form(fields)
            out.append(re.search(r'"Contact Email": "([^"]+)"', fields["contactinfo"]).group(1))
    return out


def query_is_form(fields: dict) -> bool:
    return fields.get("resfmt") == "JSON"


# --- Zoho client --------------------------------------------------------------


def test_unsubscribe_uses_the_standing_list(zoho):
    done, failed = campaigns.unsubscribe_from_standing_list(["old@example.com"])
    assert done == ["old@example.com"] and failed == []
    assert _unsubscribed(zoho) == ["old@example.com"]


def test_without_standing_list_there_is_nothing_to_clean(zoho, monkeypatch):
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_LIST_KEY", "")
    done, failed = campaigns.unsubscribe_from_standing_list(["old@example.com"])
    assert done == ["old@example.com"] and failed == []
    assert zoho.calls == []


def test_one_failure_does_not_stop_the_others(zoho):
    zoho.fail_for.add("bad@example.com")
    done, failed = campaigns.unsubscribe_from_standing_list(["bad@example.com", "ok@example.com"])
    assert done == ["ok@example.com"] and failed == ["bad@example.com"]


# --- Queue --------------------------------------------------------------------


def test_record_ignores_unchanged_or_missing_old_email():
    db = FakeDB()
    assert email_change.record_email_change(db, "1", None, "a@x.dk") is False
    assert email_change.record_email_change(db, "1", "A@x.dk", "a@x.dk") is False
    assert not any(k[0] == email_change.PENDING_COLLECTION for k in db.store)


def test_old_address_is_unsubscribed_and_dequeued(zoho):
    db = FakeDB()
    db.collection("users").document("1").set({"email": "new@x.dk"})
    assert email_change.record_email_change(db, "1", "Old@x.dk", "new@x.dk")
    stats = email_change.process_pending_unsubscribes(db)
    assert stats["unsubscribed"] == 1
    assert _unsubscribed(zoho) == ["Old@x.dk"]
    assert not any(k[0] == email_change.PENDING_COLLECTION for k in db.store)


def test_address_still_used_by_another_rider_is_kept(zoho):
    db = FakeDB()
    db.collection("users").document("2").set({"email": "shared@x.dk"})
    email_change.record_email_change(db, "1", "shared@x.dk", "new@x.dk")
    stats = email_change.process_pending_unsubscribes(db)
    assert stats["kept"] == 1
    assert _unsubscribed(zoho) == []
    assert not any(k[0] == email_change.PENDING_COLLECTION for k in db.store)


def test_campaign_recipient_is_kept(zoho):
    db = FakeDB()
    email_change.record_email_change(db, "1", "manual@x.dk", "new@x.dk")
    email_change.process_pending_unsubscribes(db, keep=["MANUAL@x.dk"])
    assert _unsubscribed(zoho) == []


def test_failure_stays_queued_then_gives_up(zoho):
    db = FakeDB()
    zoho.fail_for.add("old@x.dk")
    email_change.record_email_change(db, "1", "old@x.dk", "new@x.dk")
    for attempt in range(1, email_change.MAX_ATTEMPTS):
        stats = email_change.process_pending_unsubscribes(db)
        assert stats["failed"] == 1
        pending = [v[0] for k, v in db.store.items() if k[0] == email_change.PENDING_COLLECTION]
        assert pending[0]["attempts"] == attempt
    stats = email_change.process_pending_unsubscribes(db)
    assert stats["dropped"] == 1
    assert not any(k[0] == email_change.PENDING_COLLECTION for k in db.store)


def test_try_process_never_raises(monkeypatch):
    def boom(*_a, **_k):
        raise EmailSendError("zoho down")

    monkeypatch.setattr(email_change, "process_pending_unsubscribes", boom)
    assert email_change.try_process_pending_unsubscribes(FakeDB()) is None


# --- Email change through the verify endpoint ----------------------------------


def test_changing_email_unsubscribes_the_old_address(zoho, monkeypatch):
    from flask import Flask
    from services import email_verification, zwift_tokens

    db = FakeDB()
    monkeypatch.setattr(profile_routes, "db", db)
    monkeypatch.setattr(zwift_tokens, "db", db)
    monkeypatch.setattr(profile_routes, "verify_user_token", lambda _r: {"uid": "google-uid"})
    sent = []
    monkeypatch.setattr(profile_routes, "send_plain_email", lambda **kw: sent.append(kw))
    db.collection("auth_mappings").document("google-uid").set({"zwiftId": "7"})
    db.collection("users").document("7").set({"email": "old.google@x.dk", "registration": {"status": "complete"}})

    app = Flask(__name__)
    with app.test_request_context("/profile/email/send-code", method="POST", json={"email": "new@x.dk"}):
        _, status = profile_routes.send_email_verification_code()
    assert status == 200
    code = re.search(r"\b(\d{6})\b", sent[0]["message"]).group(1)
    with app.test_request_context("/profile/email/verify", method="POST", json={"code": code}):
        _, status = profile_routes.verify_email_code()
    assert status == 200

    user = db.doc("users", "7")
    assert user["email"] == "new@x.dk" and user["emailVerified"] is True
    assert _unsubscribed(zoho) == ["old.google@x.dk"]
    assert not any(k[0] == email_change.PENDING_COLLECTION for k in db.store)
    assert email_verification  # imported for clarity of the flow under test


def test_signup_keeps_the_changed_email_over_the_google_token(monkeypatch):
    from services import zwift_tokens

    db = FakeDB()
    monkeypatch.setattr(profile_routes, "db", db)
    monkeypatch.setattr(zwift_tokens, "db", db)
    db.collection("auth_mappings").document("google-uid").set({"zwiftId": "7"})
    db.collection("users").document("7").set({"email": "new@x.dk", "emailVerified": True})
    assert profile_routes._signup_email("google-uid", {"email": "old.google@x.dk"}) == "new@x.dk"
