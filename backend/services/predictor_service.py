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

from services.category_engine import effective_liga_category_name, serialize_liga_category
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
        # When registration first became complete. Riders who registered before this field existed have
        # none and never count as new signups (dataPolicy.acceptedAt moves on every re-acceptance).
        "registeredAt": _iso(reg.get("completedAt")),
        "locked": bool(lc.get("locked")),
        "assignedFrom": (lc.get("manualAssigned") or {}).get("assignedFrom"),
    }


def load_participants(db: Any) -> list[dict]:
    """Participant rows for every registered rider (same rows as `/participants`)."""
    from services import league_performance as lp

    rank_cats = load_categories(db)
    try:
        performances = league_performances(db)
    except Exception as exc:  # league results are extra; the predictor works without them
        logger.warning("predictor: league results unavailable: %s", exc)
        performances = {}
    rows = []
    for user in UserService.get_all_participants(limit=PARTICIPANT_LIMIT):
        try:
            row, _ = build_participant_row(user, serialize_liga_category, rank_cats)
            # Internal only: results in the rider's current division (for the "struggling" check).
            division = effective_liga_category_name(user._data.get("ligaCategory") or {}, rank_cats) or None
            raced = performances.get(str(row.get("zwiftId")))
            row["league"] = lp.rider_summary(raced, division=division) if raced and division else None
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


LEAGUE_CACHE_TTL_SECONDS = 600
MAX_HISTORY_DAYS = 400
_league_cache: dict[str, tuple[float, Any]] = {}


def _cached(key: str, load) -> Any:
    now = time.monotonic()
    hit = _league_cache.get(key)
    if hit and now - hit[0] < LEAGUE_CACHE_TTL_SECONDS:
        return hit[1]
    value = load()
    _league_cache[key] = (now, value)
    return value


def load_league_races(db: Any) -> list[tuple[dict, Any]]:
    """`(race, start)` for every race document (start in UTC, None when unparseable)."""
    from services.race_signups import parse_race_date  # imported lazily: it pulls in the app's db

    out = []
    for snap in db.collection("races").stream():
        data = snap.to_dict() or {}
        data["id"] = str(snap.id)
        out.append((data, parse_race_date(data.get("date"))))
    return out


def league_races(db: Any) -> list[tuple[dict, Any]]:
    return _cached("races", lambda: load_league_races(db))


def league_performances(db: Any) -> dict[str, list[dict]]:
    """Every rider's finalized league results this season, keyed by zwiftId (cached 10 minutes)."""
    from services import league_performance as lp

    return _cached("performances", lambda: lp.by_rider(lp.all_performances(league_races(db))))


def observations(db: Any) -> list[dict]:
    """Stored point-in-time league observations (cached 10 minutes)."""
    from services import predictor_observations as po

    return _cached("observations", lambda: po.read_all(db))


def strava_history_days(db: Any, now: datetime | None = None) -> int | None:
    """How far back Strava ride lists must reach so a curve can be rebuilt for the first
    finalized race of the season: back to its start, plus the longest tuning window."""
    from services import league_performance as lp

    starts = [s for r, s in league_races(db) if s is not None and lp.is_finalized(r)]
    if not starts:
        return None
    age = ((now or datetime.now(timezone.utc)) - min(starts)).days + 1
    return min(MAX_HISTORY_DAYS, max(0, age) + max(vp.STRAVA_WINDOWS))


def clear_league_cache() -> None:
    _league_cache.clear()


def clear_caches() -> None:
    _participants_cache.clear()
    _league_cache.clear()
    vp.clear_model_cache()


def get_model(
    db: Any,
    config: vp.PredictorConfig | None = None,
    participants: list[dict] | None = None,
) -> tuple[vp.Model | None, list[dict], Any]:
    """Return (model, participants, categories). The model is cached per config for 10 minutes."""
    cfg = config or load_config(db)
    cats = load_categories(db)
    # League observations are only read when the config trains on them.
    obs = observations(db) if cfg.targetSource != "velo" else None
    if participants is not None:
        return vp.build_model(participants, cfg, cats, obs), participants, cats
    rows = cached_participants(db)
    model = vp.cached_model(cfg.fingerprint(), lambda: vp.build_model(rows, cfg, cats, obs))
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
