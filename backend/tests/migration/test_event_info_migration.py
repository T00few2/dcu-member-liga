"""
Migration tests focused on legacy Zwift event-info fallback.

These tests verify fallback and data extraction behavior for:
  Legacy: GET /api/events/{eventId}

Delete this directory once the migration is confirmed stable in production.

Run with:
    pytest backend/tests/migration/test_event_info_migration.py -v
"""

from __future__ import annotations

import os
import sys
import time
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Stub heavy optional dependencies so tests run without production credentials.
# ---------------------------------------------------------------------------
_STUBS = [
    "firebase_admin",
    "firebase_admin.credentials",
    "firebase_admin.firestore",
    "firebase_admin.auth",
    "google.cloud",
    "google.cloud.firestore",
    "requests",
    "requests.exceptions",
    "dotenv",
    "backoff",
]
for _s in _STUBS:
    sys.modules.setdefault(_s, MagicMock())

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from services.zwift import ZwiftService
from services.results.zwift_fetcher import ZwiftFetcher

# ---------------------------------------------------------------------------
# Shared sample data
# Represents a two-subgroup event as returned by both official and legacy APIs.
# The schema is identical for the fields ZwiftFetcher consumes.
# ---------------------------------------------------------------------------

SAMPLE_EVENT = {
    "id": "evt-100",
    "name": "DCU Liga Race 1",
    "eventSubgroups": [
        {
            "id": "sub-A",
            "subgroupLabel": "A",
            "routeId": 9,
            "laps": 3,
            "eventSubgroupStart": "2024-03-01T18:00:00Z",
        },
        {
            "id": "sub-B",
            "subgroupLabel": "B",
            "routeId": 9,
            "laps": 2,
            "eventSubgroupStart": "2024-03-01T18:05:00Z",
        },
    ],
}


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_service(migration_mode: str) -> ZwiftService:
    svc = ZwiftService(
        client_id="test-client",
        client_secret="test-secret",
        auth_base_url="https://auth.example.com/realms/zwift",
        api_base_url="https://api.example.com",
        migration_mode=migration_mode,
    )
    svc._app_access_token = "test-token"
    svc._app_token_expiry_epoch = time.time() + 3600
    return svc


def _mock_response(status_code: int, body: dict) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = body
    r.raise_for_status = MagicMock()
    return r


def _mock_response_error(status_code: int) -> MagicMock:
    r = MagicMock()
    r.status_code = status_code
    r.json.return_value = {}
    r.raise_for_status.side_effect = Exception(f"HTTP {status_code}")
    return r


# ---------------------------------------------------------------------------
# Tests: legacy endpoint fallback
# ---------------------------------------------------------------------------

class TestLegacyEventInfo:
    """In dual_stack mode a failed official request falls back to /api/events/{id}."""

    def test_legacy_triggered_when_official_fails(self):
        svc = _make_service("dual_stack")
        with patch("requests.request", side_effect=[
            _mock_response_error(404),
            _mock_response(200, SAMPLE_EVENT),
        ]):
            result = svc.get_event_info("evt-100")
        assert result["id"] == "evt-100"

    def test_legacy_url_contains_events_path(self):
        """Verify the fallback request goes to /api/events/."""
        svc = _make_service("dual_stack")
        with patch("requests.request", side_effect=[
            _mock_response_error(404),
            _mock_response(200, SAMPLE_EVENT),
        ]) as mock_req:
            svc.get_event_info("evt-100")
        legacy_url = mock_req.call_args_list[1][1].get("url") or mock_req.call_args_list[1][0][1]
        assert "/api/events/" in legacy_url


# ---------------------------------------------------------------------------
# Tests: extract_subgroups equivalence via ZwiftFetcher
# ---------------------------------------------------------------------------

class TestExtractSubgroupsEquivalence:
    """
    ZwiftFetcher.extract_subgroups must produce identical output regardless of
    which API endpoint supplied the event info dict.
    """

    def _extract(self, event_info: dict) -> list:
        fetcher = ZwiftFetcher(MagicMock())
        return fetcher.extract_subgroups(event_info)

    def test_subgroup_count_matches(self):
        subgroups = self._extract(SAMPLE_EVENT)
        assert len(subgroups) == 2

    def test_subgroup_ids_extracted(self):
        subgroups = self._extract(SAMPLE_EVENT)
        ids = [s["id"] for s in subgroups]
        assert ids == ["sub-A", "sub-B"]

    def test_subgroup_labels_extracted(self):
        subgroups = self._extract(SAMPLE_EVENT)
        labels = [s["subgroupLabel"] for s in subgroups]
        assert labels == ["A", "B"]

    def test_route_id_extracted(self):
        subgroups = self._extract(SAMPLE_EVENT)
        assert all(s["routeId"] == 9 for s in subgroups)

    def test_laps_extracted(self):
        subgroups = self._extract(SAMPLE_EVENT)
        assert subgroups[0]["laps"] == 3
        assert subgroups[1]["laps"] == 2

    def test_event_name_propagated_to_each_subgroup(self):
        subgroups = self._extract(SAMPLE_EVENT)
        assert all(s["eventName"] == "DCU Liga Race 1" for s in subgroups)

    def test_missing_optional_fields_default_to_none(self):
        """laps / routeId may be absent; extract_subgroups should return None not raise."""
        sparse_event = {
            "name": "Sparse Event",
            "eventSubgroups": [{"id": "sub-X", "subgroupLabel": "X"}],
        }
        subgroups = self._extract(sparse_event)
        assert subgroups[0]["laps"] is None
        assert subgroups[0]["routeId"] is None
