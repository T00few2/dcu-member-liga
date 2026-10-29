"""Measured Sauce offsets are the profile markers, not a road walk."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.sauce_profile_segments import measured_profile_segments


class MeasuredProfileSegmentTests(unittest.TestCase):
    def test_neon_shore_loop_matches_the_lap_picker(self):
        rows = measured_profile_segments(3600776267)
        names = [row["name"].lower() for row in rows]
        self.assertTrue(any("tower" in name for name in names))
        self.assertTrue(any("rooftop" in name for name in names))
        self.assertTrue(any("boardwalk" in name for name in names))
        self.assertTrue(any("alley" in name for name in names))
        self.assertFalse(any("railway" in name for name in names))
        self.assertTrue(all(row["fromKm"] >= 0 for row in rows))
        self.assertEqual(len([name for name in names if "alley" in name]), 1)

    def test_braek_fast_places_the_clyde_kicker_on_the_lap(self):
        rows = measured_profile_segments(377566656)
        clyde = next(row for row in rows if "clyde" in row["name"].lower())
        self.assertAlmostEqual(clyde["fromKm"], 2.669, places=2)
        brae = [row for row in rows if "brae" in row["name"].lower()]
        self.assertEqual(len(brae), 4)
        self.assertLess(brae[0]["fromKm"], brae[-1]["fromKm"])

    def test_duchy_estate_includes_the_yorkshire_sprint(self):
        rows = measured_profile_segments(1233527301)
        self.assertEqual(len(rows), 1)
        self.assertIn("sprint", rows[0]["name"].lower())
        self.assertAlmostEqual(rows[0]["fromKm"], 2.742, places=2)

    def test_itza_party_includes_the_reverse_sprints(self):
        rows = measured_profile_segments(4131664304)
        names = [row["name"].lower() for row in rows]
        self.assertGreaterEqual(len(rows), 8)
        self.assertTrue(any("woodland" in name for name in names))
        self.assertTrue(any("sasquatch" in name for name in names))
        self.assertTrue(any("itza" in name for name in names))
