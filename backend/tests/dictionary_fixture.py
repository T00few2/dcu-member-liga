"""Saved dictionary rows for tests that check placement, not the live fetch."""

import json
import os
from unittest.mock import patch

from services.zwift_game import ZwiftGameService

_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "game_dictionary_segments.json")


def dictionary_payload() -> dict:
    with open(_FIXTURE, encoding="utf-8") as handle:
        rows = json.load(handle)
    return {"SEGMENTS": {"SEGMENT": rows}}


def patch_game_dictionary():
    payload = dictionary_payload()
    return patch.object(
        ZwiftGameService,
        "get_game_dictionary",
        lambda self: payload,
    )
