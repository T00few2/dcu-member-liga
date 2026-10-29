"""Route spline positions must include segments zwift-data cannot place."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.route_segment_spline import segment_spline_positions

ITZA_PARTY = 4131664304


class RouteSegmentSplineTests(unittest.TestCase):
    def test_itza_party_includes_reverse_sprints_between_the_climbs(self):
        rows = segment_spline_positions(ITZA_PARTY)
        names = [row["name"] for row in rows]
        self.assertEqual(
            names,
            [
                "Zwift KOM",
                "Titans Grove KOM Reverse",
                "Woodland Sprint Reverse",
                "Sasquatch Sprint Reverse",
                "Acropolis Sprint Reverse",
                "Stoneway Sprint Reverse",
                "Mayan Mountainside KOM",
                "Itza KOM",
            ],
        )
        directions = [row["direction"] for row in rows]
        self.assertEqual(
            directions,
            ["forward", "reverse", "reverse", "reverse", "reverse", "reverse", "forward", "forward"],
        )
        for earlier, later in zip(rows, rows[1:]):
            self.assertLess(earlier["splineTo"], later["splineFrom"])

        woodland = rows[2]
        sasquatch = rows[3]
        self.assertAlmostEqual(woodland["lengthM"], 500.02, places=1)
        self.assertAlmostEqual(sasquatch["lengthM"], 350, places=0)
        self.assertGreater(sasquatch["splineFrom"] - woodland["splineTo"], 0)

    def test_neon_shore_loop_does_not_place_railway_sprint(self):
        rows = segment_spline_positions(3600776267)
        names = [row["name"] for row in rows]
        self.assertNotIn("RAILWAY SPRINT", names)
        self.assertEqual(
            names,
            [
                "TOWER SPRINT",
                "ROOFTOP KOM",
                "BOARDWALK SPRINT",
                "ALLEY SPRINT Reverse",
            ],
        )
