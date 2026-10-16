"""Send an admin mailing through the Zoho Campaigns API (EU).

Each selected address becomes a contact on a new list. Campaigns then delivers
one personal email per contact. The HTML is published briefly at a public URL
because createCampaign only accepts content_url.
"""

from __future__ import annotations

import json
import logging
import re
import secrets
import time
from datetime import datetime, timedelta, timezone
from typing import Protocol

import requests

from config import (
    BACKEND_URL,
    ZOHO_CAMPAIGNS_CLIENT_ID,
    ZOHO_CAMPAIGNS_CLIENT_SECRET,
    ZOHO_CAMPAIGNS_FROM_EMAIL,
    ZOHO_CAMPAIGNS_REFRESH_TOKEN,
    ZOHO_CAMPAIGNS_TOPIC_ID,
)
from utils.email_sender import EmailConfigError, EmailSendError

logger = logging.getLogger(__name__)

CAMPAIGNS_API_BASE = "https://campaigns.zoho.eu/api/v1.1"
ACCOUNTS_TOKEN_URL = "https://accounts.zoho.eu/oauth/v2/token"
FROM_NAME = "DCU Udvalg for e-cykling"
CONTENT_COLLECTION = "campaign_content"
BULK_SUBSCRIBE_BATCH = 10
CONTENT_TTL = timedelta(hours=1)
HTTP_TIMEOUT_SECONDS = 30
MAX_HTML_CHARS = 300_000

_access_token: str | None = None
_access_token_expiry = 0.0


class CampaignContentStore(Protocol):
    def put(self, token: str, html: str, expires_at: str) -> None: ...

    def get(self, token: str) -> str | None: ...

    def delete(self, token: str) -> None: ...


class MemoryCampaignContentStore:
    def __init__(self) -> None:
        self.docs: dict[str, dict[str, str]] = {}

    def put(self, token: str, html: str, expires_at: str) -> None:
        self.docs[token] = {"html": html, "expiresAt": expires_at}

    def get(self, token: str) -> str | None:
        doc = self.docs.get(token)
        if not doc:
            return None
        if doc["expiresAt"] < datetime.now(timezone.utc).isoformat():
            return None
        return doc["html"]

    def delete(self, token: str) -> None:
        self.docs.pop(token, None)


class FirestoreCampaignContentStore:
    def put(self, token: str, html: str, expires_at: str) -> None:
        from extensions import db

        db.collection(CONTENT_COLLECTION).document(token).set({
            "html": html,
            "createdAt": datetime.now(timezone.utc).isoformat(),
            "expiresAt": expires_at,
        })

    def get(self, token: str) -> str | None:
        from extensions import db

        snap = db.collection(CONTENT_COLLECTION).document(token).get()
        if not snap.exists:
            return None
        data = snap.to_dict() or {}
        expires_at = str(data.get("expiresAt") or "")
        if expires_at and expires_at < datetime.now(timezone.utc).isoformat():
            return None
        html = data.get("html")
        return str(html) if html else None

    def delete(self, token: str) -> None:
        from extensions import db

        db.collection(CONTENT_COLLECTION).document(token).delete()


def clear_access_token_cache() -> None:
    global _access_token, _access_token_expiry
    _access_token = None
    _access_token_expiry = 0.0


def _require_config() -> None:
    missing = [
        name
        for name, value in (
            ("ZOHO_CAMPAIGNS_CLIENT_ID", ZOHO_CAMPAIGNS_CLIENT_ID),
            ("ZOHO_CAMPAIGNS_CLIENT_SECRET", ZOHO_CAMPAIGNS_CLIENT_SECRET),
            ("ZOHO_CAMPAIGNS_REFRESH_TOKEN", ZOHO_CAMPAIGNS_REFRESH_TOKEN),
            ("ZOHO_CAMPAIGNS_FROM_EMAIL", ZOHO_CAMPAIGNS_FROM_EMAIL),
        )
        if not value
    ]
    if missing:
        raise EmailConfigError(
            "Zoho Campaigns is not configured. Missing " + ", ".join(missing) + "."
        )


def _unwrap(payload: dict) -> dict:
    nested = payload.get("response")
    if isinstance(nested, dict) and "code" not in payload and "listkey" not in payload:
        return nested
    return payload


