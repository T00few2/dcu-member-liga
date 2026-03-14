from __future__ import annotations

from collections.abc import Mapping
from typing import Any

CURRENT_SCHEMA_VERSION = 1


def with_schema_version(payload: dict[str, Any]) -> dict[str, Any]:
    """Attach the current schemaVersion to write payloads."""
    return {**payload, "schemaVersion": CURRENT_SCHEMA_VERSION}


def validate_user_doc(payload: Mapping[str, Any], *, partial: bool = False) -> list[str]:
    issues: list[str] = []
    if not partial:
        if not payload.get("zwiftId"):
            issues.append("missing zwiftId")
        registration = payload.get("registration")
        if not isinstance(registration, Mapping):
            issues.append("missing registration object")
        elif registration.get("status") not in {"draft", "complete"}:
            issues.append("registration.status is missing or invalid")
    if "schemaVersion" in payload and not isinstance(payload.get("schemaVersion"), int):
        issues.append("schemaVersion should be int")
    return issues


def validate_race_doc(payload: Mapping[str, Any], *, partial: bool = False) -> list[str]:
    issues: list[str] = []
    if not partial:
        if not payload.get("name"):
            issues.append("missing race name")
        if not payload.get("date"):
            issues.append("missing race date")
    if "results" in payload and not isinstance(payload.get("results"), Mapping):
        issues.append("results should be an object keyed by category")
    if "eventConfiguration" in payload and not isinstance(payload.get("eventConfiguration"), list):
        issues.append("eventConfiguration should be a list")
    if "schemaVersion" in payload and not isinstance(payload.get("schemaVersion"), int):
        issues.append("schemaVersion should be int")
    return issues


def validate_league_settings_doc(payload: Mapping[str, Any], *, partial: bool = False) -> list[str]:
    del partial  # Intentionally unused for now.
    issues: list[str] = []
    for list_key in ("finishPoints", "sprintPoints", "leagueRankPoints"):
        if list_key in payload and not isinstance(payload.get(list_key), list):
            issues.append(f"{list_key} should be a list")
    if "bestRacesCount" in payload and not isinstance(payload.get("bestRacesCount"), int):
        issues.append("bestRacesCount should be int")
    if "schemaVersion" in payload and not isinstance(payload.get("schemaVersion"), int):
        issues.append("schemaVersion should be int")
    return issues


def validate_league_standings_doc(payload: Mapping[str, Any], *, partial: bool = False) -> list[str]:
    del partial  # Intentionally unused for now.
    issues: list[str] = []
    standings = payload.get("standings")
    if standings is not None and not isinstance(standings, Mapping):
        issues.append("standings should be an object keyed by category")
    if "schemaVersion" in payload and not isinstance(payload.get("schemaVersion"), int):
        issues.append("schemaVersion should be int")
    return issues


def log_schema_issues(logger: Any, context: str, issues: list[str]) -> None:
    if not issues:
        return
    logger.warning("Schema validation warnings for %s: %s", context, "; ".join(issues))
