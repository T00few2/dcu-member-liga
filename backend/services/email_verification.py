"""Email verification by 6-digit code.

Riders who sign in with Zwift have no email from their login provider (the
Zwift API does not expose one), so they enter an address during registration
and confirm it with a code sent via the existing Zoho SMTP sender.

The email is contact data only (the account is identified by Zwift ID), so it
is stored on the ``users`` doc and not on the Firebase Auth user, and does not
have to be unique.
"""

from __future__ import annotations

import datetime
import hashlib
import hmac
import re
import secrets
from typing import Any, Callable

VERIFICATIONS_COLLECTION = "email_verifications"
CODE_TTL_SECONDS = 15 * 60
RESEND_COOLDOWN_SECONDS = 60
MAX_SENDS_PER_HOUR = 5
MAX_ATTEMPTS = 5

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class EmailVerificationError(Exception):
    def __init__(self, code: str, message: str, status_code: int = 400, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def normalize_email(raw: Any) -> str:
    email = str(raw or "").strip().lower()
    if len(email) > 254 or not EMAIL_PATTERN.match(email):
        raise EmailVerificationError("invalid_email", "Ugyldig email-adresse.")
    return email


def _hash_code(uid: str, code: str) -> str:
    return hashlib.sha256(f"{uid}:{code}".encode("utf-8")).hexdigest()


def _generate_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _email_body(code: str) -> str:
    return (
        "Hej\n\n"
        f"Din bekræftelseskode til DCU Member Liga er: {code}\n\n"
        "Koden udløber om 15 minutter. Hvis du ikke har bedt om koden, kan du se bort fra denne email.\n\n"
        "Venlig hilsen\nDCU Member Liga"
    )


def send_code(db, uid: str, raw_email: Any, send_email: Callable[..., None]) -> dict:
    """Create a code for ``uid`` and email it. Returns ``{email, expiresInSeconds}``.

    ``send_email`` is ``utils.email_sender.send_plain_email`` (injected for tests);
    its EmailConfigError / EmailSendError propagate to the caller.
    """
    email = normalize_email(raw_email)
    now = _utcnow()
    ref = db.collection(VERIFICATIONS_COLLECTION).document(uid)
    snap = ref.get()
    prev = (snap.to_dict() or {}) if snap.exists else {}

    last_sent = prev.get("lastSentAt")
    if isinstance(last_sent, datetime.datetime):
        wait = RESEND_COOLDOWN_SECONDS - int((now - last_sent).total_seconds())
        if wait > 0:
            raise EmailVerificationError(
                "cooldown", f"Vent {wait} sekunder før du beder om en ny kode.", 429, retry_after=wait
            )

    window_start = prev.get("sendWindowStart")
    send_count = int(prev.get("sendCount") or 0)
    if not isinstance(window_start, datetime.datetime) or (now - window_start).total_seconds() >= 3600:
        window_start = now
        send_count = 0
    if send_count >= MAX_SENDS_PER_HOUR:
        retry = 3600 - int((now - window_start).total_seconds())
        raise EmailVerificationError(
            "too_many_sends", "For mange koder sendt. Prøv igen senere.", 429, retry_after=max(retry, 1)
        )

    code = _generate_code()
    send_email(
        to_email=email,
        subject="Din bekræftelseskode til DCU Member Liga",
        message=_email_body(code),
    )

    ref.set({
        "email": email,
        "codeHash": _hash_code(uid, code),
        "expiresAt": now + datetime.timedelta(seconds=CODE_TTL_SECONDS),
        "attempts": 0,
        "lastSentAt": now,
        "sendWindowStart": window_start,
        "sendCount": send_count + 1,
    })
    return {"email": email, "expiresInSeconds": CODE_TTL_SECONDS}


def verify_code(db, uid: str, raw_code: Any) -> str:
    """Check ``raw_code`` for ``uid``. Returns the verified email address.

    The caller writes the email to the user doc; this function deletes the
    pending verification on success.
    """
    code = re.sub(r"\s+", "", str(raw_code or ""))
    if not re.fullmatch(r"\d{6}", code):
        raise EmailVerificationError("invalid_code", "Koden skal være 6 cifre.")

    ref = db.collection(VERIFICATIONS_COLLECTION).document(uid)
    snap = ref.get()
    if not snap.exists:
        raise EmailVerificationError("no_pending", "Der er ingen aktiv kode. Bed om en ny kode.")
    data = snap.to_dict() or {}

    expires_at = data.get("expiresAt")
    if not isinstance(expires_at, datetime.datetime) or expires_at <= _utcnow():
        raise EmailVerificationError("expired", "Koden er udløbet. Bed om en ny kode.")

    attempts = int(data.get("attempts") or 0)
    if attempts >= MAX_ATTEMPTS:
        raise EmailVerificationError("too_many_attempts", "For mange forkerte forsøg. Bed om en ny kode.", 429)

    if not hmac.compare_digest(str(data.get("codeHash") or ""), _hash_code(uid, code)):
        ref.update({"attempts": attempts + 1})
        remaining = MAX_ATTEMPTS - attempts - 1
        raise EmailVerificationError("wrong_code", f"Forkert kode. {remaining} forsøg tilbage.")

    email = str(data.get("email") or "")
    ref.delete()
    return email