def _raise_if_failed(payload: dict, action: str) -> dict:
    body = _unwrap(payload)
    if "error" in body and "access_token" not in body and "code" not in body:
        raise EmailConfigError(f"Zoho Campaigns {action} failed: {body.get('error')}")
    code = body.get("code")
    status = str(body.get("status") or "").lower()
    if status == "success" or str(code) in {"0", "200"} or code in {0, 200}:
        return body
    if code is None and not body.get("message"):
        return body
    message = str(body.get("message") or body.get("error") or f"Zoho Campaigns {action} failed.")
    raise EmailSendError(message)


def _response_snippet(text: str, limit: int = 180) -> str:
    cleaned = re.sub(r"<[^>]+>", " ", text or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    if len(cleaned) > limit:
        cleaned = cleaned[:limit].rstrip() + "..."
    return cleaned or "empty body"


def _post_form(url: str, fields: dict, *, token: str | None = None, query: bool = False) -> dict:
    headers = {}
    if token:
        headers["Authorization"] = f"Zoho-oauthtoken {token}"
    request_kwargs = {"headers": headers, "timeout": HTTP_TIMEOUT_SECONDS}
    # List calls accept a query string. createCampaign must be a form body:
    # the same fields on the query string make Zoho return an HTML 500.
    if query:
        request_kwargs["params"] = fields
    else:
        request_kwargs["data"] = fields
    try:
        response = requests.post(url, **request_kwargs)
    except requests.RequestException as exc:
        raise EmailSendError(f"Network error talking to Zoho Campaigns: {exc}") from exc

    try:
        payload = response.json()
    except ValueError as exc:
        snippet = _response_snippet(response.text)
        raise EmailSendError(
            f"Zoho Campaigns returned a non-JSON response ({response.status_code}): {snippet}"
        ) from exc
    if not isinstance(payload, dict):
        raise EmailSendError("Zoho Campaigns returned an unexpected response.")
    if response.status_code >= 400:
        body = _unwrap(payload)
        message = str(body.get("message") or body.get("error") or response.text)
        raise EmailSendError(f"Zoho Campaigns request failed: {message}")
    return payload


def _access_token_value() -> str:
    global _access_token, _access_token_expiry
    now = time.time()
    if _access_token and now < _access_token_expiry:
        return _access_token

    payload = _post_form(
        ACCOUNTS_TOKEN_URL,
        {
            "grant_type": "refresh_token",
            "client_id": ZOHO_CAMPAIGNS_CLIENT_ID,
            "client_secret": ZOHO_CAMPAIGNS_CLIENT_SECRET,
            "refresh_token": ZOHO_CAMPAIGNS_REFRESH_TOKEN,
        },
    )
    if payload.get("error") or not payload.get("access_token"):
        detail = payload.get("error") or "no access token returned"
        raise EmailConfigError(f"Zoho Campaigns authentication failed: {detail}")
    _access_token = str(payload["access_token"])
    expires_in = int(payload.get("expires_in") or 3600)
    _access_token_expiry = now + max(expires_in - 60, 30)
    return _access_token


def _campaign_post(path: str, fields: dict, token: str, *, query: bool = True) -> dict:
    payload = _post_form(f"{CAMPAIGNS_API_BASE}/{path}", fields, token=token, query=query)
    return _raise_if_failed(payload, path)


def _campaign_get(path: str, token: str) -> dict:
    headers = {"Authorization": f"Zoho-oauthtoken {token}"}
    try:
        response = requests.get(
            f"{CAMPAIGNS_API_BASE}/{path}",
            params={"resfmt": "JSON"},
            headers=headers,
            timeout=HTTP_TIMEOUT_SECONDS,
        )
    except requests.RequestException as exc:
        raise EmailSendError(f"Network error talking to Zoho Campaigns: {exc}") from exc
    try:
        payload = response.json()
    except ValueError as exc:
        snippet = _response_snippet(response.text)
        raise EmailSendError(
            f"Zoho Campaigns returned a non-JSON response ({response.status_code}): {snippet}"
        ) from exc
    if not isinstance(payload, dict):
        raise EmailSendError("Zoho Campaigns returned an unexpected response.")
    body = _unwrap(payload)
    code = str(body.get("code") or body.get("Code") or "")
    if code == "1004":
        return {}
    return _raise_if_failed(payload, path)


def _topic_id(token: str) -> str | None:
    if ZOHO_CAMPAIGNS_TOPIC_ID:
        return ZOHO_CAMPAIGNS_TOPIC_ID
    payload = _campaign_get("topics", token)
    details = payload.get("topicDetails") or []
    if not isinstance(details, list) or not details:
        return None
    topic_ids = [str(item.get("topicId") or "") for item in details if isinstance(item, dict)]
    topic_ids = [item for item in topic_ids if item]
    if len(topic_ids) == 1:
        return topic_ids[0]
    names = []
    for item in details:
        if not isinstance(item, dict):
            continue
        names.append(str(item.get("topicName") or item.get("topicId") or ""))
    visible = ", ".join(name for name in names if name)
    raise EmailSendError(
        "Zoho Campaigns has more than one topic. Set ZOHO_CAMPAIGNS_TOPIC_ID to one of: "
        + visible
    )


def _field(payload: dict, *names: str) -> str:
    for name in names:
        value = payload.get(name)
        if value:
            return str(value)
    return ""


def send_zoho_campaign(
    *,
    recipients: list[str],
    subject: str,
    html_body: str,
    store: CampaignContentStore | None = None,
) -> dict[str, str]:
    """Create a list, import the HTML, and send. Returns campaign key and status."""
    _require_config()
    addresses = []
    seen: set[str] = set()
    for raw in recipients:
        address = (raw or "").strip()
        key = address.lower()
        if not address or key in seen:
            continue
        seen.add(key)
        addresses.append(address)
    if not addresses:
        raise EmailSendError("At least one recipient is required.")
    subject = subject.strip()
    if not subject:
        raise EmailSendError("Email subject is required.")
    html_body = html_body.strip()
    if not html_body:
        raise EmailSendError("Email message is required.")
    if len(html_body) > MAX_HTML_CHARS:
        raise EmailSendError("Email message is too long for Zoho Campaigns.")

    content_store = store or FirestoreCampaignContentStore()
    token = _access_token_value()
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    suffix = secrets.token_hex(3)
    first_batch = addresses[:BULK_SUBSCRIBE_BATCH]
    list_body = _campaign_post(
        "addlistandcontacts",
        {
            "resfmt": "JSON",
            "listname": f"Liga {stamp} {suffix}",
            "signupform": "private",
            "mode": "newlist",
            "emailids": ",".join(first_batch),
        },
        token,
    )
    listkey = _field(list_body, "listkey", "listKey")
    if not listkey:
        raise EmailSendError("Zoho Campaigns did not return a mailing list key.")

    rest = addresses[BULK_SUBSCRIBE_BATCH:]
    for start in range(0, len(rest), BULK_SUBSCRIBE_BATCH):
        batch = rest[start:start + BULK_SUBSCRIBE_BATCH]
        _campaign_post(
            "addlistsubscribersinbulk",
            {
                "resfmt": "JSON",
                "listkey": listkey,
                "emailids": ",".join(batch),
            },
            token,
        )

    content_token = secrets.token_urlsafe(32)
    expires_at = (datetime.now(timezone.utc) + CONTENT_TTL).isoformat()
    content_store.put(content_token, html_body, expires_at)
    content_url = f"{BACKEND_URL.rstrip('/')}/campaign-content/{content_token}"
    try:
        create_fields = {
            "resfmt": "JSON",
            "campaignname": f"{subject} {stamp}"[:150],
            "from_email": ZOHO_CAMPAIGNS_FROM_EMAIL,
            "from_name": FROM_NAME,
            "subject": subject,
            "content_url": content_url,
            "list_details": json.dumps({listkey: []}, separators=(",", ":")),
        }
        topic_id = _topic_id(token)
        if topic_id:
            create_fields["topicId"] = topic_id
        created = _campaign_post("createCampaign", create_fields, token, query=False)
        campaign_key = _field(created, "campaignkey", "campaign_key", "campaignKey")
        if not campaign_key:
            raise EmailSendError("Zoho Campaigns did not return a campaign key.")
        sent = _campaign_post(
            "sendcampaign",
            {"resfmt": "JSON", "campaignkey": campaign_key},
            token,
        )
        status = _field(sent, "campaign_status", "campaignStatus") or "inprogress"
        logger.info(
            "Zoho Campaigns send accepted: key=%s status=%s recipients=%d subject=%r",
            campaign_key,
            status,
            len(addresses),
            subject,
        )
        return {"campaignKey": campaign_key, "campaignStatus": status}
    finally:
        try:
            content_store.delete(content_token)
        except Exception:
            logger.warning("Failed to delete campaign content %s", content_token, exc_info=True)
