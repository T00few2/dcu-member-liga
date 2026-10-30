import os
import sys
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.category_engine import cats_from_defs  # noqa: E402
from services.velo_changes import (  # noqa: E402
    collect_race_event_ids,
    grace_limit_for_category,
    is_velo_flagged,
    parse_zr_velo_rows,
    refresh_race_velo_changes,
)
from services.zwiftracing import RateLimitError  # noqa: E402

CATS = cats_from_defs([
    {"name": "Diamond", "upper": None},
    {"name": "Ruby", "upper": 2200},
    {"name": "Sapphire", "upper": 1650},
])


def test_collect_event_ids_across_modes_deduplicated():
    race = {
        "eventId": "1",
        "linkedEventIds": ["2", "1"],
        "eventConfiguration": [{"eventId": "3"}, {"eventId": ""}],
        "raceGroups": [{"eventId": "4"}, {"eventId": "3"}],
    }
    assert collect_race_event_ids(race) == ["1", "2", "3", "4"]


def test_parse_rows_reads_before_after_and_delta():
    rows = parse_zr_velo_rows({"results": [
        {"riderId": 11, "ratingBefore": 1600, "rating": 1675.44, "ratingDelta": 75.44},
        {"riderId": 12, "ratingBefore": 1500, "rating": 1520},
        {"riderId": 13, "rating": 1400, "ratingDelta": -12},
        {"riderId": 14, "name": "no rating"},
    ]})
    assert rows["11"] == {"before": 1600, "after": 1675.4, "delta": 75.4}
    assert rows["12"]["delta"] == 20
    assert rows["13"]["before"] == 1412
    assert "14" not in rows


def test_parse_rows_accepts_bare_list_and_nested_velo():
    rows = parse_zr_velo_rows([{"riderId": "9", "velo": {"ratingBefore": 900, "rating": 960}}])
    assert rows["9"] == {"before": 900, "after": 960, "delta": 60}


def test_grace_limit_and_flag_rule():
    assert grace_limit_for_category("Sapphire", 35, CATS) == 1685
    assert grace_limit_for_category("Diamond", 35, CATS) is None
    assert is_velo_flagged(51, 1686, 1685) is True
    assert is_velo_flagged(50, 1700, 1685) is False   # change must exceed 50
    assert is_velo_flagged(80, 1685, 1685) is False   # must end above grace limit
    assert is_velo_flagged(80, 3000, None) is False   # top category never flagged


def test_refresh_flags_and_resumes_after_rate_limit():
    race = {
        "eventConfiguration": [{"eventId": "A"}, {"eventId": "B"}],
        "results": {
            "Sapphire": [{"zwiftId": "1"}, {"zwiftId": "2"}],
            "Ruby": [{"zwiftId": "3"}],
        },
    }
    payloads = {
        "A": {"results": [
            {"riderId": 1, "ratingBefore": 1620, "rating": 1700},   # +80, above 1685 -> flag
            {"riderId": 2, "ratingBefore": 1500, "rating": 1560},   # +60, below grace
            {"riderId": 99, "ratingBefore": 1000, "rating": 1100},  # not in league results
        ]},
        "B": {"results": [{"riderId": 3, "ratingBefore": 2190, "rating": 2250}]},
    }
    calls: list[str] = []

    def fetch(eid):
        calls.append(eid)
        if len(calls) > 1:
            raise RateLimitError("429")
        return payloads[eid]

    t1 = datetime(2026, 10, 1, tzinfo=timezone.utc)
    out = refresh_race_velo_changes(race, fetch, lambda _ids: {}, 35, CATS, now=t1)
    assert out["fetchedEvents"] == ["A"]
    assert out["pendingEvents"] == ["B"]
    assert out["rateLimited"] is True
    riders = out["veloChanges"]["riders"]
    assert set(riders) == {"1", "2"}
    assert riders["1"]["flagged"] is True and riders["1"]["graceLimit"] == 1685
    assert riders["2"]["flagged"] is False

    # Second run picks up the never-fetched event first.
    race["veloChanges"] = out["veloChanges"]
    calls.clear()
    t2 = datetime(2026, 10, 1, 0, 2, tzinfo=timezone.utc)
    out2 = refresh_race_velo_changes(race, fetch, lambda _ids: {}, 35, CATS, now=t2)
    assert calls[0] == "B"
    riders2 = out2["veloChanges"]["riders"]
    assert riders2["3"]["delta"] == 60 and riders2["3"]["flagged"] is True  # Ruby grace 2235
    assert out2["veloChanges"]["flaggedCount"] == 2


def test_refresh_without_results_keeps_members_only_using_profile_category():
    race = {"eventId": "E"}
    payload = [
        {"riderId": 5, "ratingBefore": 1600, "rating": 1700},
        {"riderId": 6, "ratingBefore": 1600, "rating": 1700},
    ]
    users = {"5": {"ligaCategory": {"autoAssigned": {"category": "Sapphire"}}}}
    out = refresh_race_velo_changes(race, lambda _e: payload, lambda _ids: users, 35, CATS)
    riders = out["veloChanges"]["riders"]
    assert set(riders) == {"5"}
    assert riders["5"]["category"] == "Sapphire" and riders["5"]["flagged"] is True
