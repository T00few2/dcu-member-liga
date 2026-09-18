"""Fill users.zwiftProfile dropLevel from Zwift JSON profiles.

Uses the same game-client password grant as other local Zwift tools.
Do not document this module in README, AGENTS.md, or zwift_api_docs.md.
"""
from __future__ import annotations

import logging
import os
import time
from typing import Any, Callable, Mapping

import requests

from services.club_kits import extract_game_client_fields, extract_level_fields

logger = logging.getLogger(__name__)

ZWIFT_API_BASE = os.environ.get("ZWIFT_API_BASE_URL", "https://us-or-rly101.zwift.com").rstrip("/")
ZWIFT_AUTH_BASE = os.environ.get(
    "ZWIFT_AUTH_BASE_URL",
    "https://secure.zwift.com/auth/realms/zwift",
).rstrip("/")
ZWIFT_GAME_CLIENT_ID = os.environ.get("ZWIFT_GAME_CLIENT_ID", "Zwift Game Client")


class DropLevelAuthError(RuntimeError):
    """Missing or failed game-client credentials."""


def game_client_access_token() -> str:
    username = (os.environ.get("ZWIFT_USERNAME") or "").strip()
    password = (os.environ.get("ZWIFT_PASSWORD") or "").strip()
    if not username or not password:
        raise DropLevelAuthError("ZWIFT_USERNAME and ZWIFT_PASSWORD must be set")

    response = requests.post(
        f"{ZWIFT_AUTH_BASE}/protocol/openid-connect/token",
        data={
            "client_id": ZWIFT_GAME_CLIENT_ID,
            "grant_type": "password",
            "username": username,
            "password": password,
        },
        timeout=20,
    )
    if response.status_code != 200:
        raise DropLevelAuthError(f"Zwift game-client auth failed ({response.status_code})")
    token = (response.json() or {}).get("access_token")
    if not token:
        raise DropLevelAuthError("Zwift game-client auth response had no access_token")
    return str(token)


def fetch_json_profile(token: str, zwift_id: int, *, timeout: int = 20) -> dict[str, Any] | None:
    url = f"{ZWIFT_API_BASE}/api/profiles/{int(zwift_id)}"
    response = requests.get(
        url,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept": "application/json",
            "Content-Type": "application/json",
        },
        timeout=timeout,
    )
    if response.status_code == 404:
        return None
    if response.status_code != 200:
        logger.warning("JSON profile fetch failed for %s (%s)", zwift_id, response.status_code)
        return None
    payload = response.json()
    return payload if isinstance(payload, dict) else None


def numeric_zwift_id(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip()
    if not text.isdigit():
        return None
    return int(text)


PROFILE_LEVEL_KEYS = ("dropLevel", "achievementLevel", "totalExperiencePoints")
PROFILE_CLIENT_KEYS = ("gameClientUserAgent", "gameClientPlatform", "canEnterUnlockCode")


def unofficial_profile_fields(profile: Mapping[str, Any] | None) -> dict[str, Any]:
    fields = extract_level_fields(profile)
    fields.update(extract_game_client_fields(profile))
    return fields


def ensure_drop_level_fields(
    zwift_id: Any,
    mapped: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Fill dropLevel and last game client from unofficial JSON profile.

    Official racing-profile achievementLevel is often the XP-table level (e.g. 63).
    In-game drop (jersey unlocks) is unofficial JSON hundredths (4661 → 46).
    """
    out = dict(mapped or {})
    nid = numeric_zwift_id(zwift_id)
    if nid is None:
        return out
    try:
        extra = unofficial_profile_fields(fetch_json_profile(game_client_access_token(), nid))
        extra_raw = _achievement_raw(extra)
        mapped_raw = _achievement_raw(out)
        extra_drop = extra.get("dropLevel")
        if extra_drop is not None and (
            out.get("dropLevel") is None
            or (extra_raw is not None and extra_raw >= 1000 and (mapped_raw is None or mapped_raw < 1000))
        ):
            for key in PROFILE_LEVEL_KEYS:
                if key in extra:
                    out[key] = extra[key]
        for key in PROFILE_CLIENT_KEYS:
            if key in extra:
                out[key] = extra[key]
    except DropLevelAuthError as exc:
        logger.warning("Drop-level fallback skipped for %s: %s", nid, exc)
    except Exception:
        logger.exception("Drop-level fallback failed for %s", nid)
    return out


def _achievement_raw(fields: dict[str, Any]) -> int | None:
    raw = fields.get("achievementLevel")
    if raw is None or isinstance(raw, bool):
        return None
    try:
        return int(raw)
    except (TypeError, ValueError):
        return None


def refresh_drop_levels_for_ids(
    zwift_ids: list[int],
    write_fields: Callable[[int, dict[str, Any]], None],
    *,
    sleep_s: float = 0.12,
    token: str | None = None,
) -> dict[str, int]:
    """Fetch JSON profiles and call write_fields(zwift_id, level_fields)."""
    access = token or game_client_access_token()
    updated = 0
    skipped = 0
    failed = 0
    for index, zwift_id in enumerate(zwift_ids):
        try:
            profile = fetch_json_profile(access, zwift_id)
            fields = unofficial_profile_fields(profile)
            if not fields:
                skipped += 1
            else:
                write_fields(zwift_id, fields)
                updated += 1
        except Exception:
            logger.exception("Drop-level refresh failed for %s", zwift_id)
            failed += 1
        if sleep_s and index < len(zwift_ids) - 1:
            time.sleep(sleep_s)
    return {"updated": updated, "skipped": skipped, "failed": failed, "total": len(zwift_ids)}
