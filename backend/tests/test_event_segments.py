"""Sprint picker must offer event segments, not lap/finish banners."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.zwift_game import ZwiftGameService, jersey_marker, on_route_ids
from tests.dictionary_fixture import patch_game_dictionary

LA_BOUCLE_ROUTE_ID = "870135081"
CHAMPS_ELYSEES_ID = "1056322864"
EVENT_SPRINT_IDS = {
    "5354271745",  # Lutece Sprint
    "1059797545",  # Monceau Sprint
    "1055881124",  # Montmartre KOM
    "-9223372035804541048",  # Tchou Tchou Reverse Sprint
}


class JerseyMarkerTests(unittest.TestCase):
    def test_on_routes_is_split_on_commas(self):
        self.assertEqual(
            on_route_ids("3364574135,2818536273"),
            {"3364574135", "2818536273"},
        )
        self.assertNotIn("870135081", on_route_ids("3364574135,2818536273"))

    def test_live_dictionary_has_segments(self):
        game = ZwiftGameService()
        data = game.get_game_dictionary()
        self.assertTrue(data and "SEGMENTS" in data, game.dictionary_error)

    def test_failed_fetch_does_not_invent_segments(self):
        game = ZwiftGameService()
        game.get_game_dictionary = lambda: None
        self.assertEqual(game.get_event_segments(LA_BOUCLE_ROUTE_ID, laps=1), [])

    def test_jersey_file_is_the_marker(self):
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/GreenJersey_Icon.tga"), "sprint")
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/DesertJersey_Icon.tga"), "sprint")
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/PolkaJersey_Icon.tga"), "climb")
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/PolkaJerseyAlpez_Icon.tga"), "climb")
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/NationalForest_Jersey_Icon.tga"), "climb")
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/OrangeJersey_Icon.tga"), "segment")
        self.assertEqual(jersey_marker("UI/WhiteOrangeTheme/HUD/Badge_Volcano.tga"), "segment")
        self.assertEqual(jersey_marker(None), "segment")


class EventSegmentFilterTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls._dictionary = patch_game_dictionary()
        cls._dictionary.start()

    @classmethod
    def tearDownClass(cls):
        cls._dictionary.stop()

    def test_la_boucle_excludes_champs_elysees_banner(self):
        game = ZwiftGameService()
        segments = game.get_event_segments(LA_BOUCLE_ROUTE_ID, laps=3)
        found = {str(segment.get("id")) for segment in segments}

        self.assertTrue(EVENT_SPRINT_IDS <= found, found)
        self.assertNotIn(CHAMPS_ELYSEES_ID, found)
        for sprint_id in EVENT_SPRINT_IDS:
            laps = sorted(
                segment.get("lap")
                for segment in segments
                if str(segment.get("id")) == sprint_id
            )
            self.assertEqual(laps, [1, 2, 3], sprint_id)

    def test_la_boucle_has_no_finish_row(self):
        game = ZwiftGameService()
        segments = game.get_event_segments(
            LA_BOUCLE_ROUTE_ID,
            laps=3,
            include_lap_banners=True,
        )
        self.assertNotIn(CHAMPS_ELYSEES_ID, {str(segment.get("id")) for segment in segments})
        self.assertFalse(any(segment.get("isFinish") for segment in segments))
        names = {segment.get("name") for segment in segments if segment.get("lap") == 1}
        self.assertEqual(
            names,
            {"Lutece Sprint", "Monceau Sprint", "Montmartre KOM", "Tchou Tchou Sprint"},
        )

    def test_no_sleep_does_not_offer_the_hill_stub(self):
        game = ZwiftGameService()
        segments = game.get_event_segments("104170948", laps=1)
        names = [segment.get("name") for segment in segments]
        self.assertEqual(
            names,
            [
                "Manhattan Sprint",
                "Center Sprint Reverse",
                "Manhattan Sprint",
                "Brooklyn Bridge KOM",
            ],
        )
        reverse = [segment for segment in segments if segment.get("direction") == "reverse"]
        self.assertEqual(
            [segment.get("name") for segment in reverse],
            ["Center Sprint Reverse", "Manhattan Sprint"],
        )
        self.assertTrue(segments[-1].get("isFinish"))

    def test_richmond_uci_course_is_the_finish(self):
        game = ZwiftGameService()
        segments = game.get_event_segments("2196019512", laps=1)
        names = [segment.get("name") for segment in segments]
        self.assertIn("23RD ST.", names)
        self.assertIn("UCI COURSE", names)
        finish = [segment for segment in segments if segment.get("isFinish")]
        self.assertEqual(len(finish), 1)
        self.assertEqual(finish[0].get("name"), "UCI COURSE")

    def test_richmond_finish_banner_is_the_uci_course(self):
        game = ZwiftGameService()
        segments = game.get_event_segments(
            "2196019512",
            laps=1,
            include_lap_banners=True,
        )
        finish = [segment for segment in segments if segment.get("isFinish")]
        self.assertEqual(len(finish), 1)
        self.assertEqual(finish[0].get("name"), "UCI COURSE")


if __name__ == "__main__":
    unittest.main()
