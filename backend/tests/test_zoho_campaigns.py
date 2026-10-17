"""Zoho Campaigns client: list, subscribe, content URL, create, and send."""

from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import utils.zoho_campaigns as campaigns  # noqa: E402
from utils.email_sender import EmailConfigError, EmailSendError  # noqa: E402
from utils.zoho_campaigns import MemoryCampaignContentStore, send_zoho_campaign  # noqa: E402


class _Response:
    def __init__(self, payload: dict, status_code: int = 200):
        self._payload = payload
        self.status_code = status_code
        self.text = str(payload)

    def json(self):
        return self._payload


@pytest.fixture(autouse=True)
def _credentials(monkeypatch):
    campaigns.clear_access_token_cache()
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_CLIENT_ID", "client-id")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_CLIENT_SECRET", "client-secret")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_REFRESH_TOKEN", "refresh-token")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_FROM_EMAIL", "info@example.com")
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_TOPIC_ID", None)
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_LIST_KEY", None)
    monkeypatch.setattr(campaigns, "BACKEND_URL", "https://api.example.com")


def _install_api(
    monkeypatch,
    store: MemoryCampaignContentStore,
    *,
    fail_create: bool = False,
    topics: list[dict] | None = None,
    subscribers: list[dict] | None = None,
    reject_email: str | None = None,
):
    calls: list[tuple[str, dict, str]] = []
    topic_rows = topics if topics is not None else [{"topicId": "topic-1", "topicName": "Marketing"}]

    def fake_get(url, params=None, headers=None, timeout=None):
        calls.append((url, dict(params or {}), "get"))
        if url.endswith("/topics"):
            return _Response({"code": "200", "topicDetails": topic_rows, "message": "Success"})
        if url.endswith("/getlistsubscribers"):
            return _Response({
                "code": "0",
                "status": "success",
                "list_of_details": list(subscribers or []),
            })
        raise AssertionError(url)

    def fake_post(url, data=None, params=None, headers=None, timeout=None):
        calls.append((url, dict(params or data or {}), "params" if params else "data"))
        if url.endswith("/oauth/v2/token"):
            return _Response({"access_token": "access-token", "expires_in": 3600})
        if url.endswith("/addlistandcontacts"):
            return _Response({"code": "0", "status": "success", "listkey": "list1", "message": "List created successfully"})
        if url.endswith("/addlistsubscribersinbulk"):
            return _Response({"code": "0", "status": "success", "message": "added"})
        if url.endswith("/listsubscribe"):
            fields = params or data or {}
            if reject_email and reject_email in str(fields.get("contactinfo") or ""):
                return _Response({
                    "code": "1001",
                    "status": "error",
                    "message": "Ugyldig e-mailadresse for kontakt.",
                })
            return _Response({"code": "0", "status": "success", "message": "updated"})
        if url.endswith("/createCampaign"):
            if fail_create:
                return _Response({"code": "1004", "message": "Invalid URL for content import."})
            fields = params or data or {}
            token = str(fields["content_url"]).rsplit("/", 1)[-1]
            assert store.get(token) == "<p>Hello riders</p>"
            return _Response({
                "code": "200",
                "campaignkey": "camp-1",
                "message": "Campaign created successfully",
            })
        if url.endswith("/sendcampaign"):
            return _Response({"code": "200", "campaign_status": "inprogress", "message": ""})
        raise AssertionError(url)

    monkeypatch.setattr(campaigns.requests, "get", fake_get)
    monkeypatch.setattr(campaigns.requests, "post", fake_post)
    return calls


def test_send_creates_list_publishes_html_and_sends(monkeypatch):
    store = MemoryCampaignContentStore()
    calls = _install_api(monkeypatch, store)

    result = send_zoho_campaign(
        recipients=[
            {"email": "Rider@Example.com", "first_name": "Christian"},
            "rider@example.com",
            {"email": "other@example.com"},
        ],
        subject="Liga update",
        html_body="<p>Hello riders</p>",
        store=store,
    )

    assert result == {"campaignKey": "camp-1", "campaignStatus": "inprogress"}
    assert store.docs == {}
    paths = [url.rsplit("/", 1)[-1] for url, _, _ in calls]
    assert paths == [
        "token",
        "topics",
        "addlistandcontacts",
        "listsubscribe",
        "listsubscribe",
        "createCampaign",
        "sendcampaign",
    ]
    created_list = calls[2][1]
    assert calls[2][2] == "params"
    assert created_list["emailids"] == "Rider@Example.com,other@example.com"
    assert created_list["mode"] == "newlist"
    subscribed = [fields["contactinfo"] for url, fields, _ in calls if url.endswith("/listsubscribe")]
    assert subscribed == [
        '{"Contact Email": "Rider@Example.com", "First Name": "Christian"}',
        '{"Contact Email": "other@example.com"}',
    ]
    assert calls[3][1]["topic_id"] == "topic-1"
    assert calls[3][2] == "data"
    created = calls[5][1]
    assert calls[5][2] == "data"
    assert created["from_email"] == "info@example.com"
    assert created["from_name"] == "DCU Udvalg for e-cykling"
    assert created["subject"] == "Liga update"
    assert created["topicId"] == "topic-1"
    assert created["list_details"] == "{list1:[]}"
    assert created["content_url"].startswith("https://api.example.com/campaign-content/")
    assert calls[2][0].startswith("https://campaigns.zoho.eu/api/v1.1/")
    assert calls[6][1]["campaignkey"] == "camp-1"


