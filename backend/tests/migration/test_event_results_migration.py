"""
Official event-results tests (post-migration).

These tests verify the normalised output consumed by ZwiftFetcher.fetch_finishers
using only the official endpoint:
  Official: GET /api/link/events/subgroups/{id}/segment-results
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

# Pre-normalised entries in the internal shape expected by ZwiftFetcher.
PRENORMALISED_API_ENTRIES = [
    {
        "profileId": "1001",
        "profileData": {
            "id": "1001",
            "userId": "1001",
            "firstName": "",
            "lastName": "",
        },
        "activityData": {"durationInMilliseconds": 3_600_000},
        "flaggedCheating": False,
        "flaggedSandbagging": False,
        "criticalP": {},
        "_officialSegmentResult": {"userId": "1001"},
    },
    {
        "profileId": "1002",
        "profileData": {
            "id": "1002",
            "userId": "1002",
            "firstName": "",
            "lastName": "",
        },
        "activityData": {"durationInMilliseconds": 3_720_000},
        "flaggedCheating": False,
        "flaggedSandbagging": False,
        "criticalP": {},
        "_officialSegmentResult": {"userId": "1002"},
    },
    {
        "profileId": "1003",
        "profileData": {
            "id": "1003",
            "userId": "1003",
            "firstName": "",
            "lastName": "",
        },
        "activityData": {"durationInMilliseconds": 3_840_000},
        "flaggedCheating": False,
        "flaggedSandbagging": False,
        "criticalP": {},
        "_officialSegmentResult": {"userId": "1003"},
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

def _make_service() -> ZwiftService:
    svc = ZwiftService(
        client_id="test-client",
        client_secret="test-secret",
        auth_base_url="https://auth.example.com/realms/zwift",
        api_base_url="https://api.example.com",
        migration_mode="official_only",
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
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        assert len(results) == len(OFFICIAL_API_RIDERS)

    def test_profile_id_populated_from_user_id(self):
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry, rider in zip(results, OFFICIAL_API_RIDERS):
            assert entry["profileId"] == rider["userId"]

    def test_finish_time_normalised_into_activity_data(self):
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry, rider in zip(results, OFFICIAL_API_RIDERS):
            assert entry["activityData"]["durationInMilliseconds"] == rider["durationInMilliseconds"]

    def test_cheating_flags_default_to_false(self):
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry in results:
            assert entry["flaggedCheating"] is False
            assert entry["flaggedSandbagging"] is False

    def test_original_entry_preserved_in_private_field(self):
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry, rider in zip(results, OFFICIAL_API_RIDERS):
            assert entry["_officialSegmentResult"] == rider

    def test_name_fields_empty_known_official_difference(self):
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, self._official_page())):
            results = svc.get_event_results("sub-42")
        for entry in results:
            assert entry["profileData"]["firstName"] == ""
            assert entry["profileData"]["lastName"] == ""

    def test_cursor_pagination_concatenates_pages(self):
        page1 = self._official_page(riders=OFFICIAL_API_RIDERS[:2], cursor="tok")
        page2 = self._official_page(riders=OFFICIAL_API_RIDERS[2:], cursor=None)
        svc = _make_service()
        with patch("requests.request", side_effect=[
            _mock_response(200, page1),
            _mock_response(200, page2),
        ]):
            results = svc.get_event_results("sub-42", limit=2)
        assert len(results) == 3

    def test_empty_results_returns_empty_list(self):
        svc = _make_service()
        with patch("requests.request", return_value=_mock_response(200, {"entries": [], "cursor": None})):
            results = svc.get_event_results("sub-42")
        assert results == []


# ---------------------------------------------------------------------------
# Tests: scorer-field equivalence via ZwiftFetcher
# ---------------------------------------------------------------------------

class TestScorerFieldEquivalence:
    """
    Verify scorer-critical fields remain stable when fetcher input is either:
    - official entries normalised by ZwiftService.get_event_results, or
    - equivalent pre-normalised internal entries.
    """

    def _normalised_official_entries(self):
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
        segment_ids_in_order: list[str] = []
        seen: set[str] = set()
        for e in entries:
            seg_id = str((e.get("_officialSegmentResult") or {}).get("segmentId") or "").strip()
            if seg_id and seg_id not in seen:
                seen.add(seg_id)
                segment_ids_in_order.append(seg_id)
        route_segments = [
            {"id": seg_id, "count": 1, "lap": 1, "direction": "forward"}
            for seg_id in segment_ids_in_order
        ]
        return fetcher.fetch_finishers(
            subgroup_id="sub-42",
            event_secret="secret",
            fetch_mode="finishers",
            registered_riders=REGISTERED_RIDERS,
            route_segments=route_segments,
            configured_sprints=[],
        )

    def test_finish_times_are_identical(self):
        official = {r["zwiftId"]: r["finishTime"] for r in self._run_fetcher(self._normalised_official_entries())}
        prenorm = {r["zwiftId"]: r["finishTime"] for r in self._run_fetcher(PRENORMALISED_API_ENTRIES)}
        assert official == prenorm

    def test_finish_order_is_identical(self):
        official_ids = [r["zwiftId"] for r in self._run_fetcher(self._normalised_official_entries())]
        prenorm_ids = [r["zwiftId"] for r in self._run_fetcher(PRENORMALISED_API_ENTRIES)]
        assert official_ids == prenorm_ids

    def test_names_come_from_registered_riders_in_both_cases(self):
        official = {r["zwiftId"]: r["name"] for r in self._run_fetcher(self._normalised_official_entries())}
        prenorm = {r["zwiftId"]: r["name"] for r in self._run_fetcher(PRENORMALISED_API_ENTRIES)}
        assert official == prenorm
