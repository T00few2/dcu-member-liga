"""Sprint picker must offer event segments, not lap/finish banners."""

import os
import sys
import unittest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from services.zwift_game import ZwiftGameService

LA_BOUCLE_ROUTE_ID = "870135081"
CHAMPS_ELYSEES_ID = "1056322864"
EVENT_SPRINT_IDS = {
    "5354271745",  # Lutece Sprint
    "1059797545",  # Monceau Sprint
    "1055881124",  # Montmartre KOM
    "-9223372035804541048",  # Tchou Tchou Reverse Sprint
}


class EventSegmentFilterTests(unittest.TestCase):
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

    def test_la_boucle_finish_detection_keeps_champs_banner(self):
        game = ZwiftGameService()
        segments = game.get_event_segments(
            LA_BOUCLE_ROUTE_ID,
            laps=3,
            include_lap_banners=True,
        )
        champs = [
            segment
            for segment in segments
            if str(segment.get("id")) == CHAMPS_ELYSEES_ID
        ]
        self.assertEqual([segment.get("count") for segment in champs], [1, 2, 3], champs)
        self.assertEqual(champs[-1].get("lap"), 3)

        from services.results.finish_selector import last_race_lap_banner

        self.assertEqual(last_race_lap_banner(segments), (CHAMPS_ELYSEES_ID, 3))


if __name__ == "__main__":
    unittest.main()