def test_create_error_is_email_send_error_and_content_is_removed(monkeypatch):
    store = MemoryCampaignContentStore()
    calls = _install_api(monkeypatch, store, fail_create=True)

    with pytest.raises(EmailSendError, match="Invalid URL for content import"):
        send_zoho_campaign(
            recipients=["rider@example.com"],
            subject="Liga update",
            html_body="<p>Hello riders</p>",
            store=store,
        )

    assert store.docs == {}
    assert [url.rsplit("/", 1)[-1] for url, _, _ in calls] == [
        "token",
        "topics",
        "addlistandcontacts",
        "listsubscribe",
        "createCampaign",
    ]


def test_configured_topic_is_sent_without_looking_topics_up(monkeypatch):
    store = MemoryCampaignContentStore()
    calls = _install_api(monkeypatch, store)
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_TOPIC_ID", "configured-topic")

    send_zoho_campaign(
        recipients=["rider@example.com"],
        subject="Liga update",
        html_body="<p>Hello riders</p>",
        store=store,
    )

    assert "topics" not in [url.rsplit("/", 1)[-1] for url, _, _ in calls]
    created = next(fields for url, fields, _ in calls if url.endswith("/createCampaign"))
    assert created["topicId"] == "configured-topic"


def test_multiple_topics_require_an_explicit_id(monkeypatch):
    store = MemoryCampaignContentStore()
    _install_api(
        monkeypatch,
        store,
        topics=[
            {"topicId": "topic-1", "topicName": "Marketing"},
            {"topicId": "topic-2", "topicName": "News"},
        ],
    )

    with pytest.raises(EmailSendError, match="ZOHO_CAMPAIGNS_TOPIC_ID"):
        send_zoho_campaign(
            recipients=["rider@example.com"],
            subject="Liga update",
            html_body="<p>Hello riders</p>",
            store=store,
        )

    assert store.docs == {}


def test_large_send_reuses_standing_list_and_fills_blank_names(monkeypatch):
    store = MemoryCampaignContentStore()
    calls = _install_api(
        monkeypatch,
        store,
        subscribers=[
            {"contact_email": "known@example.com", "firstname": ""},
            {"contact_email": "same@example.com", "firstname": "Anders"},
        ],
    )
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_LIST_KEY", "standinglist1")
    monkeypatch.setattr(campaigns, "STANDING_LIST_MIN_RECIPIENTS", 1)

    send_zoho_campaign(
        recipients=[
            {"email": "known@example.com", "first_name": "Christian"},
            {"email": "same@example.com", "first_name": "Anders"},
        ],
        subject="Liga update",
        html_body="<p>Hello riders</p>",
        store=store,
    )

    paths = [url.rsplit("/", 1)[-1] for url, _, _ in calls]
    assert "addlistandcontacts" not in paths
    assert paths == [
        "token",
        "topics",
        "getlistsubscribers",
        "listsubscribe",
        "createCampaign",
        "sendcampaign",
    ]
    subscribed = [fields["contactinfo"] for url, fields, _ in calls if url.endswith("/listsubscribe")]
    assert subscribed == ['{"Contact Email": "known@example.com", "First Name": "Christian"}']
    created = next(fields for url, fields, _ in calls if url.endswith("/createCampaign"))
    assert created["list_details"] == "{standinglist1:[]}"


def test_standing_list_skips_a_rejected_contact_and_still_sends(monkeypatch):
    store = MemoryCampaignContentStore()
    calls = _install_api(
        monkeypatch,
        store,
        subscribers=[],
        reject_email="bad@example.com",
    )
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_LIST_KEY", "standinglist1")
    monkeypatch.setattr(campaigns, "STANDING_LIST_MIN_RECIPIENTS", 1)

    result = send_zoho_campaign(
        recipients=[
            {"email": "bad@example.com", "first_name": "Bad"},
            {"email": "good@example.com", "first_name": "Good"},
        ],
        subject="Liga update",
        html_body="<p>Hello riders</p>",
        store=store,
    )

    assert result["campaignKey"] == "camp-1"
    subscribed = [fields["contactinfo"] for url, fields, _ in calls if url.endswith("/listsubscribe")]
    assert subscribed == [
        '{"Contact Email": "bad@example.com", "First Name": "Bad"}',
        '{"Contact Email": "good@example.com", "First Name": "Good"}',
    ]
    assert any(url.endswith("/sendcampaign") for url, _, _ in calls)


def test_missing_credentials_raise_config_error(monkeypatch):
    monkeypatch.setattr(campaigns, "ZOHO_CAMPAIGNS_REFRESH_TOKEN", None)
    with pytest.raises(EmailConfigError, match="ZOHO_CAMPAIGNS_REFRESH_TOKEN"):
        send_zoho_campaign(
            recipients=["rider@example.com"],
            subject="Liga update",
            html_body="<p>Hello</p>",
            store=MemoryCampaignContentStore(),
        )


def test_content_route_serves_stored_html(monkeypatch):
    from routes.admin_users import get_campaign_content

    def fake_get(self, token: str):
        return "<p>Hello riders</p>" if token == "a" * 32 else None

    monkeypatch.setattr(
        "routes.admin_users.FirestoreCampaignContentStore.get",
        fake_get,
    )
    body, status, headers = get_campaign_content("a" * 32)
    assert status == 200
    assert body == "<p>Hello riders</p>"
    assert headers["Content-Type"].startswith("text/html")
    assert get_campaign_content("short") == ("Not found", 404)
