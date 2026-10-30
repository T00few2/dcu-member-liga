"""Lead-in elevation is the pens-to-banner ride, not part of the lap."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.leadin_elevation import leadin_elevation


class LeadInElevationTests(unittest.TestCase):
    def test_neon_shore_lead_in_meets_the_published_length(self):
        profile = leadin_elevation(3600776267)
        distance = profile["distance"]
        altitude = profile["altitude"]
        self.assertGreaterEqual(len(distance), 2)
        self.assertEqual(len(distance), len(altitude))
        self.assertEqual(distance[0], 0)
        self.assertAlmostEqual(distance[-1], 1124, delta=80)
        self.assertTrue(all(altitude[i] <= altitude[i + 1] + 30 for i in range(len(altitude) - 1)))
        self.assertGreater(max(altitude) - min(altitude), 0.5)

    def test_unknown_route_has_no_lead_in(self):
        self.assertEqual(leadin_elevation(0), {"distance": [], "altitude": []})
