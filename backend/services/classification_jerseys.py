"""Normalize the three competition jerseys stored on league/settings."""
from __future__ import annotations

from typing import Any

from services.zwift_game import jersey_image_url

CLASSIFICATION_JERSEY_KEYS = ("individual", "sprint", "kom")
CLASSIFICATION_JERSEY_LABELS = {
    "individual": "førertrøjen (Individuel)",
    "sprint": "sprinttrøjen",
    "kom": "bjergtrøjen (KOM)",
}


def reserved_classification_signatures(saved: dict[str, Any] | None) -> dict[int, str]:
    """Signature -> label for every saved competition jersey; these cannot be club kits."""
    out: dict[int, str] = {}
    for key in CLASSIFICATION_JERSEY_KEYS:
        row = (saved or {}).get(key)
        if not isinstance(row, dict):
            continue
        try:
            signature = int(row.get("jerseySignature"))
        except (TypeError, ValueError):
            continue
        out.setdefault(signature, CLASSIFICATION_JERSEY_LABELS[key])
    return out


def classification_club_kit_conflicts(
    stored: dict[str, Any] | None,
    club_kits: list[dict[str, Any]] | None,
) -> list[str]:
    """Messages for each competition jersey already used as a club kit."""
    reserved = reserved_classification_signatures(stored)
    conflicts: list[str] = []
    for row in club_kits or []:
        try:
            signature = int(row.get("jerseySignature"))
        except (TypeError, ValueError):
            continue
        label = reserved.get(signature)
        if label:
            conflicts.append(f"{label} er klubtrøje for {row.get('club') or 'ukendt klub'}")
    return conflicts


def stored_classification_jersey(
    row: dict[str, Any] | None,
    catalog: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    if not row:
        return None
    try:
        signature = int(row.get("jerseySignature"))
    except (TypeError, ValueError):
        return None
    known = catalog.get(signature) or {}
    image_name = str(row.get("imageName") or known.get("imageName") or "").strip()
    image_url = row.get("imageUrl") or known.get("imageUrl") or jersey_image_url(image_name)
    name = str(row.get("jerseyName") or known.get("name") or "").strip()
    return {
        "jerseySignature": signature,
        "jerseyName": name,
        "imageName": image_name,
        "imageUrl": image_url or None,
    }


def build_classification_jerseys(
    payload: dict[str, Any] | None,
    catalog: dict[int, dict[str, Any]],
) -> dict[str, dict[str, Any]]:
    """Keep only slots that resolve to a catalog jersey."""
    source = payload or {}
    stored: dict[str, dict[str, Any]] = {}
    for key in CLASSIFICATION_JERSEY_KEYS:
        row = source.get(key)
        if not isinstance(row, dict):
            continue
        normalized = stored_classification_jersey(row, catalog)
        if normalized:
            stored[key] = normalized
    return stored
