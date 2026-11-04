"""The deterministic division suggestion (Claude explains it; it never invents numbers)."""
from __future__ import annotations

from services import velo_predictor as vp

INSUFFICIENT_DATA = "insufficient_data"


def suggest(evidence: dict, categories) -> dict:
    """`{category, velo, source, confidence}`, or `category=None` when nothing usable exists.

    Preference: Strava (unless its confidence is low), then Zwift power, then the
    rider's real vELO, then a low-confidence Strava prediction.
    """
    strava = (evidence.get("strava") or {}).get("prediction") or {}
    zwift = (evidence.get("zwift") or {}).get("prediction") or {}
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
