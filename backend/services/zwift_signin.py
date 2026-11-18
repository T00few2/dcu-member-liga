"""Sign in with Zwift: map a Zwift account to a Firebase Auth user.

The Zwift ID (numeric profile ``id``) is the rider identity. A rider who already
has an account (e.g. registered with Google) keeps their existing Firebase uid;
everyone else gets the deterministic uid ``zwift_<zwiftId>``.

After the Zwift OAuth callback the backend stores a short-lived one-time login
code and redirects the browser to the frontend with it. The frontend exchanges
the code for a Firebase custom token (``/auth/zwift/exchange``) and calls
``signInWithCustomToken``. The custom token itself never appears in a URL.
"""

from __future__ import annotations

import datetime
import logging
import secrets
from dataclasses import dataclass
from typing import Any

from firebase_admin import auth

logger = logging.getLogger(__name__)

LOGIN_CODES_COLLECTION = "zwift_login_codes"
LOGIN_CODE_TTL_SECONDS = 120
ZWIFT_UID_PREFIX = "zwift_"


class ZwiftSigninError(Exception):
    """Raised when a Zwift sign-in cannot be completed. ``code`` is shown to the frontend."""

    def __init__(self, code: str, message: str = "") -> None:
        super().__init__(message or code)
        self.code = code


@dataclass(frozen=True)
class SigninAccount:
    uid: str
    zwift_id: str
    user_doc_ref: Any
    is_new_auth_user: bool


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def zwift_uid_for(zwift_id: str) -> str:
    return f"{ZWIFT_UID_PREFIX}{zwift_id}"


def _display_name(profile: dict) -> str | None:
    name = " ".join(
        part.strip() for part in (profile.get("firstName"), profile.get("lastName")) if isinstance(part, str) and part.strip()
    )
    return name or None


def _find_existing_user_doc(db, zwift_id: str):
    """Return the snapshot of the rider's users doc, or None.

    Registered riders are keyed by Zwift ID. A rider who connected Zwift from a
    Google login but never finished registration may still have a doc keyed by
    their Google uid with a ``zwiftId`` field, so fall back to that.
    """
    snap = db.collection("users").document(zwift_id).get()
    if snap.exists:
        return snap
    for doc in db.collection("users").where("zwiftId", "==", zwift_id).limit(1).stream():
        return doc
    return None


def resolve_signin_account(db, profile: dict) -> SigninAccount:
    """Find or create the Firebase Auth user for this Zwift profile."""
    raw_id = profile.get("id")
    zwift_id = str(raw_id).strip() if raw_id is not None else ""
    if not zwift_id.isdigit():
        raise ZwiftSigninError("missing_zwift_id", "Zwift profile did not include a numeric id")

    existing = _find_existing_user_doc(db, zwift_id)
    existing_data = (existing.to_dict() or {}) if existing is not None else {}
    existing_uid = str(existing_data.get("authUid") or "").strip()

    if existing is not None:
        user_doc_ref = existing.reference
    else:
        user_doc_ref = db.collection("users").document(zwift_id)

    uid = existing_uid or zwift_uid_for(zwift_id)

    is_new = False
    try:
        auth.get_user(uid)
    except auth.UserNotFoundError:
        if existing_uid:
            # The doc points at a Firebase user that no longer exists (deleted
            # account). Recreate it under the same uid so data stays linked.
            logger.warning("authUid %s on users/%s has no Firebase user; recreating", uid, user_doc_ref.id)
        kwargs: dict[str, Any] = {"uid": uid}
        name = _display_name(profile)
        if name:
            kwargs["display_name"] = name
        auth.create_user(**kwargs)
        is_new = True

    return SigninAccount(uid=uid, zwift_id=zwift_id, user_doc_ref=user_doc_ref, is_new_auth_user=is_new)


def create_login_code(db, uid: str, intent: str | None) -> str:
    code = secrets.token_urlsafe(32)
    now = _utcnow()
    db.collection(LOGIN_CODES_COLLECTION).document(code).set({
        "uid": uid,
        "intent": intent if intent in ("login", "register") else None,
        "createdAt": now,
        "expiresAt": now + datetime.timedelta(seconds=LOGIN_CODE_TTL_SECONDS),
    })
    return code


def consume_login_code(db, code: str) -> dict:
    """Atomically consume a one-time login code. Returns ``{uid, intent}``.

    The delete carries a ``last_update_time`` precondition, so if two requests
    race for the same code only one delete succeeds.
    """
    if not code or not isinstance(code, str) or len(code) > 128:
        raise ZwiftSigninError("invalid_code")

    ref = db.collection(LOGIN_CODES_COLLECTION).document(code)
    snap = ref.get()
    if not snap.exists:
        raise ZwiftSigninError("invalid_code")

    data = snap.to_dict() or {}
    try:
        ref.delete(option=db.write_option(last_update_time=snap.update_time))
    except Exception as exc:  # precondition failed: someone else used it
        logger.warning("Zwift login code already consumed: %s", exc)
        raise ZwiftSigninError("invalid_code") from exc

    expires_at = data.get("expiresAt")
    if not isinstance(expires_at, datetime.datetime) or expires_at <= _utcnow():
        raise ZwiftSigninError("expired_code")

    uid = data.get("uid")
    if not uid:
        raise ZwiftSigninError("invalid_code")
    return {"uid": str(uid), "intent": data.get("intent")}


def mint_custom_token(uid: str) -> str:
    token = auth.create_custom_token(uid)
    return token.decode("utf-8") if isinstance(token, bytes) else str(token)


def has_non_zwift_login(uid: str) -> bool:
    """True if the Firebase user can log in some other way than Zwift (e.g. Google)."""
    try:
        record = auth.get_user(uid)
    except Exception as exc:
        logger.warning("Could not load Firebase user %s: %s", uid, exc)
        # Fail open on lookup errors only for non-Zwift uids.
        return not uid.startswith(ZWIFT_UID_PREFIX)
    return bool(record.provider_data)
