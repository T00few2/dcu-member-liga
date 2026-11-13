"""Everything the division agent knows about one rider, without names or contact data.

Numbers come from the shared vELO predictor; data-quality problems are flagged here by
plain rules, so the model only judges and explains them.
"""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services import strava_rate
from services import velo_predictor as vp
from services.category_engine import ZR_CATEGORIES, effective_liga_category_name
from services.strava_cache_warmer import BUDGET_FRACTION, LIST_REQUESTS, REFRESH_AFTER_DAYS
from services.strava_power_curve import StravaBudgetExceeded, get_strava_power_curve, read_cached_curve

logger = logging.getLogger(__name__)

# Data-quality flags
FEW_STRAVA_RIDES = "few_strava_rides"
IMPLAUSIBLE_WKG = "implausible_wkg"
NO_WEIGHT = "no_weight"
SOURCES_DISAGREE = "strava_zwift_disagree"
NO_POWER_DATA = "no_power_data"

MAX_PLAUSIBLE_WKG = {"wkg5s": 25.0, "wkg20m": 6.5}


class WaitingForStrava(Exception):
    """The rider's Strava curve must be fetched, but the Strava budget is used up for now."""


def division_names(categories: Any) -> list[str]:
    return [name for name, _lo, _hi in (categories or ZR_CATEGORIES)]


def division_distance(a: str | None, b: str | None, categories: Any) -> int | None:
    names = division_names(categories)
    if a not in names or b not in names:
        return None
    return abs(names.index(a) - names.index(b))


