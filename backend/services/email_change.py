"""Keep Zoho Campaigns in step when a rider changes their contact email.

Large mailings go to the Zoho standing list, and a campaign only ever adds
contacts to it. So when a rider changes email, the old address is queued here
and unsubscribed from the standing list: right away when possible, and in any
case just before the next campaign is sent.

Emails are not unique (the account is the Zwift ID), so an address is only
unsubscribed while no rider uses it and it isn't among the campaign's own
recipients.
"""

from __future__ import annotations

import datetime
import hashlib
import logging
from typing import Iterable

from utils.email_sender import EmailConfigError, EmailSendError
from utils.zoho_campaigns import unsubscribe_from_standing_list

logger = logging.getLogger(__name__)

PENDING_COLLECTION = "zoho_pending_unsubscribes"
MAX_ATTEMPTS = 5


def _doc_id(email: str) -> str:
    return hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def _utcnow() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def record_email_change(db, user_doc_id: str, old_email: str | None, new_email: str) -> bool:
    """Queue the old address for removal from the standing list. Returns True if queued."""
    old = (old_email or "").strip()
    if not old or old.lower() == (new_email or "").strip().lower():
        return False
    db.collection(PENDING_COLLECTION).document(_doc_id(old)).set({
        "email": old,
        "userDocId": str(user_doc_id),
        "createdAt": _utcnow(),
        "attempts": 0,
    })
    return True


def _email_in_use(db, email: str) -> bool:
    variants = {email, email.lower()}
    for variant in variants:
        for _doc in db.collection("users").where("email", "==", variant).limit(1).stream():
            return True
    return False


def process_pending_unsubscribes(db, keep: Iterable[str] = ()) -> dict:
    """Unsubscribe queued old addresses from the standing list.

    ``keep``: addresses that must stay (e.g. this campaign's recipients).
    Returns counts. Zoho config errors are raised; per-address failures stay
    queued (up to MAX_ATTEMPTS).
    """
    keep_lower = {str(k).strip().lower() for k in keep if k}
    pending = list(db.collection(PENDING_COLLECTION).stream())
    stats = {"unsubscribed": 0, "kept": 0, "failed": 0, "dropped": 0}
    to_send: list[tuple[str, object]] = []
    for doc in pending:
        data = doc.to_dict() or {}
        email = str(data.get("email") or "").strip()
        if not email:
            doc.reference.delete()
            continue
        if email.lower() in keep_lower or _email_in_use(db, email):
            # Someone (still or again) uses this address: leave it subscribed.
            doc.reference.delete()
            stats["kept"] += 1
            continue
        to_send.append((email, doc))

    if not to_send:
        return stats

    done, failed = unsubscribe_from_standing_list([email for email, _ in to_send])
    done_lower = {d.lower() for d in done}
    for email, doc in to_send:
        if email.lower() in done_lower:
            doc.reference.delete()
            stats["unsubscribed"] += 1
            continue
        attempts = int((doc.to_dict() or {}).get("attempts") or 0) + 1
        if attempts >= MAX_ATTEMPTS:
            logger.error("Giving up unsubscribing %s from the Zoho standing list after %d attempts", email, attempts)
            doc.reference.delete()
            stats["dropped"] += 1
        else:
            doc.reference.update({"attempts": attempts, "lastAttemptAt": _utcnow()})
            stats["failed"] += 1
    return stats


def try_process_pending_unsubscribes(db, keep: Iterable[str] = ()) -> dict | None:
    """Best-effort wrapper: never raises (logs instead)."""
    try:
        return process_pending_unsubscribes(db, keep)
    except (EmailConfigError, EmailSendError) as exc:
        logger.warning("Zoho pending unsubscribes not processed: %s", exc)
    except Exception:
        logger.exception("Unexpected error processing Zoho pending unsubscribes")
    return None
