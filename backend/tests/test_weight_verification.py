"""Tests for weigh-in date validity window and sampling skip helpers."""
from __future__ import annotations

import os
import sys
from datetime import date, timedelta
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from pydantic import ValidationError  # noqa: E402

from services.request_models import SubmitVerificationRequest  # noqa: E402
from services.weight_verification import (  # noqa: E402
    DEFAULT_WEIGHT_VERIFICATION_VALID_DAYS,
    WeightSubmitError,
    apply_review_weigh_in_date,
    choose_weight_verification_for_race,
    effective_weigh_in_date,
    has_valid_approved_weigh_in,
    is_date_in_approval_window,
    load_weight_verification_valid_days,
    parse_weigh_in_date,
    prepare_weight_submit,
    should_skip_weight_sampling,
)


def test_parse_weigh_in_date() -> None:
    assert parse_weigh_in_date("2026-05-01") == date(2026, 5, 1)
    assert parse_weigh_in_date("not-a-date") is None
    assert parse_weigh_in_date("") is None


def test_window_covers_weigh_in_and_valid_days() -> None:
    weigh_in = date(2026, 5, 1)
    assert is_date_in_approval_window(date(2026, 5, 1), weigh_in, 30) is True
    assert is_date_in_approval_window(date(2026, 5, 31), weigh_in, 30) is True
    assert is_date_in_approval_window(date(2026, 6, 1), weigh_in, 30) is False
    assert is_date_in_approval_window(date(2026, 4, 30), weigh_in, 30) is False


def test_has_valid_approved_skips_expired_and_legacy_fallback() -> None:
    today = date(2026, 6, 10)
    requests = [
        {
            "status": "approved",
            "reviewedAt": "2026-04-01T12:00:00+00:00",
        }
    ]
    assert has_valid_approved_weigh_in(requests, as_of=today, valid_days=30) is False

    requests.append(
        {
            "status": "approved",
            "weighInDate": (today - timedelta(days=10)).isoformat(),
        }
    )
    assert has_valid_approved_weigh_in(requests, as_of=today, valid_days=30) is True


def test_effective_weigh_in_prefers_explicit_date() -> None:
    req = {
        "weighInDate": "2026-05-02",
        "reviewedAt": "2026-05-10T00:00:00+00:00",
        "submittedAt": "2026-05-09T00:00:00+00:00",
    }
    assert effective_weigh_in_date(req) == date(2026, 5, 2)


def test_load_valid_days_defaults() -> None:
    db = MagicMock()
    snap = MagicMock()
    snap.exists = True
    snap.to_dict.return_value = {}
    db.collection.return_value.document.return_value.get.return_value = snap
    assert load_weight_verification_valid_days(db) == DEFAULT_WEIGHT_VERIFICATION_VALID_DAYS

    snap.to_dict.return_value = {"weightVerificationValidDays": 14}
    assert load_weight_verification_valid_days(db) == 14


def test_submit_pending_sampled() -> None:
    status, current, history = prepare_weight_submit(
        status="pending",
        current_request={"requestId": "r1", "type": "weight", "status": "pending"},
        history=[{"requestId": "r1", "type": "weight", "status": "pending"}],
        video_link="https://youtube.com/watch?v=abc",
        weigh_in_date="2026-05-01",
        now_iso="2026-05-02T10:00:00+00:00",
        today=date(2026, 5, 2),
    )
    assert status == "submitted"
    assert current["weighInDate"] == "2026-05-01"
    assert current["source"] == "sampled"
    assert history[0]["status"] == "submitted"


def test_submit_voluntary_from_none() -> None:
    status, current, history = prepare_weight_submit(
        status="none",
        current_request=None,
        history=[],
        video_link="https://youtube.com/watch?v=abc",
        weigh_in_date="2026-05-01",
        now_iso="2026-05-02T10:00:00+00:00",
        today=date(2026, 5, 2),
    )
    assert status == "submitted"
    assert current["source"] == "voluntary"
    assert current["weighInDate"] == "2026-05-01"
    assert len(history) == 1


def test_submit_rejects_while_submitted() -> None:
    try:
        prepare_weight_submit(
            status="submitted",
            current_request={"status": "submitted"},
            history=[],
            video_link="https://youtube.com/watch?v=abc",
            weigh_in_date="2026-05-01",
            now_iso="2026-05-02T10:00:00+00:00",
            today=date(2026, 5, 2),
        )
        raise AssertionError("expected WeightSubmitError")
    except WeightSubmitError as exc:
        assert "awaiting review" in str(exc)


def test_submit_rejects_missing_or_future_weigh_in_date() -> None:
    try:
        SubmitVerificationRequest(videoLink="https://x.com", weighInDate="")
        raise AssertionError("expected ValidationError")
    except ValidationError:
        pass

    try:
        prepare_weight_submit(
            status="none",
            current_request=None,
            history=[],
            video_link="https://youtube.com/watch?v=abc",
            weigh_in_date="2099-01-01",
            now_iso="2026-05-02T10:00:00+00:00",
            today=date(2026, 5, 2),
        )
        raise AssertionError("expected WeightSubmitError")
    except WeightSubmitError as exc:
        assert "future" in str(exc).lower()


def test_sampling_skip_uses_weigh_in_window() -> None:
    today = date(2026, 6, 10)
    fresh = [{"status": "approved", "weighInDate": (today - timedelta(days=10)).isoformat()}]
    stale = [{"status": "approved", "weighInDate": (today - timedelta(days=40)).isoformat()}]
    assert should_skip_weight_sampling("approved", fresh, as_of=today, valid_days=30) is True
    assert should_skip_weight_sampling("none", stale, as_of=today, valid_days=30) is False
    assert should_skip_weight_sampling("pending", stale, as_of=today, valid_days=30) is True
    assert should_skip_weight_sampling("submitted", [], as_of=today, valid_days=30) is True


def test_admin_overwrite_weigh_in_changes_window() -> None:
    req = {"status": "approved", "weighInDate": "2026-04-01"}
    assert is_date_in_approval_window(date(2026, 6, 10), effective_weigh_in_date(req), 30) is False
    apply_review_weigh_in_date(req, "2026-06-01")
    assert is_date_in_approval_window(date(2026, 6, 10), effective_weigh_in_date(req), 30) is True


def test_results_badge_window_and_race_scoped() -> None:
    requests = [
        {
            "status": "approved",
            "weighInDate": "2026-05-01",
            "raceId": None,
            "requestId": "vol",
        }
    ]
    inside = choose_weight_verification_for_race(
        requests,
        race_id="race-b",
        race_date=date(2026, 5, 20),
        is_finisher=True,
        valid_days=30,
    )
    after = choose_weight_verification_for_race(
        requests,
        race_id="race-c",
        race_date=date(2026, 6, 10),
        is_finisher=True,
        valid_days=30,
    )
    assert inside is not None and inside["status"] == "approved"
    assert inside["matchSource"] == "validity_window"
    assert after is None

    race_scoped = [
        {
            "status": "rejected",
            "weighInDate": "2026-05-01",
            "raceId": "race-b",
            "requestId": "sample",
        }
    ]
    scoped = choose_weight_verification_for_race(
        race_scoped,
        race_id="race-b",
        race_date=date(2026, 5, 20),
        is_finisher=True,
        valid_days=30,
    )
    assert scoped is not None and scoped["status"] == "rejected"
    assert scoped["requestId"] == "sample"
