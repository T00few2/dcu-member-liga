"""Weight-video validity window helpers (weigh-in date + league validDays)."""
from __future__ import annotations

import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Any, Callable

import pytz

DEFAULT_WEIGHT_VERIFICATION_VALID_DAYS = 30
_COPENHAGEN_TZ = pytz.timezone("Europe/Copenhagen")


def load_weight_verification_valid_days(db: Any) -> int:
    try:
        snap = db.collection("league").document("settings").get()
        settings = snap.to_dict() if snap.exists else {}
        raw = (settings or {}).get("weightVerificationValidDays")
        days = int(raw)
        if days >= 1:
            return days
    except Exception:
        pass
    return DEFAULT_WEIGHT_VERIFICATION_VALID_DAYS


def copenhagen_today() -> date:
    return datetime.now(_COPENHAGEN_TZ).date()


def parse_weigh_in_date(value: Any) -> date | None:
    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        return date.fromisoformat(raw[:10])
    except ValueError:
        return None


def parse_calendar_date(value: Any) -> date | None:
    """Parse a timestamp or date string as a Copenhagen calendar date."""
    weighed = parse_weigh_in_date(value)
    if weighed and len(str(value or "").strip()) == 10:
        return weighed

    if isinstance(value, datetime):
        dt = value
        if dt.tzinfo is None:
            dt = _COPENHAGEN_TZ.localize(dt)
        return dt.astimezone(_COPENHAGEN_TZ).date()

    if hasattr(value, "timestamp") and callable(value.timestamp):
        try:
            dt = datetime.fromtimestamp(value.timestamp(), tz=timezone.utc)
            return dt.astimezone(_COPENHAGEN_TZ).date()
        except Exception:
            pass

    raw = str(value or "").strip()
    if not raw:
        return None
    try:
        if raw.endswith("Z"):
            raw = raw.replace("Z", "+00:00")
        dt = datetime.fromisoformat(raw)
        if dt.tzinfo is None:
            dt = _COPENHAGEN_TZ.localize(dt)
        return dt.astimezone(_COPENHAGEN_TZ).date()
    except Exception:
        return parse_weigh_in_date(value)


def effective_weigh_in_date(req: dict | None) -> date | None:
    if not isinstance(req, dict):
        return None
    weighed = parse_weigh_in_date(req.get("weighInDate"))
    if weighed:
        return weighed
    for key in ("reviewedAt", "submittedAt", "requestedAt"):
        parsed = parse_calendar_date(req.get(key))
        if parsed:
            return parsed
    return None


def is_date_in_approval_window(as_of: date, weigh_in: date, valid_days: int) -> bool:
    if valid_days < 1:
        valid_days = DEFAULT_WEIGHT_VERIFICATION_VALID_DAYS
    return weigh_in <= as_of <= weigh_in + timedelta(days=valid_days)


def valid_until_date(weigh_in: date, valid_days: int) -> date:
    if valid_days < 1:
        valid_days = DEFAULT_WEIGHT_VERIFICATION_VALID_DAYS
    return weigh_in + timedelta(days=valid_days)


def has_valid_approved_weigh_in(
    requests: list[dict[str, Any]] | None,
    *,
    as_of: date,
    valid_days: int,
) -> bool:
    for req in requests or []:
        if not isinstance(req, dict):
            continue
        if str(req.get("status") or "").strip().lower() != "approved":
            continue
        weigh_in = effective_weigh_in_date(req)
        if weigh_in and is_date_in_approval_window(as_of, weigh_in, valid_days):
            return True
    return False


def should_skip_weight_sampling(
    status: str | None,
    requests: list[dict[str, Any]] | None,
    *,
    as_of: date,
    valid_days: int,
) -> bool:
    if str(status or "").strip().lower() in ("pending", "submitted"):
        return True
    return has_valid_approved_weigh_in(requests, as_of=as_of, valid_days=valid_days)


class WeightSubmitError(ValueError):
    """Rider-facing submit rejection (already waiting, missing date, etc.)."""


