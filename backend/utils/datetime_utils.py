"""
Unified datetime utilities used across the backend.

Centralises the _parse_dt / _normalize_dt pattern previously duplicated
in LeagueEngine and other modules.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


def normalize_dt(value: datetime | None) -> datetime | None:
    """Return a naive UTC datetime, stripping timezone info.

    If the input already has tzinfo it is first converted to UTC.
    Returns None for None input.
    """
    if not value:
        return None
    if value.tzinfo:
        return value.astimezone(timezone.utc).replace(tzinfo=None)
    return value


def parse_dt(value: Any) -> datetime | None:
    """Parse a datetime from a Firestore Timestamp, datetime, or ISO 8601 string.

    Returns a naive UTC datetime, or None if parsing fails.
    """
    if not value:
        return None
    if isinstance(value, datetime):
        return normalize_dt(value)
    try:
        parsed = datetime.fromisoformat(str(value).replace('Z', '+00:00'))
        return normalize_dt(parsed)
    except Exception:
        return None


def utc_now() -> datetime:
    """Return the current time as a naive UTC datetime."""
    return datetime.now(timezone.utc).replace(tzinfo=None)
