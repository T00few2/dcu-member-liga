"""Normalize the three competition jerseys stored on league/settings."""
from __future__ import annotations

from typing import Any

from services.zwift_game import jersey_image_url

CLASSIFICATION_JERSEY_KEYS = ("individual", "sprint", "kom")


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
