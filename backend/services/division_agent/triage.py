"""Who the division agent should look at: the admin's review filter.

The filter (`league/settings.divisionAgent.reviewFilter`) has two parts:
- limits that narrow the group (all ticked ones must hold): new signups within N days,
  non-locked riders, riders with Strava, and skipping riders an admin placed by hand;
- reasons (any ticked one is enough): no vELO, no max30 vELO, few Zwift rides, no division.
"""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

from services import velo_predictor as vp

NO_VELO = "no_velo"
NO_MAX30 = "no_max30"
FEW_RIDES = "few_rides"
NO_DIVISION = "no_division"
REASONS = (NO_VELO, NO_MAX30, FEW_RIDES, NO_DIVISION)

DEFAULT_FILTER: dict[str, Any] = {
    # limits
    "newSignupsDays": None,      # int: only riders registered within this many days
    "onlyUnlocked": False,
    "onlyWithStrava": False,
    "skipAdminPlaced": False,
    # reasons (any one is enough)
    "reasons": [NO_VELO, NO_MAX30, FEW_RIDES],
}


def normalize_filter(raw: Any) -> dict:
    """A valid filter from stored or posted data; unknown or bad values fall back to defaults."""
    raw = raw if isinstance(raw, dict) else {}
    days = raw.get("newSignupsDays")
    days = days if isinstance(days, int) and not isinstance(days, bool) and 1 <= days <= 365 else None
    reasons = raw.get("reasons")
    if isinstance(reasons, list):
        reasons = [r for r in REASONS if r in reasons]
    else:
        reasons = list(DEFAULT_FILTER["reasons"])
    return {
        "newSignupsDays": days,
        "onlyUnlocked": raw.get("onlyUnlocked") is True,
        "onlyWithStrava": raw.get("onlyWithStrava") is True,
        "skipAdminPlaced": raw.get("skipAdminPlaced") is True,
        "reasons": reasons,
    }


def _positive(value: Any) -> bool:
    v = vp.to_float(value)
    return bool(v and v > 0)


def _registered_at(row: dict) -> datetime | None:
    value = row.get("registeredAt")
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    if isinstance(value, str) and value:
        try:
            dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            return None
    return None


def in_group(row: dict, flt: dict, now: datetime | None = None) -> bool:
    """Every ticked limit holds for this rider."""
    if flt.get("newSignupsDays"):
        when = _registered_at(row)
        if when is None or when < (now or datetime.now(timezone.utc)) - timedelta(days=flt["newSignupsDays"]):
            return False
    if flt.get("onlyUnlocked") and row.get("locked"):
        return False
    if flt.get("onlyWithStrava") and not row.get("hasStrava"):
        return False
    if flt.get("skipAdminPlaced") and row.get("assignedFrom") == "admin":
        return False
    return True


def reasons_for(row: dict, flt: dict, min_rides: int) -> list[str]:
    """The ticked reasons that apply to this rider."""
    ticked = set(flt.get("reasons") or [])
    out = []
    if NO_VELO in ticked and not _positive(row.get("rating")):
        out.append(NO_VELO)
    if NO_MAX30 in ticked and not _positive(row.get("max30Rating")):
        out.append(NO_MAX30)
    if FEW_RIDES in ticked:
        rides = row.get("zwiftActivityCount")
        if not isinstance(rides, int) or isinstance(rides, bool) or rides < min_rides:
            out.append(FEW_RIDES)
    if NO_DIVISION in ticked:
        cat = row.get("category")
        if not cat or cat == "N/A":
            out.append(NO_DIVISION)
    return out


def matches(row: dict, settings: dict, now: datetime | None = None) -> dict:
    """`{inGroup, reasons}` for the preview and for `needs_review`."""
    flt = normalize_filter(settings.get("reviewFilter"))
    if not in_group(row, flt, now):
        return {"inGroup": False, "reasons": []}
    return {"inGroup": True, "reasons": reasons_for(row, flt, settings["minZwiftRides"])}


def needs_review(row: dict, settings: dict, now: datetime | None = None) -> list[str]:
    """Reason codes for a participant row (empty when the filter says to leave the rider alone)."""
    return matches(row, settings, now)["reasons"]
