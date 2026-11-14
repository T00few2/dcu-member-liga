"""The deterministic division suggestion (Claude explains it; it never invents numbers)."""
from __future__ import annotations

from services import velo_predictor as vp

INSUFFICIENT_DATA = "insufficient_data"
STRUGGLING = "struggling"


def suggest(evidence: dict, categories) -> dict:
    """`{category, velo, source, confidence}`, or `category=None` when nothing usable exists.

    Preference: Strava (unless its confidence is low), then Zwift power, then the
    rider's real vELO, then a low-confidence Strava prediction.

    A rider reviewed only because they struggle in league races is handled by
    `_struggling` instead: one division down, or no change.
    """
    strava = (evidence.get("strava") or {}).get("prediction") or {}
    zwift = (evidence.get("zwift") or {}).get("prediction") or {}
    if evidence.get("reasons") == [STRUGGLING]:
        return _struggling(evidence, strava, zwift)
    if strava.get("velo") is not None and strava.get("confidence") != "low":
        return _pick(strava, "strava")
    if zwift.get("velo") is not None:
        return _pick(zwift, "zwift")
    velo = evidence.get("velo") or {}
    real = max((v for v in (velo.get("current"), velo.get("max30")) if v and v > 0), default=None)
    if real:
        return {"category": vp.category_for_velo(real, categories), "velo": round(real),
                "source": "velo", "confidence": "low"}
    if strava.get("velo") is not None:
        return _pick(strava, "strava")
    return {"category": None, "velo": None, "source": INSUFFICIENT_DATA, "confidence": "low"}


def _struggling(evidence: dict, strava: dict, zwift: dict) -> dict:
    """One division down for a struggling rider, but only when the rider is held up (the
    division is harder than the rider's own vELO says, or that vELO is unreliable) and the
    power prediction does not put the rider in the current division or a harder one.

    Results alone cannot tell how far down a rider belongs (everyone a rider finishes
    among is in the same division), so the move is never more than one division.
    """
    names = list(evidence.get("divisions") or [])
    current = evidence.get("currentCategory")
    league = evidence.get("league") or {}
    stay = {"category": current, "velo": league.get("performanceVelo"), "source": "league", "confidence": "medium"}
    if current not in names or names.index(current) == len(names) - 1 or not evidence.get("heldUp"):
        return stay
    power = strava if strava.get("velo") is not None and strava.get("confidence") != "low" else zwift
    if power.get("velo") is None:
        return {**stay, "category": names[names.index(current) + 1], "confidence": "low"}
    if power.get("category") in names and names.index(power["category"]) > names.index(current):
        return {**stay, "category": names[names.index(current) + 1], "velo": power.get("velo")}
    return stay


def _pick(prediction: dict, source: str) -> dict:
    return {
        "category": prediction.get("category"),
        "velo": prediction.get("velo"),
        "source": source,
        "confidence": prediction.get("confidence") or "medium",
    }


def needs_proposal(evidence: dict, suggestion: dict) -> bool:
    """Propose only a change (or a first division), or a manual look when data is missing."""
    current = evidence.get("currentCategory")
    if suggestion.get("category") is None:
        return not current  # no data and no division: an admin has to look
    return suggestion["category"] != current
