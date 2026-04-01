"""
Migration comparison tests: official vs legacy Zwift event-results endpoints.

These tests verify that the normalised output consumed by ZwiftFetcher.fetch_finishers
is equivalent for scorer-critical fields, whether data comes from:
  Official:  GET /api/link/events/subgroups/{id}/segment-results
  Legacy:    GET /api/race-results/entries?event_subgroup_id={id}

KNOWN DIFFERENCE documented here:
  The official endpoint does not return rider names.  profileData.firstName /
  profileData.lastName are always empty strings in the normalised output.
  ZwiftFetcher.fetch_finishers already handles this by falling back to the
  registered-rider name, so it does not affect scoring.

Delete this directory once the migration is confirmed stable in production.

Run with:
    pytest backend/tests/migration/test_event_results_migration.py -v
"""

from __future__ import annotations

import os
import sys
import time
from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Stub heavy optional dependencies (firebase, google-cloud) so tests run
# without production credentials.
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

import pytest
from services.zwift import ZwiftService
from services.results.zwift_fetcher import ZwiftFetcher

# ---------------------------------------------------------------------------
# Shared sample data
# Three riders identified by userId/profileId "1001", "1002", "1003".
# ---------------------------------------------------------------------------

# Raw payload returned by the official segment-results endpoint.
OFFICIAL_API_RIDERS = [
    {"userId": "1001", "durationInMilliseconds": 3_600_000},
    {"userId": "1002", "durationInMilliseconds": 3_720_000},
    {"userId": "1003", "durationInMilliseconds": 3_840_000},
]

# Raw entries returned by the legacy /api/race-results/entries endpoint.
# Same riders, same finish times, but in the old schema that includes names
# and explicit flag fields.
LEGACY_API_ENTRIES = [
    {
        "profileId": "1001",
        "profileData": {
            "id": "1001",
            "userId": "1001",
            "firstName": "Alice",
            "lastName": "Smith",
        },
        "activityData": {"durationInMilliseconds": 3_600_000},
        "flaggedCheating": False,
        "flaggedSandbagging": False,
        "criticalP": {},
    },
    {
        "profileId": "1002",
        "profileData": {
            "id": "1002",
            "userId": "1002",
            "firstName": "Bob",
            "lastName": "Jones",
        },
        "activityData": {"durationInMilliseconds": 3_720_000},
        "flaggedCheating": False,
        "flaggedSandbagging": False,
        "criticalP": {},
    },
    {
        "profileId": "1003",
        "profileData": {
            "id": "1003",
            "userId": "1003",
            "firstName": "Carol",
            "lastName": "Brown",
        },
        "activityData": {"durationInMilliseconds": 3_840_000},
        "flaggedCheating": False,
        "flaggedSandbagging": False,
        "criticalP": {},
    },
]