def prepare_weight_submit(
    *,
    status: str | None,
    current_request: dict[str, Any] | None,
    history: list[dict[str, Any]] | None,
    video_link: str,
    weigh_in_date: str,
    now_iso: str,
    today: date,
) -> tuple[str, dict[str, Any], list[dict[str, Any]]]:
    """Return (new_status, current_request, history) for a rider video submit."""
    parsed = parse_weigh_in_date(weigh_in_date)
    if not parsed:
        raise WeightSubmitError("weighInDate must be YYYY-MM-DD")
    if parsed > today:
        raise WeightSubmitError("Weigh-in date cannot be in the future.")

    normalized = str(status or "none").strip().lower() or "none"
    if normalized == "submitted":
        raise WeightSubmitError("A verification is already awaiting review.")

    requests = [dict(req) for req in (history or []) if isinstance(req, dict)]
    current = dict(current_request) if isinstance(current_request, dict) else {}

    if normalized == "pending":
        found = False
        if current.get("status") == "pending":
            current["status"] = "submitted"
            current["videoLink"] = video_link
            current["weighInDate"] = weigh_in_date
            current["submittedAt"] = now_iso
            if not current.get("source"):
                current["source"] = "sampled"
            found = True

        updated: list[dict[str, Any]] = []
        for req in requests:
            if req.get("status") == "pending" and str(req.get("type") or "").strip().lower() == "weight":
                req["status"] = "submitted"
                req["videoLink"] = video_link
                req["weighInDate"] = weigh_in_date
                req["submittedAt"] = now_iso
                if not req.get("source"):
                    req["source"] = "sampled"
            updated.append(req)

        if not found and not any(r.get("status") == "submitted" for r in updated):
            raise WeightSubmitError("No pending verification request found.")
        return "submitted", current, updated

    if normalized not in ("none", "approved", "rejected", ""):
        raise WeightSubmitError("Cannot submit verification in the current state.")

    new_request = {
        "requestId": str(uuid.uuid4()),
        "requestedAt": now_iso,
        "type": "weight",
        "status": "submitted",
        "source": "voluntary",
        "videoLink": video_link,
        "weighInDate": weigh_in_date,
        "submittedAt": now_iso,
    }
    requests.append(new_request)
    return "submitted", new_request, requests


def apply_review_weigh_in_date(req: dict[str, Any], override: str | None) -> dict[str, Any]:
    if override:
        req["weighInDate"] = override
    return req


def choose_weight_verification_for_race(
    requests: list[dict[str, Any]] | None,
    *,
    race_id: str,
    race_date: date | None,
    is_finisher: bool,
    valid_days: int,
    sort_key: Callable[[dict[str, Any]], Any] | None = None,
) -> dict[str, Any] | None:
    """Pick the public badge row for a finisher of race ``race_id`` on ``race_date``.

    Race-scoped requests (explicit or inferred ``raceId``) win. Otherwise an
    approved weigh-in whose window covers the race date is used.
    """
    key_fn = sort_key or (lambda req: str(req.get("reviewedAt") or req.get("submittedAt") or req.get("requestedAt") or ""))
    race_scoped: dict[str, Any] | None = None
    window_approved: dict[str, Any] | None = None
    target = str(race_id)

    for req in requests or []:
        if not isinstance(req, dict):
            continue
        matched = str(req.get("raceId") or "").strip()
        if matched == target:
            if race_scoped is None or key_fn(req) >= key_fn(race_scoped):
                race_scoped = req
        if (
            is_finisher
            and race_date is not None
            and str(req.get("status") or "").strip().lower() == "approved"
        ):
            weigh_in = effective_weigh_in_date(req)
            if weigh_in and is_date_in_approval_window(race_date, weigh_in, valid_days):
                if window_approved is None or key_fn(req) >= key_fn(window_approved):
                    window_row = dict(req)
                    window_row["status"] = "approved"
                    window_row["matchSource"] = "validity_window"
                    window_approved = window_row

    return race_scoped or window_approved


def latest_approved_request(requests: list[dict[str, Any]] | None) -> dict[str, Any] | None:
    latest: dict[str, Any] | None = None
    latest_date: date | None = None
    for req in requests or []:
        if not isinstance(req, dict):
            continue
        if str(req.get("status") or "").strip().lower() != "approved":
            continue
        weigh_in = effective_weigh_in_date(req)
        if weigh_in is None:
            continue
        if latest_date is None or weigh_in > latest_date:
            latest = req
            latest_date = weigh_in
    return latest
