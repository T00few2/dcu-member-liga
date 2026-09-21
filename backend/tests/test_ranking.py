"""Unit tests for competition ranking used by season prestige mapping."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.results.ranking import competition_places


class TestCompetitionPlaces:
    def test_unique_scores_are_sequential(self):
        assert competition_places({"a": 30, "b": 20, "c": 10}) == {
            "a": 1,
            "b": 2,
            "c": 3,
        }

    def test_ties_share_place_and_skip(self):
        # 1224 ranking: two firsts, then fourth
        assert competition_places({"a": 50, "b": 50, "c": 10}) == {
            "a": 1,
            "b": 1,
            "c": 3,
        }

    def test_last_place_group_shares_slot_after_valid_riders(self):
        scores = {"1": 20, "2": 11, "3": 11, "4": 11}
        places = competition_places(scores)
        assert places["1"] == 1
        assert places["2"] == places["3"] == places["4"] == 2