# Registered-rider lookup as ZwiftFetcher receives it from Firestore.
REGISTERED_RIDERS = {
    "1001": {"zwiftId": "1001", "name": "Alice Smith"},
    "1002": {"zwiftId": "1002", "name": "Bob Jones"},
    "1003": {"zwiftId": "1003", "name": "Carol Brown"},
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
    # Pre-populate app token so no real HTTP token request is made.
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
# Tests: official endpoint normalisation
# ---------------------------------------------------------------------------

class TestOfficialSegmentResults:
    """
    Verify that ZwiftService.get_event_results correctly normalises the
    official segment-results response into the internal entry schema.
    """

    def _official_page(self, riders=None, cursor=None):
        return {"entries": riders or OFFICIAL_API_RIDERS, "cursor": cursor}

    def test_entry_count_matches_riders(self):
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        assert len(results) == len(OFFICIAL_API_RIDERS)

    def test_profile_id_populated_from_userId(self):
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry, rider in zip(results, OFFICIAL_API_RIDERS):
            assert entry["profileId"] == rider["userId"]

    def test_finish_time_normalised_into_activityData(self):
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry, rider in zip(results, OFFICIAL_API_RIDERS):
            assert entry["activityData"]["durationInMilliseconds"] == rider["durationInMilliseconds"]

    def test_cheating_flags_default_to_false(self):
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry in results:
            assert entry["flaggedCheating"] is False
            assert entry["flaggedSandbagging"] is False

    def test_original_entry_preserved_in_private_field(self):
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry, rider in zip(results, OFFICIAL_API_RIDERS):
            assert entry["_officialSegmentResult"] == rider

    def test_name_fields_empty_known_difference(self):
        """
        KNOWN DIFFERENCE: the official segment-results endpoint does not include
        rider names.  firstName / lastName are always empty strings.
        ZwiftFetcher compensates by using registered_riders for name lookup.
        """
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry in results:
            assert entry["profileData"]["firstName"] == ""
            assert entry["profileData"]["lastName"] == ""

    def test_cursor_pagination_concatenates_pages(self):
        """Results across two pages are concatenated into a single flat list.
        limit=2 matches the page size so the loop doesn't stop early on
        len(entries) < limit."""
        page1 = self._official_page(riders=OFFICIAL_API_RIDERS[:2], cursor="tok")
        page2 = self._official_page(riders=OFFICIAL_API_RIDERS[2:], cursor=None)
        svc = _make_service("official_only")
        with patch("requests.request", side_effect=[
            _mock_response(200, page1),
            _mock_response(200, page2),
        ]):
            results = svc.get_event_results("sub-42", limit=2)
        assert len(results) == 3

    def test_empty_results_returns_empty_list(self):
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response(200, {"entries": [], "cursor": None})):
            results = svc.get_event_results("sub-42")
        assert results == []


# ---------------------------------------------------------------------------
# Tests: legacy endpoint
# ---------------------------------------------------------------------------

class TestLegacyEventResults:
    """
    Verify the legacy /api/race-results/entries path is triggered when the
    official endpoint fails (dual_stack mode) and returns the expected schema.
    """

    def _legacy_page(self, entries=None):
        return {"entries": entries or LEGACY_API_ENTRIES}

    def test_legacy_triggered_when_official_fails(self):
        # Use 404 — not in the _api_request retry set {429,500,502,503,504} —
        # so the official attempt returns immediately and fallback is triggered.
        svc = _make_service("dual_stack")
        with patch("requests.request", side_effect=[
            _mock_response_error(404),
            _mock_response(200, self._legacy_page()),
        ]):
            results = svc.get_event_results("sub-42")
        assert len(results) == len(LEGACY_API_ENTRIES)

    def test_legacy_entries_passed_through_unchanged(self):
        """Legacy entries are returned as-is without any re-mapping."""
        svc = _make_service("dual_stack")
        with patch("requests.request", side_effect=[
            _mock_response_error(404),
            _mock_response(200, self._legacy_page()),
        ]):
            results = svc.get_event_results("sub-42")
        assert results == LEGACY_API_ENTRIES

    def test_legacy_contains_rider_names(self):
        """
        KNOWN DIFFERENCE (inverse of official): legacy entries include real
        rider names from the API.
        """
        svc = _make_service("dual_stack")
        with patch("requests.request", side_effect=[
            _mock_response_error(404),
            _mock_response(200, self._legacy_page()),
        ]):
            results = svc.get_event_results("sub-42")
        assert results[0]["profileData"]["firstName"] == "Alice"
        assert results[1]["profileData"]["firstName"] == "Bob"

    def test_official_not_used_in_official_only_mode_on_failure(self):
        """In official_only mode a failed official request raises rather than falling back."""
        svc = _make_service("official_only")
        with patch("requests.request", return_value=_mock_response_error(500)):
            with pytest.raises(Exception):
                svc.get_event_results("sub-42")

    def test_legacy_pagination_concatenates_pages(self):
        page1 = {"entries": LEGACY_API_ENTRIES[:2]}
        page2 = {"entries": LEGACY_API_ENTRIES[2:]}
        svc = _make_service("dual_stack")
        with patch("requests.request", side_effect=[
            _mock_response_error(404),      # official fails (404 not retried)
            _mock_response(200, page1),     # legacy page 1 (full limit → fetch next)
            _mock_response(200, page2),     # legacy page 2
        ]):
            results = svc.get_event_results("sub-42", limit=2)
        assert len(results) == 3


# ---------------------------------------------------------------------------
# Tests: scorer-field equivalence via ZwiftFetcher
# ---------------------------------------------------------------------------

