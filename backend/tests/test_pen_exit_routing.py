"""Tests for pen-exit lead-in segment synthesis."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.pen_exit_routing import synthesize_leadin_entries
from services.zwift_game import ZwiftGameService


BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ROUTES_FILE = os.path.join(BASE_DIR, "data/routes.json")
MAYAN_MASH_ROUTE_ID = "4280627426"
ACROPOLIS_SPRINT_REVERSE_ID = "-9223372035806856321"


def _load_route(name: str) -> dict:
    import json

    with open(ROUTES_FILE, encoding="utf-8") as handle:
        routes = json.load(handle)
    return next(route for route in routes if route.get("name") == name)


class PenExitRoutingTests(unittest.TestCase):
    def test_mayan_mash_synthesizes_leadin_manifest(self):
        route = _load_route("Mayan Mash")
        leadin = synthesize_leadin_entries(route, BASE_DIR)

        self.assertTrue(leadin, "Expected synthesized lead-in manifest entries")
        self.assertTrue(all(entry.get("leadin") for entry in leadin))

        road_149_reverse = [
            entry
            for entry in leadin
            if entry.get("roadId") == 149 and entry.get("reverse")
        ]
        self.assertTrue(road_149_reverse, "Expected a lead-in entry on road 149 reverse")

        entry = road_149_reverse[0]
        low = min(entry["start"], entry["end"])
        high = max(entry["start"], entry["end"])
        self.assertLessEqual(low, 0.2657975578)
        self.assertGreaterEqual(high, 0.287927392)

    def test_mayan_mash_includes_acropolis_sprint_on_lead_in(self):
        game = ZwiftGameService()
        segments = game.get_event_segments(MAYAN_MASH_ROUTE_ID, laps=1)

        acropolis = [
            segment
            for segment in segments
            if segment.get("id") == ACROPOLIS_SPRINT_REVERSE_ID
        ]
        self.assertEqual(len(acropolis), 2, segments)

        lead_in = next(segment for segment in acropolis if segment.get("lap") == 0)
        lap_one = next(segment for segment in acropolis if segment.get("lap") == 1)

        self.assertEqual(lead_in["count"], 1)
        self.assertEqual(lap_one["count"], 2)
        self.assertEqual(lead_in["direction"], "reverse")
        self.assertEqual(lap_one["direction"], "reverse")


if __name__ == "__main__":
    unittest.main()
