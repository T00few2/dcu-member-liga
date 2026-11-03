"""Loads data for the vELO predictor and keeps its settings in Firestore.

`league/settings` fields owned here:
- `predictorConfig`: the active `PredictorConfig` (replaces `predictorFeatures`)
- `predictorConfigHistory`: earlier configs, newest first, so a change can be rolled back
- `predictorMetrics`: the latest tuning metrics for the active config
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


def load_config(db: Any) -> vp.PredictorConfig:
    return vp.PredictorConfig.from_settings(league_settings(db))


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
    return {
        "minZwiftRides": min_rides if isinstance(min_rides, int) and not isinstance(min_rides, bool) else 15,
    }


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
    """Save a new active config; the previous one is pushed onto the history."""
    settings = league_settings(db)
    previous = settings.get("predictorConfig")
    if not isinstance(previous, dict):
        previous = vp.PredictorConfig.from_settings(settings).to_dict()
    history = settings.get("predictorConfigHistory")
    history = list(history) if isinstance(history, list) else []
    now = datetime.now(timezone.utc).isoformat()
    history.insert(0, {
        "config": previous,
        "metrics": settings.get("predictorMetrics"),
        "replacedAt": now,
        "replacedBy": saved_by,
        "reason": reason,
    })
    update = {
        "predictorConfig": config.to_dict(),
        "predictorConfigHistory": history[:HISTORY_LIMIT],
        # Keep the legacy field in step until nothing reads it any more.
        "predictorFeatures": dict(config.features),
        "predictorConfigUpdatedAt": now,
    }
    update["predictorMetrics"] = metrics if metrics is not None else None
    db.collection("league").document("settings").set(update, merge=True)
    vp.clear_model_cache()
    return update
