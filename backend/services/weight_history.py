from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

from firebase_admin import firestore


def _safe_int(value: Any) -> int | None:
    try:
        return int(float(value))
    except (TypeError, ValueError):
        return None


def _normalize_weight_grams(raw_weight: Any) -> int | None:
    value = _safe_int(raw_weight)
    if value is None or value <= 0:
        return None
    # Heuristic used elsewhere in the codebase: values above ~1000 are grams.
    # If the value looks like kilograms, convert to grams.
    if value < 1000:
        value *= 1000
    return value


def extract_weight_grams_from_profile(profile: dict[str, Any] | None) -> int | None:
    payload = profile or {}
    competition = payload.get("competitionMetrics") or {}
    for raw in (
        competition.get("weightInGrams"),
        payload.get("weightInGrams"),
        payload.get("weight"),
    ):
        grams = _normalize_weight_grams(raw)
        if grams is not None:
            return grams
    return None


def _retention_days() -> int:
    raw = os.getenv("WEIGHT_HISTORY_RETENTION_DAYS", "30")
    value = _safe_int(raw) or 30
    return max(value, 30)


def _dedupe_window_minutes(default_value: int = 60) -> int:
    raw = os.getenv("WEIGHT_HISTORY_DEDUPE_MINUTES", str(default_value))
    value = _safe_int(raw) or default_value
    return max(value, 1)


def _to_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        try:
            if raw.endswith("Z"):
                return datetime.fromisoformat(raw.replace("Z", "+00:00"))
            parsed = datetime.fromisoformat(raw)
            return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
        except Exception:
            return None
    return None


def build_weight_history_entry(
    *,
    weight_grams: int,
    source: str,
    trigger: str,
    race_id: str | None = None,
    activity_id: str | None = None,
    profile_updated_at: Any = None,
    captured_at: datetime | None = None,
    retention_days: int | None = None,
) -> dict[str, Any]:
    now = captured_at or datetime.now(timezone.utc)
    keep_days = max(int(retention_days or _retention_days()), 30)
    profile_dt = _to_datetime(profile_updated_at)
    payload: dict[str, Any] = {
        "schemaVersion": 1,
        "capturedAt": now,
        "expiresAt": now + timedelta(days=keep_days),
        "retentionDays": keep_days,
        "weightInGrams": int(weight_grams),
        "weightKg": round(float(weight_grams) / 1000.0, 1),
        "source": str(source or "unknown"),
        "trigger": str(trigger or "unknown"),
    }
    if race_id:
        payload["raceId"] = str(race_id)
    if activity_id:
        payload["activityId"] = str(activity_id)
    if profile_dt:
        payload["profileUpdatedAt"] = profile_dt
    return payload


def append_weight_history_entry(
    db: Any,
    *,
    user_doc_id: str,
    weight_grams: int | None = None,
    profile_payload: dict[str, Any] | None = None,
    source: str,
    trigger: str,
    race_id: str | None = None,
    activity_id: str | None = None,
    profile_updated_at: Any = None,
    dedupe_minutes: int | None = None,
    retention_days: int | None = None,
) -> dict[str, Any]:
    if not db:
        return {"written": False, "reason": "db_unavailable"}

    resolved_weight = weight_grams
    if resolved_weight is None:
        resolved_weight = extract_weight_grams_from_profile(profile_payload)
    resolved_weight = _normalize_weight_grams(resolved_weight)
    if resolved_weight is None:
        return {"written": False, "reason": "missing_weight"}

    rider_ref = db.collection("users").document(str(user_doc_id))
    history_ref = rider_ref.collection("weight_history")
    now = datetime.now(timezone.utc)
    dedupe_window = timedelta(minutes=(dedupe_minutes or _dedupe_window_minutes()))

    latest = next(
        history_ref.order_by("capturedAt", direction=firestore.Query.DESCENDING).limit(1).stream(),
        None,
    )
    if latest and latest.exists:
        latest_data = latest.to_dict() or {}
        last_weight = _normalize_weight_grams(latest_data.get("weightInGrams"))
        captured_at = _to_datetime(latest_data.get("capturedAt"))
        if last_weight == resolved_weight and captured_at and (now - captured_at) <= dedupe_window:
            return {"written": False, "reason": "deduped", "entryId": latest.id}

    entry = build_weight_history_entry(
        weight_grams=resolved_weight,
        source=source,
        trigger=trigger,
        race_id=race_id,
        activity_id=activity_id,
        profile_updated_at=profile_updated_at,
        captured_at=now,
        retention_days=retention_days,
    )
    doc_ref = history_ref.document()
    doc_ref.set(entry)
    return {"written": True, "reason": "created", "entryId": doc_ref.id}


def list_weight_history_entries(db: Any, *, user_doc_id: str, limit: int = 30) -> list[dict[str, Any]]:
    if not db:
        return []
    size = max(1, min(int(limit or 30), 500))
    docs = (
        db.collection("users")
        .document(str(user_doc_id))
        .collection("weight_history")
        .order_by("capturedAt", direction=firestore.Query.DESCENDING)
        .limit(size)
        .stream()
    )
    rows: list[dict[str, Any]] = []
    for doc in docs:
        payload = doc.to_dict() or {}
        payload["id"] = doc.id
        rows.append(payload)
    return rows

