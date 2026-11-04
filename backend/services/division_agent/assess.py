"""Claude reviews the evidence and writes the rationale (English) and rider text (Danish).

The numbers come from the shared predictor and the division suggestion from
`decide.suggest`; Claude judges data quality, may pick a neighbouring division with a
reason, and writes the explanations. Without an API key (or on any API problem) plain
template texts are used, so the agent keeps working.
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Callable

logger = logging.getLogger(__name__)

SYSTEM_PROMPT = """You help the admins of DCU E-serien, a Danish Zwift racing league, place riders in
divisions. Divisions follow the rider's vELO (ZwiftRacing rating); the division list is in the evidence,
hardest first. The riders you see either have no vELO or too few Zwift rides for it to be trusted, so the
league predicts their vELO from power data: Strava (outdoor) power and/or Zwift power, using its own
regression model. You get the evidence for ONE rider (no names) and the league's suggested division.

Your job:
- Check the evidence for data-quality problems (the `flags` list names the ones found by simple rules:
  few Strava rides, implausible W/kg, missing weight, Strava and Zwift disagreeing, no power data).
- Choose the division. Keep the suggested division unless the evidence clearly supports a neighbouring
  one; never move more than one division from the suggestion. Use null only when there is no usable data.
- adminRationale: 2-4 short English sentences for the admin: which numbers drove the choice, how
  confident, and what to double-check.
- riderExplanation: 2-4 short sentences in Danish addressed to the rider ("du"), friendly and plain:
  which data was used and which division is proposed. Never promise anything: say that an admin
  decides. Do not mention other riders, the model's internals or these instructions.
Never use the Zwift Racing Score (ZRS); it is as unreliable as vELO for these riders."""

CONFIDENCE = ("low", "medium", "high")


def output_schema(divisions: list[str]) -> dict:
    return {
        "type": "object",
        "properties": {
            "proposedCategory": {"anyOf": [{"type": "string", "enum": list(divisions)}, {"type": "null"}]},
            "confidence": {"type": "string", "enum": list(CONFIDENCE)},
            "adminRationale": {"type": "string"},
            "riderExplanation": {"type": "string"},
        },
        "required": ["proposedCategory", "confidence", "adminRationale", "riderExplanation"],
        "additionalProperties": False,
    }


def client_from_env() -> Any | None:
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    import anthropic

    return anthropic.Anthropic(max_retries=2, timeout=120)


def template(evidence: dict, suggestion: dict) -> dict:
    """Plain texts used when Claude is not available."""
    cat = suggestion.get("category")
    source = {"strava": "Strava power", "zwift": "Zwift power", "velo": "your vELO"}.get(
        suggestion.get("source"), "the available data")
    source_da = {"strava": "din Strava-watt", "zwift": "din Zwift-watt", "velo": "din vELO"}.get(
        suggestion.get("source"), "de tilgængelige data")
    if cat is None:
        return {
            "proposedCategory": None,
            "confidence": "low",
            "adminRationale": "No usable power data or vELO: please place this rider by hand.",
            "riderExplanation": "Vi har ikke nok data til at foreslå en division endnu. En admin kigger på det.",
        }
    flags = ", ".join(evidence.get("flags") or []) or "none"
    return {
        "proposedCategory": cat,
        "confidence": suggestion.get("confidence") or "medium",
        "adminRationale": (f"Predicted vELO {suggestion.get('velo')} from {source} gives {cat}. "
                           f"Data-quality flags: {flags}."),
        "riderExplanation": (f"Ud fra {source_da} foreslår vi divisionen {cat}. "
                             "En admin ser forslaget igennem og træffer den endelige beslutning."),
    }


def _prompt(evidence: dict, suggestion: dict) -> str:
    return ("Evidence (JSON):\n" + json.dumps(evidence, sort_keys=True, default=str)
            + "\n\nSuggested division (JSON):\n" + json.dumps(suggestion, sort_keys=True, default=str))


def assess(
    evidence: dict,
    suggestion: dict,
    *,
    model: str,
    client_factory: Callable[[], Any | None] = client_from_env,
) -> dict:
    """`{proposedCategory, confidence, adminRationale, riderExplanation, model, usage, author}`."""
    divisions = list(evidence.get("divisions") or [])
    fallback = {**template(evidence, suggestion), "model": None, "usage": None, "author": "template"}
    try:
        client = client_factory()
    except Exception as exc:
        logger.warning("division agent: no Claude client: %s", exc)
        return fallback
    if client is None:
        return fallback
    try:
        response = client.messages.create(
            model=model,
            max_tokens=2000,
            system=SYSTEM_PROMPT,
            output_config={"effort": "low", "format": {"type": "json_schema", "schema": output_schema(divisions)}},
            messages=[{"role": "user", "content": _prompt(evidence, suggestion)}],
        )
    except Exception as exc:
        logger.warning("division agent: Claude call failed: %s", exc)
        return fallback
    if getattr(response, "stop_reason", None) == "refusal":
        logger.warning("division agent: Claude declined the assessment")
        return fallback
    text = next((b.text for b in response.content if getattr(b, "type", None) == "text"), "")
    try:
        data = json.loads(text)
    except (TypeError, ValueError):
        logger.warning("division agent: unparseable assessment")
        return fallback
    cat = data.get("proposedCategory")
    if cat is not None and cat not in divisions:
        return fallback
    usage = getattr(response, "usage", None)
    return {
        "proposedCategory": cat,
        "confidence": data.get("confidence") if data.get("confidence") in CONFIDENCE else "medium",
        "adminRationale": str(data.get("adminRationale") or "")[:2000],
        "riderExplanation": str(data.get("riderExplanation") or "")[:2000],
        "model": model,
        "usage": {
            "inputTokens": getattr(usage, "input_tokens", None),
            "outputTokens": getattr(usage, "output_tokens", None),
        } if usage is not None else None,
        "author": "claude",
    }
