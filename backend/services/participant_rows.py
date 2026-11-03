"""Participant rows shared by `/participants` and the vELO predictor.

One function builds the per-rider power/rating row so the admin predictor page,
the division agent and predictor tuning all train on exactly the same data.
"""
from __future__ import annotations

from typing import Any, Callable

from services.power_curve_quality import corrected_watts, is_padded_effort, points_watts


def activity_count_in_range(source: dict | None) -> int | None:
    """Ride count for the CP window (typically 90d) from a power-profile payload or stored snapshot."""
    if not isinstance(source, dict):
        return None
    top = source.get("activityCountInRange")
    if isinstance(top, bool):
        return None
    if isinstance(top, (int, float)):
        return int(top)
    cbe = source.get("cpBestEfforts")
    if isinstance(cbe, dict):
        nested = cbe.get("activityCountInRange")
        if isinstance(nested, bool):
            return None
        if isinstance(nested, (int, float)):
            return int(nested)
    return None


def build_participant_row(
    user: Any,
    serialize_liga_category: Callable[..., Any],
    rank_cats: Any = None,
) -> tuple[dict, bool]:
    """Return (row, cp5s_was_repaired) for one registered rider.

    `serialize_liga_category` is passed in so callers keep control over how the
    category block is rendered (and tests can stub it).
    """
    data = user._data
    zr = data.get("zwiftRacing", {}) or {}
    zpro = data.get("zwiftProfile", {}) or {}
    lc = serialize_liga_category(data.get("ligaCategory"), rank_cats)

    zpc = data.get("zwiftPowerCurve", {}) or {}
    relevant_efforts = {
        e["duration"]: e
        for e in (zpc.get("relevantCpEfforts") or [])
        if isinstance(e, dict) and "duration" in e
    }
    curve_points = points_watts(zpc)

    def cp(duration_sec: int) -> int | None:
        effort = relevant_efforts.get(duration_sec)
        if effort:
            w = effort.get("watts")
            return round(w) if w else None
        return None

    def sprint_cp(duration_sec: int) -> tuple[int | None, bool]:
        """Short-duration CP, repaired when the curve shows it is a padded spike.

        A trainer glitch inflates every window long enough to contain it, and
        these feed the vELO regression as raw, absolute and squared features.
        The clean part of the curve brackets the real effort closely enough to
        estimate it, so the value is rebuilt rather than discarded; it is only
        dropped when the curve offers nothing clean to anchor against.
        """
        if not is_padded_effort(curve_points, duration_sec):
            return cp(duration_sec), False
        repaired = corrected_watts(curve_points, duration_sec)
        return (round(repaired) if repaired is not None else None), True

    cp5s, cp5s_estimated = sprint_cp(5)

    row = {
        "name": user.name,
        "zwiftId": user.zwift_id,
        "club": user.club,
        "category": (lc.get("category") if lc else None) or "N/A",
        "zftp": zpro.get("zftp", "N/A"),
        "zmap": zpro.get("zmap", "N/A"),
        "zwiftCategory": zpro.get("category", "N/A"),
        "male": zpro.get("male") if isinstance(zpro.get("male"), bool) else None,
        # competitionMetrics weight is what Zwift divides by for its own
        # wattsKg, so preferring it keeps our W/kg equal to Zwift's.
        "weightInGrams": zpro.get("weightInGrams") or zpro.get("weight"),
        "cp5s": cp5s,
        "cp5sEstimated": cp5s_estimated,
        "cp15s": cp(15),
        "cp1min": cp(60),
        "cp5min": cp(300),
        "cp20min": cp(1200),
        "rating": zr.get("currentRating", "N/A"),
        "max30Rating": zr.get("max30Rating", "N/A"),
        "max90Rating": zr.get("max90Rating", "N/A"),
        "phenotype": zr.get("phenotype", "N/A"),
        "racingScore": zpro.get("racingScore", "N/A"),
        "ligaCategory": lc,
        "zwiftActivityCount": activity_count_in_range(zpc),
    }
    return row, cp5s_estimated