class TestScorerFieldEquivalence:
    """
    ZwiftFetcher.fetch_finishers only cares about:
      - Zwift ID  (entry["profileData"]["id"] or entry["profileId"])
      - Finish time  (entry["activityData"]["durationInMilliseconds"])
      - entry["flaggedCheating"] / entry["flaggedSandbagging"]
      - entry["criticalP"]

    Both endpoints must produce identical RiderResult lists for these fields
    when the underlying race data is the same.
    """

    def _normalised_official_entries(self):
        """Simulate the output of ZwiftService.get_event_results (official path)."""
        return [
            {
                "profileId": r["userId"],
                "profileData": {
                    "id": r["userId"],
                    "userId": r["userId"],
                    "firstName": "",
                    "lastName": "",
                },
                "activityData": {"durationInMilliseconds": r["durationInMilliseconds"]},
                "flaggedCheating": False,
                "flaggedSandbagging": False,
                "criticalP": {},
                "_officialSegmentResult": r,
            }
            for r in OFFICIAL_API_RIDERS
        ]

    def _run_fetcher(self, entries: list) -> list:
        svc_mock = MagicMock()
        svc_mock.get_event_results.return_value = entries
        fetcher = ZwiftFetcher(svc_mock)
        return fetcher.fetch_finishers(
            subgroup_id="sub-42",
            event_secret="secret",
            fetch_mode="finishers",
            filter_registered=True,
            registered_riders=REGISTERED_RIDERS,
        )

    def test_finish_times_are_identical(self):
        official = {r["zwiftId"]: r["finishTime"] for r in self._run_fetcher(self._normalised_official_entries())}
        legacy = {r["zwiftId"]: r["finishTime"] for r in self._run_fetcher(LEGACY_API_ENTRIES)}
        assert official == legacy

    def test_finish_order_is_identical(self):
        official_ids = [r["zwiftId"] for r in self._run_fetcher(self._normalised_official_entries())]
        legacy_ids = [r["zwiftId"] for r in self._run_fetcher(LEGACY_API_ENTRIES)]
        assert official_ids == legacy_ids

    def test_cheating_flags_are_identical(self):
        official = self._run_fetcher(self._normalised_official_entries())
        legacy = self._run_fetcher(LEGACY_API_ENTRIES)
        for off, leg in zip(official, legacy):
            assert off["flaggedCheating"] == leg["flaggedCheating"]
            assert off["flaggedSandbagging"] == leg["flaggedSandbagging"]

    def test_names_come_from_registered_riders_in_both_paths(self):
        """
        Because official entries have no names, ZwiftFetcher uses registered_riders
        for the name in both paths.  Both should produce the same name.
        """
        official = {r["zwiftId"]: r["name"] for r in self._run_fetcher(self._normalised_official_entries())}
        legacy = {r["zwiftId"]: r["name"] for r in self._run_fetcher(LEGACY_API_ENTRIES)}
        assert official == legacy

    def test_unregistered_riders_excluded_when_filter_enabled(self):
        """Riders not in registered_riders are filtered out in both paths."""
        extra_official = self._normalised_official_entries() + [
            {
                "profileId": "9999",
                "profileData": {"id": "9999", "userId": "9999", "firstName": "", "lastName": ""},
                "activityData": {"durationInMilliseconds": 4_000_000},
                "flaggedCheating": False,
                "flaggedSandbagging": False,
                "criticalP": {},
                "_officialSegmentResult": {},
            }
        ]
        extra_legacy = LEGACY_API_ENTRIES + [
            {
                "profileId": "9999",
                "profileData": {"id": "9999", "userId": "9999", "firstName": "Unknown", "lastName": "Rider"},
                "activityData": {"durationInMilliseconds": 4_000_000},
                "flaggedCheating": False,
                "flaggedSandbagging": False,
                "criticalP": {},
            }
        ]
        official_ids = {r["zwiftId"] for r in self._run_fetcher(extra_official)}
        legacy_ids = {r["zwiftId"] for r in self._run_fetcher(extra_legacy)}
        assert "9999" not in official_ids
        assert "9999" not in legacy_ids
        assert official_ids == legacy_ids
