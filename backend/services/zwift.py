from __future__ import annotations

import logging
import time
from datetime import datetime
from typing import Any
from urllib.parse import urlencode

import requests
from requests import Response
from requests.exceptions import RequestException

from config import (
    ZWIFT_API_BASE_URL,
    ZWIFT_AUTH_BASE_URL,
    ZWIFT_CLIENT_ID,
    ZWIFT_CLIENT_SECRET,
    ZWIFT_MIGRATION_MODE,
    ZWIFT_REDIRECT_URI,
)

logger = logging.getLogger("ZwiftAPI")


def zwift_compat_date(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


class ZwiftService:
    """
    Official Zwift Developer API client.

    Supports:
    - OAuth authorization code + refresh token lifecycle
    - OAuth client credentials token lifecycle
    - Official profile, activities, subscriptions and event-result endpoints
    """

    def __init__(
        self,
        client_id: str | None = None,
        client_secret: str | None = None,
        auth_base_url: str | None = None,
        api_base_url: str | None = None,
        redirect_uri: str | None = None,
        migration_mode: str | None = None,
    ) -> None:
        self.client_id = client_id or ZWIFT_CLIENT_ID
        self.client_secret = client_secret or ZWIFT_CLIENT_SECRET
        self.auth_base_url = (auth_base_url or ZWIFT_AUTH_BASE_URL).rstrip("/")
        self.api_base_url = (api_base_url or ZWIFT_API_BASE_URL).rstrip("/")
        self.redirect_uri = redirect_uri or ZWIFT_REDIRECT_URI
        self.migration_mode = (migration_mode or ZWIFT_MIGRATION_MODE).strip().lower()
        self.allow_legacy_fallback = self.migration_mode in {"dual_stack", "dual", "legacy_fallback"}

        self.token_url = f"{self.auth_base_url}/protocol/openid-connect/token"
        self.revoke_url = f"{self.auth_base_url}/protocol/openid-connect/revoke"
        self.authorize_url = f"{self.auth_base_url}/protocol/openid-connect/auth"

        self._app_access_token: str | None = None
        self._app_token_expiry_epoch: float = 0.0

    # ------------------------------------------------------------------
    # OAuth helpers
    # ------------------------------------------------------------------

    def build_authorize_url(
        self,
        state: str,
        scope: str = "activity profile:read fitness_metrics:read",
        prompt_login: bool = False,
    ) -> str:
        params = {
            "client_id": self.client_id,
            "response_type": "code",
            "scope": scope,
            "redirect_uri": self.redirect_uri,
            "state": state,
        }
        if prompt_login:
            params["prompt"] = "login"
        return f"{self.authorize_url}?{urlencode(params)}"

    def exchange_code_for_tokens(self, code: str, redirect_uri: str | None = None) -> tuple[int, dict[str, Any]]:
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect_uri or self.redirect_uri,
        }
        response = self._post_form(self.token_url, payload)
        return response.status_code, self._safe_json(response)

    def refresh_user_token(self, refresh_token: str) -> tuple[int, dict[str, Any]]:
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "refresh_token",
            "refresh_token": refresh_token,
        }
        response = self._post_form(self.token_url, payload)
        return response.status_code, self._safe_json(response)

    def revoke_token(self, refresh_token: str) -> bool:
        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "token": refresh_token,
        }
        response = self._post_form(self.revoke_url, payload)
        return response.status_code == 200

    def authenticate(self) -> None:
        """
        Kept for backwards compatibility with old callers.
        Now acquires an app token via client_credentials.
        """
        self.get_app_access_token(force_refresh=True)

    def refresh_auth_token(self) -> None:
        """
        Kept for backwards compatibility with old callers.
        """
        self.get_app_access_token(force_refresh=True)

    def ensure_valid_token(self) -> None:
        """
        Kept for backwards compatibility with old callers.
        """
        self.get_app_access_token()

    def is_authenticated(self) -> bool:
        return bool(self._app_access_token and time.time() < self._app_token_expiry_epoch)

    def get_app_access_token(self, force_refresh: bool = False) -> str:
        if not force_refresh and self.is_authenticated():
            return self._app_access_token or ""

        payload = {
            "client_id": self.client_id,
            "client_secret": self.client_secret,
            "grant_type": "client_credentials",
        }
        response = self._post_form(self.token_url, payload)
        if response.status_code != 200:
            raise RuntimeError(f"Zwift client_credentials failed ({response.status_code}): {response.text}")
        data = self._safe_json(response)
        token = data.get("access_token")
        if not token:
            raise RuntimeError("Zwift client_credentials response missing access_token")
        ttl = int(data.get("expires_in", 21600))
        self._app_access_token = token
        self._app_token_expiry_epoch = time.time() + max(ttl - 60, 60)
        return token

    # ------------------------------------------------------------------
    # Official API helpers
    # ------------------------------------------------------------------

    def get_profile(
        self,
        rider_id: int | None = None,
        user_access_token: str | None = None,
        include_competition_metrics: bool = True,
    ) -> dict[str, Any] | None:
        """
        Official replacement for old /api/profiles/{id}.
        Returns the authenticated rider profile from /api/link/racing-profile.

        rider_id is kept for compatibility but ignored by the official endpoint.
        """
        params = {"includeCompetitionMetrics": str(include_competition_metrics).lower()}
        response = self._api_get("/api/link/racing-profile", token=user_access_token, params=params)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.error("Zwift profile fetch failed (%s): %s", response.status_code, response.text)
            return None
        return self._safe_json(response)

    def get_user_activity(self, activity_id: str, user_access_token: str) -> dict[str, Any] | None:
        response = self._api_get(f"/api/thirdparty/activity/{activity_id}", token=user_access_token)
        if response.status_code == 404:
            return None
        if response.status_code != 200:
            logger.error("Zwift activity fetch failed (%s): %s", response.status_code, response.text)
            return None
        return self._safe_json(response)

    def get_power_profile(self, user_access_token: str) -> dict[str, Any] | None:
        response = self._api_get("/api/link/power-curve/power-profile", token=user_access_token)
        if response.status_code != 200:
            logger.error("Zwift power profile fetch failed (%s): %s", response.status_code, response.text)
            return None
        return self._safe_json(response)

    def get_best_power_curve_all_time(self, user_access_token: str) -> dict[str, Any] | None:
        response = self._api_get("/api/link/power-curve/best/all-time", token=user_access_token)
        if response.status_code != 200:
            logger.error("Zwift best all-time curve fetch failed (%s): %s", response.status_code, response.text)
            return None
        return self._safe_json(response)

    def get_best_power_curve_last(self, user_access_token: str, days: int = 30) -> dict[str, Any] | None:
        response = self._api_get("/api/link/power-curve/best/last", token=user_access_token, params={"days": days})
        if response.status_code != 200:
            logger.error("Zwift best recent curve fetch failed (%s): %s", response.status_code, response.text)
            return None
        return self._safe_json(response)

    # ------------------------------------------------------------------
    # Subscriptions / webhooks
    # ------------------------------------------------------------------

    def subscribe_activity(self, user_access_token: str) -> tuple[int, dict[str, Any]]:
        response = self._api_post("/api/thirdparty/activity/subscribe", token=user_access_token)
        return response.status_code, self._safe_json(response)

    def unsubscribe_activity(self, user_access_token: str) -> tuple[int, dict[str, Any]]:
        response = self._api_delete("/api/thirdparty/activity/subscribe", token=user_access_token)
        return response.status_code, self._safe_json(response)

    def unsubscribe_activity_for_user(self, user_id: str) -> tuple[int, dict[str, Any]]:
        response = self._api_delete(f"/api/thirdparty/activity/subscribe/{user_id}")
        return response.status_code, self._safe_json(response)

    def subscribe_racing_score(self, user_access_token: str) -> tuple[int, dict[str, Any]]:
        response = self._api_post("/api/thirdparty/racing-score/subscribe", token=user_access_token)
        return response.status_code, self._safe_json(response)

    def unsubscribe_racing_score(self, user_access_token: str) -> tuple[int, dict[str, Any]]:
        response = self._api_delete("/api/thirdparty/racing-score/subscribe", token=user_access_token)
        return response.status_code, self._safe_json(response)

    def unsubscribe_racing_score_for_user(self, user_id: str) -> tuple[int, dict[str, Any]]:
        response = self._api_delete(f"/api/thirdparty/racing-score/subscribe/{user_id}")
        return response.status_code, self._safe_json(response)

    def subscribe_power_curve(self, user_access_token: str) -> tuple[int, dict[str, Any]]:
        response = self._api_post("/api/thirdparty/power-curve/subscribe", token=user_access_token)
        return response.status_code, self._safe_json(response)

    def unsubscribe_power_curve(self, user_access_token: str) -> tuple[int, dict[str, Any]]:
        response = self._api_delete("/api/thirdparty/power-curve/subscribe", token=user_access_token)
        return response.status_code, self._safe_json(response)

    def unsubscribe_power_curve_for_user(self, user_id: str) -> tuple[int, dict[str, Any]]:
        response = self._api_delete(f"/api/thirdparty/power-curve/subscribe/{user_id}")
        return response.status_code, self._safe_json(response)

    # ------------------------------------------------------------------
    # Event and race helpers (official path variants)
    # ------------------------------------------------------------------

    def get_public_event_info(self, event_id: str) -> dict[str, Any] | None:
        """
        Practical event->subgroup resolver using public event payload.
        Note: this path is not listed in the official developer docs.
        """
        url = f"{self.api_base_url}/api/public/events/{event_id}"
        try:
            response = requests.get(
                url,
                headers={"Accept": "application/json"},
                timeout=20,
            )
        except RequestException as exc:
            logger.warning("Zwift public event fetch failed for %s: %s", event_id, exc)
            return None

        if response.status_code != 200:
            return None

        payload = self._safe_json(response)
        if not isinstance(payload, dict):
            return None
        if not isinstance(payload.get("eventSubgroups"), list):
            return None
        return payload

    def get_event_info(self, event_id: str, event_secret: str | None = None) -> dict[str, Any]:
        """
        Resolve event info with subgroup data.
        Tries /api/public/events/{eventId} first, then official/legacy fallback paths.
        """
        public_payload = self.get_public_event_info(event_id)
        if public_payload:
            return public_payload

        params = {}
        if event_secret:
            params["eventSecret"] = event_secret
        response = self._api_get(f"/api/link/events/{event_id}", params=params)
        if response.status_code == 200:
            return self._safe_json(response)

        if self.allow_legacy_fallback:
            legacy_response = self._api_get(f"/api/events/{event_id}", params=params)
            legacy_response.raise_for_status()
            return self._safe_json(legacy_response)

        response.raise_for_status()
        return {}

    def get_event_results(self, event_sub_id: str, limit: int = 100, event_secret: str | None = None) -> list[dict[str, Any]]:
        """
        Uses official /api/link/events/subgroups/{subgroupId}/segment-results.
        Normalizes entries to preserve legacy keys consumed by scorers.

        The segment-results endpoint returns entries for ALL segments in the
        subgroup (finish line + any sprint/KOM segments).  We keep only the
        entry with the highest durationInMilliseconds per userId, which is
        the finish-line crossing (sprint sub-segments always have a shorter
        duration than the total race time).
        """
        del event_secret  # Official endpoint does not use eventSecret.
        cursor: str | None = None
        raw_entries: list[dict[str, Any]] = []

        while True:
            params: dict[str, Any] = {}
            if cursor:
                params["cursor"] = cursor
            response = self._api_get(f"/api/link/events/subgroups/{event_sub_id}/segment-results", params=params)
            if response.status_code != 200 and self.allow_legacy_fallback:
                return self._get_event_results_legacy(event_sub_id, limit=limit)
            response.raise_for_status()
            data = self._safe_json(response)
            entries = data.get("entries", [])
            raw_entries.extend(entries)
            cursor = data.get("cursor")
            if not cursor or len(entries) < limit:
                break

        # Keep only the entry with the longest duration per userId.
        # The finish-line segment always has the greatest durationInMilliseconds
        # (= total race time); sprint/KOM sub-segments have much shorter durations.
        finish_by_user: dict[str, dict[str, Any]] = {}
        for e in raw_entries:
            user_id = e.get("userId")
            if not user_id:
                continue
            existing = finish_by_user.get(user_id)
            if existing is None or e.get("durationInMilliseconds", 0) > existing.get("durationInMilliseconds", 0):
                finish_by_user[user_id] = e

        all_entries: list[dict[str, Any]] = []
        for e in finish_by_user.values():
            user_id = e.get("userId")
            all_entries.append(
                {
                    "profileId": user_id,
                    "profileData": {
                        "id": user_id,
                        "userId": user_id,
                        "firstName": "",
                        "lastName": "",
                    },
                    "activityData": {
                        "durationInMilliseconds": e.get("durationInMilliseconds", 0),
                    },
                    "flaggedCheating": False,
                    "flaggedSandbagging": False,
                    "criticalP": {},
                    "_officialSegmentResult": e,
                }
            )
        return all_entries

    def _get_event_results_legacy(self, event_sub_id: str, limit: int = 100) -> list[dict[str, Any]]:
        start = 0
        all_entries: list[dict[str, Any]] = []
        while True:
            response = self._api_get(
                "/api/race-results/entries",
                params={"event_subgroup_id": event_sub_id, "start": start, "limit": limit},
            )
            response.raise_for_status()
            payload = self._safe_json(response)
            entries = payload.get("entries", [])
            all_entries.extend(entries)
            if len(entries) < limit:
                break
            start += len(entries)
        return all_entries

    def get_event_participants(
        self,
        event_sub_id: str,
        joined: bool = False,
        limit: int = 100,
        page: int | None = None,
        participant_type: str = "all",
        page_delay: int = 0,
        overlap_delay: int = 0,
    ) -> list[dict[str, Any]]:
        """
        Official replacement uses /api/link/events/subgroups/{subgroupId}/live-data.
        This only returns active participants.
        """
        del joined, participant_type, overlap_delay
        current_page = page or 0
        participants: list[dict[str, Any]] = []

        while True:
            response = self._api_get(
                f"/api/link/events/subgroups/{event_sub_id}/live-data",
                params={"page": current_page, "limit": limit},
            )
            response.raise_for_status()
            data = self._safe_json(response)
            rows = data.get("data", [])
            for row in rows:
                user_id = row.get("userId")
                participants.append(
                    {
                        "id": user_id,
                        "userId": user_id,
                        "firstName": "",
                        "lastName": "",
                        "_officialLiveData": row,
                    }
                )
            if len(rows) < limit or page is not None:
                break
            current_page += 1
            if page_delay:
                time.sleep(page_delay)
        return participants

    def get_segment_results(self, segment_id: str, from_date: datetime | None = None, to_date: datetime | None = None) -> dict[str, Any]:
        """
        There is no direct official equivalent for legacy global segment-result lookup.
        Kept for compatibility and returns an empty payload.
        """
        del segment_id, from_date, to_date
        return {}

    def get_subgroup_segment_efforts(
        self,
        subgroup_id: str,
        sprint_segment_ids: set[str | int],
        limit: int = 100,
    ) -> dict[str, list[dict[str, Any]]]:
        """
        Fetch sprint/KOM segment results for a specific event subgroup.

        Calls the same /segment-results endpoint as get_event_results but
        returns entries grouped by segmentId, filtered to only the segment IDs
        listed in sprint_segment_ids.  Each entry uses the raw official fields
        (userId, durationInMilliseconds, endWorldTime, avgWatts) so that
        ZwiftFetcher can normalise them into the legacy format expected by
        RaceScorer._map_segment_efforts.

        Returns: {segmentId_str: [raw_entry, ...]}
        """
        sprint_ids_str = {str(s) for s in sprint_segment_ids}
        cursor: str | None = None
        by_segment: dict[str, list[dict[str, Any]]] = {}

        while True:
            params: dict[str, Any] = {}
            if cursor:
                params["cursor"] = cursor
            response = self._api_get(
                f"/api/link/events/subgroups/{subgroup_id}/segment-results",
                params=params,
            )
            response.raise_for_status()
            data = self._safe_json(response)
            entries = data.get("entries", [])
            for e in entries:
                seg_id = str(e.get("segmentId", ""))
                if seg_id in sprint_ids_str:
                    by_segment.setdefault(seg_id, []).append(e)
            cursor = data.get("cursor")
            if not cursor or len(entries) < limit:
                break

        return by_segment

    # ------------------------------------------------------------------
    # Internal HTTP helpers
    # ------------------------------------------------------------------

    def _post_form(self, url: str, payload: dict[str, Any]) -> Response:
        return requests.post(
            url,
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=20,
        )

    def _api_get(self, path: str, token: str | None = None, params: dict[str, Any] | None = None) -> Response:
        return self._api_request("GET", path, token=token, params=params)

    def _api_post(self, path: str, token: str | None = None, body: dict[str, Any] | None = None) -> Response:
        return self._api_request("POST", path, token=token, json_body=body)

    def _api_delete(self, path: str, token: str | None = None) -> Response:
        return self._api_request("DELETE", path, token=token)

    def _api_request(
        self,
        method: str,
        path: str,
        token: str | None = None,
        params: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        retries: int = 3,
    ) -> Response:
        access_token = token or self.get_app_access_token()
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/json",
        }
        url = f"{self.api_base_url}{path}"
        last_error: Exception | None = None

        for attempt in range(1, retries + 1):
            try:
                response = requests.request(
                    method=method,
                    url=url,
                    headers=headers,
                    params=params,
                    json=json_body,
                    timeout=20,
                )
                if response.status_code in {429, 500, 502, 503, 504} and attempt < retries:
                    time.sleep(attempt)
                    continue
                return response
            except RequestException as exc:
                last_error = exc
                if attempt < retries:
                    time.sleep(attempt)
                    continue
                raise

        if last_error:
            raise last_error
        raise RuntimeError("Unexpected request failure without exception")

    @staticmethod
    def _safe_json(response: Response) -> dict[str, Any]:
        try:
            data = response.json()
            return data if isinstance(data, dict) else {}
        except Exception:
            return {}
