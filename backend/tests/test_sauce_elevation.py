"""Sauce elevation uses the game's slope scale, not raw mesh height."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.sauce_elevation import (
    classify_segment,
    route_elevation,
    route_segment_grades,
)


def _ascent(profile: dict) -> float:
    altitude = profile["altitude"]
    return sum(max(0.0, altitude[i] - altitude[i - 1]) for i in range(1, len(altitude)))


class SauceElevationTests(unittest.TestCase):
    def test_road_to_sky_matches_the_published_climb(self):
        profile = route_elevation(2663908549)
        self.assertGreaterEqual(len(profile["distance"]), 2)
        self.assertAlmostEqual(profile["distance"][-1], 17500, delta=250)
        self.assertAlmostEqual(_ascent(profile), 1044, delta=40)
        alpe = next(row for row in route_segment_grades(2663908549) if row["name"] == "Alpe du Zwift")
        self.assertEqual(alpe["category"], "climb")
        self.assertAlmostEqual(alpe["grade"], 8.5, delta=0.4)

    def test_titans_grove_is_a_shallow_climb(self):
        titans = next(
            row for row in route_segment_grades(604330868) if row["name"] == "Titans Grove KOM"
        )
        self.assertEqual(titans["category"], "climb")
        self.assertAlmostEqual(titans["grade"], 2.2, delta=0.2)

    def test_names_decide_sprint_and_kom_before_the_grade(self):
        self.assertEqual(classify_segment("Brooklyn Bridge KOM", 1.7), "climb")
        self.assertEqual(classify_segment("Lutece Sprint", 3.2), "sprint")
        self.assertEqual(classify_segment("Alpe du Zwift", 8.3), "climb")
        self.assertEqual(classify_segment("Fuego Flats", 0.2), "sprint")

    def test_unknown_route_is_empty(self):
        self.assertEqual(route_elevation(0), {"distance": [], "altitude": []})
        self.assertEqual(route_segment_grades(0), [])
