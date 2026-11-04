"""Who the division agent should look at."""
from __future__ import annotations

from services import velo_predictor as vp

NO_VELO = "no_velo"
FEW_RIDES = "few_rides"


def needs_review(row: dict, settings: dict) -> list[str]:
    """Reason codes for a participant row (empty when the rider's vELO can be trusted)."""
    if vp.reliable_velo(row, settings["minZwiftRides"]) is not None:
        return []
    reasons = []
    current = vp.to_float(row.get("rating"))
    max30 = vp.to_float(row.get("max30Rating"))
    if not (current and current > 0) and not (max30 and max30 > 0):
        reasons.append(NO_VELO)
    rides = row.get("zwiftActivityCount")
    if not isinstance(rides, int) or isinstance(rides, bool) or rides < settings["minZwiftRides"]:
        reasons.append(FEW_RIDES)
    return reasons
