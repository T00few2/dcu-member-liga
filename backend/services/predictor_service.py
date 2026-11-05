"""Loads data for the vELO predictor and keeps its settings in Firestore.

Predictor settings live in the admin-only document `predictor_settings/current`
(not in the public `league/settings`, because history entries name the admin who
made each change):
- `config`: the active `PredictorConfig`
- `history`: earlier configs, newest first, so a change can be rolled back
- `metrics`: the latest tuning metrics for the active config
- `updatedAt`

The legacy `league/settings.predictorFeatures` map is only read, as a fallback
before the first save.
"""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from services.category_engine import serialize_liga_category
from services.liga_categories_core import _load_liga_settings, _resolve_categories
from services.participant_rows import build_participant_row
from services.user_service import UserService
from services import velo_predictor as vp

logger = logging.getLogger(__name__)

HISTORY_LIMIT = 20
PARTICIPANT_LIMIT = 2000


def league_settings(db: Any) -> dict:
    snap = db.collection("league").document("settings").get()
    return (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}


def load_categories(db: Any) -> Any:
    return _resolve_categories(_load_liga_settings(db))


SETTINGS_COLLECTION = "predictor_settings"
SETTINGS_DOC = "current"


def predictor_settings(db: Any) -> dict:
    """The admin-only predictor settings document (empty dict before the first save)."""
    snap = db.collection(SETTINGS_COLLECTION).document(SETTINGS_DOC).get()
    return (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}


def load_config(db: Any) -> vp.PredictorConfig:
    saved = predictor_settings(db).get("config")
    if isinstance(saved, dict):
        return vp.PredictorConfig.from_dict(saved)
    return vp.PredictorConfig.from_settings(league_settings(db))


def _iso(value: Any) -> str | None:
    if value is None:
        return None
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return str(value) or None


def _agent_fields(data: dict) -> dict:
    """Internal fields the division agent's review filter uses (never sent to the browser)."""
    reg = data.get("registration") or {}
    lc = data.get("ligaCategory") or {}
    return {
        # When registration first became complete; older riders fall back to their data-policy acceptance.
        "registeredAt": _iso(reg.get("completedAt") or (reg.get("dataPolicy") or {}).get("acceptedAt")),
        "locked": bool(lc.get("locked")),
        "assignedFrom": (lc.get("manualAssigned") or {}).get("assignedFrom"),
    }


def load_participants(db: Any) -> list[dict]:
    """Participant rows for every registered rider (same rows as `/participants`)."""
    rank_cats = load_categories(db)
    rows = []
    for user in UserService.get_all_participants(limit=PARTICIPANT_LIMIT):
        try:
            row, _ = build_participant_row(user, serialize_liga_category, rank_cats)
            # Internal only (Strava curve cache key); never sent to the browser by these routes.
            row["userDocId"] = str(user.id)
            row["hasStrava"] = bool((user._data.get("connections") or {}).get("strava"))
            row.update(_agent_fields(user._data))
            rows.append(row)
        except Exception as exc:
            logger.warning("predictor: skipping malformed participant %s: %s", getattr(user, "id", "?"), exc)
    return rows


PARTICIPANTS_CACHE_TTL_SECONDS = 120
_participants_cache: dict[str, tuple[float, list[dict]]] = {}


def cached_participants(db: Any) -> list[dict]:
    """Participant rows, reused for two minutes so typing in the admin form does not
    re-read every user document on each prediction request."""
    now = time.monotonic()
    hit = _participants_cache.get("rows")
    if hit and now - hit[0] < PARTICIPANTS_CACHE_TTL_SECONDS:
        return hit[1]
    rows = load_participants(db)
    _participants_cache["rows"] = (now, rows)
    return rows


def clear_caches() -> None:
    _participants_cache.clear()
    vp.clear_model_cache()


def get_model(
    db: Any,
    config: vp.PredictorConfig | None = None,
    participants: list[dict] | None = None,
) -> tuple[vp.Model | None, list[dict], Any]:
    """Return (model, participants, categories). The model is cached per config for 10 minutes."""
    cfg = config or load_config(db)
    cats = load_categories(db)
    if participants is not None:
        return vp.build_model(participants, cfg, cats), participants, cats
    rows = cached_participants(db)
    model = vp.cached_model(cfg.fingerprint(), lambda: vp.build_model(rows, cfg, cats))
    return model, rows, cats


def division_agent_settings(db: Any) -> dict:
    """`league/settings.divisionAgent` with defaults."""
    raw = league_settings(db).get("divisionAgent")
    raw = raw if isinstance(raw, dict) else {}
    min_rides = raw.get("minZwiftRides")
    max_per_run = raw.get("maxPerRun")
    model = raw.get("assessModel")
    chat_model = raw.get("chatModel")
    return {
        "minZwiftRides": min_rides if isinstance(min_rides, int) and not isinstance(min_rides, bool)
        and 1 <= min_rides <= 200 else 15,
        "enabled": raw.get("enabled") is not False,
        "assessModel": model if isinstance(model, str) and model.startswith("claude-") else "claude-haiku-5-5",
        "maxPerRun": max_per_run if isinstance(max_per_run, int) and not isinstance(max_per_run, bool)
        and 1 <= max_per_run <= 50 else 8,
        "chatModel": chat_model if isinstance(chat_model, str) and chat_model.startswith("claude-")
        else "claude-haiku-5-5",
        # Off by default: every Discord reply waits for an admin's Send / Edit / Reject.
        "autoReply": raw.get("autoReply") is True,
        # Which riders the agent checks (limits AND any ticked reason); see division_agent.triage.
        "reviewFilter": triage_filter(raw.get("reviewFilter")),
    }


def triage_filter(raw: Any) -> dict:
    from services.division_agent.triage import normalize_filter  # avoids an import cycle
    return normalize_filter(raw)


def zwift_predictions(model: vp.Model | None, participants: list[dict], cats: Any) -> dict[str, dict]:
    """Zwift-power prediction for every participant, keyed by zwiftId."""
    return {
        str(p.get("zwiftId")): vp.predict_inputs(model, vp.inputs_from_participant(p), cats)
        for p in participants
        if p.get("zwiftId")
    }


def save_config(
    db: Any,
    config: vp.PredictorConfig,
    *,
    saved_by: str,
    reason: str = "",
    metrics: dict | None = None,
) -> dict:
    """Save a new active config; the previous one is pushed onto the history.

    Writes only `predictor_settings/current`, never the public `league/settings`.
    """
    current = predictor_settings(db)
    previous = load_config(db).to_dict()
    history = current.get("history")
    history = list(history) if isinstance(history, list) else []
    now = datetime.now(timezone.utc).isoformat()
    history.insert(0, {
        "config": previous,
        "metrics": current.get("metrics"),
        "replacedAt": now,
        "replacedBy": saved_by,
        "reason": reason,
    })
    doc = {
        "config": config.to_dict(),
        "history": history[:HISTORY_LIMIT],
        "metrics": metrics,
        "updatedAt": now,
    }
    db.collection(SETTINGS_COLLECTION).document(SETTINGS_DOC).set(doc)
    vp.clear_model_cache()
    return doc
