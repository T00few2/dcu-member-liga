from __future__ import annotations

from typing import Any


def _as_positive_int(value: Any) -> int | None:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    if number <= 0:
        return None
    return int(round(number))


def _normalize_critical_power(payload: dict[str, Any] | None) -> dict[str, int]:
    source = payload or {}
    relevant_efforts = source.get("relevantCpEfforts")
    if isinstance(relevant_efforts, list):
        watts_by_duration: dict[int, int] = {}
        for effort in relevant_efforts:
            if not isinstance(effort, dict):
                continue
            try:
                duration = int(effort.get("duration"))
            except (TypeError, ValueError):
                continue
            watts = _as_positive_int(effort.get("watts"))
            if watts:
                watts_by_duration[duration] = watts
        source = {
            **source,
            "criticalP15Seconds": source.get("criticalP15Seconds") or watts_by_duration.get(15),
            "criticalP1Minute": source.get("criticalP1Minute") or watts_by_duration.get(60),
            "criticalP5Minutes": source.get("criticalP5Minutes") or watts_by_duration.get(300),
            "criticalP20Minutes": source.get("criticalP20Minutes") or watts_by_duration.get(1200),
        }

    cp15 = _as_positive_int(source.get("criticalP15Seconds") or source.get("cp15s"))
    cp60 = _as_positive_int(source.get("criticalP1Minute") or source.get("cp1min"))
    cp300 = _as_positive_int(source.get("criticalP5Minutes") or source.get("cp5min"))
    cp1200 = _as_positive_int(source.get("criticalP20Minutes") or source.get("cp20min"))
    if not (cp15 and cp60 and cp300 and cp1200):
        return {}
    return {
        "criticalP15Seconds": cp15,
        "criticalP1Minute": cp60,
        "criticalP5Minutes": cp300,
        "criticalP20Minutes": cp1200,
    }


def _critical_power_from_user_doc(user_doc: dict[str, Any] | None) -> dict[str, int]:
    if not user_doc:
        return {}

    # Preferred source: power-profile relevant efforts persisted on user docs.
    relevant = (
        (user_doc.get("zwiftPowerCurve") or {}).get("relevantCpEfforts")
        if isinstance(user_doc.get("zwiftPowerCurve"), dict)
        else None
    ) or []
    if isinstance(relevant, list):
        watts_by_duration: dict[int, int] = {}
        for effort in relevant:
            if not isinstance(effort, dict):
                continue
            try:
                duration = int(effort.get("duration"))
            except (TypeError, ValueError):
                continue
            watts = _as_positive_int(effort.get("watts"))
            if watts:
                watts_by_duration[duration] = watts
        candidate = {
            "criticalP15Seconds": watts_by_duration.get(15),
            "criticalP1Minute": watts_by_duration.get(60),
            "criticalP5Minutes": watts_by_duration.get(300),
            "criticalP20Minutes": watts_by_duration.get(1200),
        }
        normalized = _normalize_critical_power(candidate)
        if normalized:
            return normalized

    # Secondary source: flat CP fields occasionally present on participant docs.
    return _normalize_critical_power(user_doc)


def resolve_critical_power(
    entry_payload: dict[str, Any] | None,
    user_doc: dict[str, Any] | None = None,
    *,
    allow_user_fallback: bool = False,
) -> dict[str, int]:
    normalized_entry = _normalize_critical_power(entry_payload)
    if normalized_entry:
        return normalized_entry
    if allow_user_fallback:
        return _critical_power_from_user_doc(user_doc)
    return {}