def _parse(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _fresh(entry: dict | None, now: datetime) -> bool:
    """Recent and in the indoor/outdoor split format (older entries are re-fetched)."""
    computed = _parse((entry or {}).get("computedAt"))
    return bool((entry or {}).get("split") and computed and computed > now - timedelta(days=REFRESH_AFTER_DAYS))


def strava_budget(db: Any, now: Callable[[], datetime]) -> Callable[..., bool]:
    """Same 75% Strava budget as the cache warm-up (shared counters, re-read each time)."""
    def fits(streams: int, window_used_before: int | None = None) -> bool:
        try:
            stored = strava_rate.load(db)
        except Exception:
            stored = {}
        return strava_rate.within_budget(strava_rate.combined(stored), streams, BUDGET_FRACTION, now(),
                                         window_used_before=window_used_before)
    return fits


def strava_curve(
    db: Any,
    row: dict,
    days: int,
    *,
    strava_service: Any,
    compute_curve: Callable[[str, list], dict],
    now: Callable[[], datetime] = lambda: datetime.now(timezone.utc),
) -> dict | None:
    """The rider's cached Strava curve, fetched when missing or older than 30 days.

    Raises `WaitingForStrava` when a fetch is needed but the Strava budget says no.
    """
    doc_id = str(row.get("userDocId") or "")
    if not doc_id:
        return None
    cached = read_cached_curve(db, doc_id, days)
    if _fresh(cached, now()) or not row.get("hasStrava"):
        return cached
    fits = strava_budget(db, now)
    if not fits(LIST_REQUESTS):
        raise WaitingForStrava()
    before15 = strava_rate.current_usage(strava_rate.combined(strava_rate.load(db)), now())["usage15"]
    try:
        return get_strava_power_curve(
            db, strava_service, doc_id, days, compute_curve=compute_curve, refresh=True,
            also_days=vp.STRAVA_WINDOWS,
            budget=lambda n: fits(n, window_used_before=before15),
        )
    except StravaBudgetExceeded as exc:
        raise WaitingForStrava() from exc


def held_up(row: dict, current: str | None, categories: Any, min_rides: int) -> dict:
    """Is the rider's division harder than their own vELO says, or is that vELO unreliable?

    Only such riders may be proposed for a move down when they struggle: a rider whose
    reliable vELO belongs in the division stays there, whatever the results.
    """
    names = division_names(categories)
    real = max((v for v in (vp.to_float(row.get("rating")), vp.to_float(row.get("max30Rating"))) if v and v > 0),
               default=None)
    velo_division = vp.category_for_velo(real, categories) if real else None
    reliable = vp.reliable_velo(row, min_rides) is not None
    above = bool(current in names and velo_division in names and names.index(current) < names.index(velo_division))
    return {"heldUp": bool(not reliable or above), "veloReliable": reliable, "veloDivision": velo_division,
            "aboveVeloDivision": above}


def gather(
    row: dict,
    user_data: dict,
    *,
    model: vp.Model | None,
    categories: Any,
    curve_entry: dict | None,
    reasons: list[str],
    min_rides: int = vp.LEAGUE_MIN_RIDES,
) -> dict:
    """Evidence for one rider. ZRS is never used: it is as unreliable as vELO here."""
    lc = user_data.get("ligaCategory") or {}
    kg = (vp.to_float(row.get("weightInGrams")) or 0.0) / 1000
    flags: list[str] = []
    if kg <= 0:
        flags.append(NO_WEIGHT)

    zwift_inputs = {**vp.inputs_from_participant(row), "racingScore": 0.0}
    zwift_pred = vp.predict_inputs(model, zwift_inputs, categories)
    zwift = None
    if zwift_pred.get("velo") is not None:
        zwift = {"prediction": zwift_pred, "inputs": zwift_inputs}

    strava = None
    curve = (curve_entry or {}).get("curve") or {}
    if curve and kg > 0:
        split = vp.strava_split_inputs(curve_entry, kg)
        scale = model.config.stravaPowerScale if model is not None else None
        race_scale = model.config.outdoorRaceScale if model is not None else None
        # Indoor-equivalent: outdoor efforts get the outdoor→indoor correction, indoor ones do not.
        inputs = vp.strava_inputs(split, scale, race_scale=race_scale)
        sources = vp.strava_sources(split, scale, race_scale)
        count = int((curve_entry or {}).get("activityCount") or 0)
        pred = vp.predict_inputs(model, inputs, categories, source="strava", activity_count=count)
        strava = {
            "days": (curve_entry or {}).get("days"),
            "activityCount": count,
            "indoorCount": (curve_entry or {}).get("indoorCount"),
            "outdoorCount": (curve_entry or {}).get("outdoorCount"),
            "outdoorRaceCount": (curve_entry or {}).get("outdoorRaceCount"),
            "bestFrom": sources,
            # Share of the durations whose best comes from outdoor riding (0 to 1).
            "outdoorShare": round(sum(1 for v in sources.values() if v != "indoor") / len(sources), 2)
            if sources else None,
            "computedAt": (curve_entry or {}).get("computedAt"),
            "inputs": inputs,
            "prediction": pred,
        }
        if model is not None and count < model.config.minStravaActivities:
            flags.append(FEW_STRAVA_RIDES)
        if any(inputs.get(k, 0) > limit for k, limit in MAX_PLAUSIBLE_WKG.items()):
            flags.append(IMPLAUSIBLE_WKG)

    if zwift and strava:
        gap = division_distance(zwift["prediction"].get("category"), strava["prediction"].get("category"),
                                categories)
        if gap is not None and gap > 1:
            flags.append(SOURCES_DISAGREE)
    if zwift is None and strava is None:
        flags.append(NO_POWER_DATA)

    current = effective_liga_category_name(lc, categories) or None
    league = row.get("league") if isinstance(row.get("league"), dict) and row["league"].get("races") else None
    return {
        "reasons": list(reasons),
        # Results in the current division this season (None before the first league race).
        "league": league,
        **held_up(row, current, categories, min_rides),
        "currentCategory": current,
        "locked": bool(lc.get("locked")),
        "velo": {
            "current": vp.to_float(row.get("rating")),
            "max30": vp.to_float(row.get("max30Rating")),
            "max90": vp.to_float(row.get("max90Rating")),
        },
        "zwiftActivityCount": row.get("zwiftActivityCount"),
        "weightKg": round(kg, 1) if kg > 0 else None,
        "hasStrava": bool(row.get("hasStrava")),
        "zwift": zwift,
        "strava": strava,
        "flags": flags,
        "divisions": division_names(categories),
    }


def fingerprint(evidence: dict) -> str:
    """Changes when the data behind a decision changes (new curve, new ratings, more rides).

    The current division is left out on purpose: an admin's approve or edit changes it,
    and that must not re-open the rider until new data arrives."""
    key = {
        "velo": evidence.get("velo"),
        "rides": evidence.get("zwiftActivityCount"),
        "strava": (evidence.get("strava") or {}).get("computedAt"),
    }
    if evidence.get("league"):  # a new league race re-opens the rider; riders without races keep their key
        key["leagueRaces"] = evidence["league"].get("races")
    return hashlib.sha1(json.dumps(key, sort_keys=True, default=str).encode()).hexdigest()[:16]
