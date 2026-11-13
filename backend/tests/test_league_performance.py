"""League results as ground truth: performance vELO, point-in-time power, struggling riders."""
from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import league_performance as lp  # noqa: E402
from services import predictor_observations as po  # noqa: E402
from services import predictor_snapshots as snapshots  # noqa: E402
from services import predictor_tuning as pt  # noqa: E402
from services import strava_efforts  # noqa: E402
from services import strava_power_curve as spc  # noqa: E402
from services import velo_predictor as vp  # noqa: E402
from services.division_agent import decide, evidence, runner, triage  # noqa: E402
from tests.test_admin_predictor_routes import FakeDb  # noqa: E402
from tests.test_predictor_tuning import _rider  # noqa: E402

RACE_START = datetime(2026, 10, 1, 18, tzinfo=timezone.utc)


def _race(race_id="r1", n=10, *, division="Gold", velos=None, phase="finalized", extra_rows=(), **fields):
    """`n` finishers, zwiftId "1".."n" in finishing order; pre-race vELO falls from 1140 by 10 per place."""
    rows = [{"zwiftId": str(i), "finishTime": 3_600_000 + i * 1000, "finishRank": i, "raceStatus": "FIN"}
            for i in range(1, n + 1)]
    before = velos if velos is not None else {str(i): 1150 - i * 10 for i in range(1, n + 1)}
    return {
        "id": race_id, "resultsPhase": phase, "results": {division: rows + list(extra_rows)},
        "veloChanges": {"riders": {zid: {"before": v, "after": v + 500} for zid, v in before.items()}},
        **fields,
    }


# --- performance vELO -----------------------------------------------------------------------


def test_a_rider_is_rated_by_the_pre_race_velo_of_the_riders_finishing_around_them():
    perfs = {p["zwiftId"]: p for p in lp.race_performances(_race(), RACE_START)}
    # 5th place: neighbours are places 2-4 and 6-8 -> vELO 1130,1120,1110,1090,1080,1070.
    assert perfs["5"]["performanceVelo"] == 1100
    assert perfs["5"]["rank"] == 5 and perfs["5"]["fieldSize"] == 10
    assert perfs["1"]["percentile"] == 0.0 and perfs["10"]["percentile"] == 1.0
    # The winner is rated by places 2-4 only; the rider's own vELO is never part of it.
    assert perfs["1"]["performanceVelo"] == 1120


def test_only_the_velo_from_before_the_race_is_used():
    race = _race()
    assert lp.velo_before(race, "3") == 1120  # not the "after" value
    # A rider without a recorded pre-race vELO is rated by the others but is no anchor.
    velos = {str(i): 1150 - i * 10 for i in range(1, 11) if i != 4}
    perfs = {p["zwiftId"]: p for p in lp.race_performances(_race(velos=velos), RACE_START)}
    assert perfs["4"]["veloBefore"] is None and perfs["4"]["performanceVelo"] is not None
    assert perfs["5"]["performanceVelo"] == 1090  # median of 1130,1120,1090,1080,1070 (no place 4)


def test_a_race_with_too_few_pre_race_velos_gives_no_performance_velo():
    race = _race(velos={str(i): 1100 for i in range(1, 6)})  # 5 anchors, 6 needed
    assert all(p["performanceVelo"] is None for p in lp.race_performances(race, RACE_START))


def test_dnf_transfer_credits_and_exclusions():
    extra = [
        {"zwiftId": "50", "finishTime": 0, "raceStatus": "DNF"},
        {"zwiftId": "51", "finishTime": 0, "raceStatus": "XFER", "categoryTransfer": True},
        {"zwiftId": "52", "finishTime": 3_500_000, "raceStatus": "FIN"},
    ]
    perfs = {p["zwiftId"]: p for p in lp.race_performances(_race(extra_rows=extra, manualDQs=["52"]), RACE_START)}
    assert perfs["50"]["dnf"] and perfs["50"]["percentile"] == 1.0 and perfs["50"]["performanceVelo"] is None
    assert "51" not in perfs and "52" not in perfs
    assert perfs["1"]["rank"] == 1 and perfs["1"]["fieldSize"] == 11


def test_only_finalized_races_count_and_ratings_need_enough_races():
    races = [(_race("a"), RACE_START), (_race("b"), RACE_START + timedelta(days=7)),
             (_race("c", phase="provisional"), RACE_START + timedelta(days=14))]
    perfs = lp.all_performances(races)
    assert {p["raceId"] for p in perfs} == {"a", "b"}
    assert lp.performance_ratings(perfs, min_races=3) == {}
    ratings = lp.performance_ratings(perfs, min_races=2)
    assert ratings["5"]["performanceVelo"] == 1100 and ratings["5"]["ratedRaces"] == 2


def test_struggling_needs_enough_races_at_the_back():
    races = [(_race(f"r{k}"), RACE_START + timedelta(days=7 * k)) for k in range(4)]
    by_rider = lp.by_rider(lp.all_performances(races))
    rule = dict(min_races=3, percentile=0.8, share=0.75)
    assert lp.is_struggling(lp.rider_summary(by_rider["10"], division="Gold"), **rule)   # last four times
    assert lp.is_struggling(lp.rider_summary(by_rider["9"], division="Gold"), **rule)    # 0.889 each time
    assert not lp.is_struggling(lp.rider_summary(by_rider["5"], division="Gold"), **rule)
    assert not lp.is_struggling(lp.rider_summary(by_rider["10"][:2], division="Gold"), **rule)  # two races
    # Races in another division do not count towards the current one.
    assert not lp.is_struggling(lp.rider_summary(by_rider["10"], division="Silver"), **rule)


# --- point-in-time Strava power -----------------------------------------------------------


def _ride(days_before_race, watts, *, indoor=False, race=False):
    return {"startDate": (RACE_START - timedelta(days=days_before_race)).isoformat(), "indoor": indoor,
            "race": race, "efforts": {"w5": watts * 3, "w60": watts * 1.6, "w300": watts * 1.2, "w1200": watts}}


def test_a_curve_as_of_a_race_ignores_rides_at_or_after_the_start():
    rides = {
        "old": _ride(120, 400),            # before the 90-day window
        "in": _ride(10, 250),
        "at_start": _ride(0, 500),         # starts exactly at the race start
        "after": _ride(-3, 600),           # three days after the race
    }
    entry = strava_efforts.curve_as_of(rides, RACE_START, 90)
    assert entry["curve"]["w1200"] == 250 and entry["activityCount"] == 1
    # Later rides change nothing about what was known before the race.
    again = strava_efforts.curve_as_of({**rides, "later": _ride(-30, 900)}, RACE_START, 90)
    assert again == entry


def test_outdoor_races_get_their_own_curve_and_stay_part_of_outdoor():
    rides = {"z": _ride(5, 240, indoor=True), "o": _ride(6, 260), "r": _ride(7, 280, race=True)}
    entry = strava_efforts.curve_as_of(rides, RACE_START, 30)
    assert entry["curveIndoor"]["w1200"] == 240
    assert entry["curveOutdoor"]["w1200"] == 280 and entry["curveOutdoorRace"]["w1200"] == 280
    assert (entry["indoorCount"], entry["outdoorCount"], entry["outdoorRaceCount"]) == (1, 2, 1)


def test_a_window_counts_only_when_the_stored_history_covers_all_of_it():
    doc = {"historyFrom": (RACE_START - timedelta(days=95)).isoformat(),
           "updatedAt": (RACE_START + timedelta(days=1)).isoformat()}
    assert strava_efforts.covers(doc, RACE_START, 90)
    assert not strava_efforts.covers({**doc, "historyFrom": (RACE_START - timedelta(days=40)).isoformat()},
                                     RACE_START, 90)
    # Last listed before the race: rides from the days before the race may be missing.
    assert not strava_efforts.covers({**doc, "updatedAt": (RACE_START - timedelta(days=2)).isoformat()},
                                     RACE_START, 90)
    assert not strava_efforts.covers(None, RACE_START, 90)


def _strava(activities):
    service = MagicMock()
    service.get_power_activities.return_value = activities
    return service


def test_fetch_stores_each_rides_efforts_and_never_downloads_a_ride_twice():
    now = datetime.now(timezone.utc)
    acts = [{"id": 1, "startDate": (now - timedelta(days=5)).isoformat(), "indoor": True},
            {"id": 2, "startDate": (now - timedelta(days=200)).isoformat(), "race": True}]
    db = FakeDb()
    compute = MagicMock(side_effect=lambda _uid, a: {"w5": 900, "w1200": 250 + a[0]["id"]})
    entry = spc.get_strava_power_curve(db, _strava(acts), "u1", 90, compute_curve=compute, refresh=True,
                                       also_days=(30, 60), history_days=300)
    assert compute.call_count == 2 and entry["activityCount"] == 1  # the old ride is outside 90 days
    stored = strava_efforts.read(db, "u1")
    assert set(stored["rides"]) == {"1", "2"} and stored["rides"]["2"]["race"] is True
    assert strava_efforts.parse_iso(stored["historyFrom"]) <= now - timedelta(days=299)
    assert entry["version"] == strava_efforts.VERSION and entry["historyFrom"] == stored["historyFrom"]

    acts.append({"id": 3, "startDate": (now - timedelta(days=1)).isoformat()})
    budget = MagicMock(return_value=True)
    spc.get_strava_power_curve(db, _strava(acts), "u1", 90, compute_curve=compute, refresh=True,
                               also_days=(30, 60), history_days=300, budget=budget)
    assert compute.call_count == 3          # only the new ride
    budget.assert_called_once_with(1)       # and only that one counts against the Strava budget


def test_a_ride_removed_from_strava_is_dropped_but_older_history_is_kept():
    now = datetime.now(timezone.utc)
    recent = {"id": 1, "startDate": (now - timedelta(days=5)).isoformat()}
    old = {"id": 2, "startDate": (now - timedelta(days=200)).isoformat()}
    db = FakeDb()
    compute = MagicMock(return_value={"w5": 900})
    spc.get_strava_power_curve(db, _strava([recent, old]), "u1", 90, compute_curve=compute, refresh=True,
                               history_days=300)
    # A later 90-day fetch no longer lists the recent ride (deleted) and does not reach the old one.
    spc.get_strava_power_curve(db, _strava([]), "u1", 90, compute_curve=compute, refresh=True)
    stored = strava_efforts.read(db, "u1")
    assert set(stored["rides"]) == {"2"}
    assert strava_efforts.parse_iso(stored["historyFrom"]) <= now - timedelta(days=299)  # history not shortened


# --- snapshots and observations ----------------------------------------------------------


def test_snapshots_are_weekly_and_daily_before_a_race():
    now = RACE_START - timedelta(hours=30)
    assert snapshots.is_due(None, [], now)
    assert not snapshots.is_due(now - timedelta(days=3), [], now)
    assert snapshots.is_due(now - timedelta(days=8), [], now)
    assert snapshots.is_due(now - timedelta(hours=25), [RACE_START], now)
    assert not snapshots.is_due(now - timedelta(hours=5), [RACE_START], now)


def test_a_race_only_uses_a_snapshot_taken_before_it():
    snaps = [{"at": RACE_START - timedelta(days=3), "riders": {"7": {"weightInGrams": 70000.0}}},
             {"at": RACE_START + timedelta(hours=2), "riders": {"7": {"weightInGrams": 66000.0}}}]
    assert snapshots.latest_before(snaps, "7", RACE_START)["weightInGrams"] == 70000.0
    assert snapshots.latest_before(snaps[1:], "7", RACE_START) is None


def _efforts_doc(rides, *, from_days=200, updated_after_days=1):
    return {"rides": rides, "historyFrom": (RACE_START - timedelta(days=from_days)).isoformat(),
            "updatedAt": (RACE_START + timedelta(days=updated_after_days)).isoformat()}


def test_an_observation_holds_only_what_was_known_before_the_race():
    perf = next(p for p in lp.race_performances(_race(), RACE_START) if p["zwiftId"] == "5")
    today = {"zwiftId": "5", "userDocId": "d5", "hasStrava": True, "weightInGrams": 64000,
             "cp5s": 999, "cp1min": 999, "cp5min": 999, "cp20min": 999}
    rides = {"before": _ride(10, 250), "after": _ride(-5, 400)}

    # No snapshot from before the race: today's weight is used and marked; today's Zwift power never is.
    obs = po.build_rider(perf, today, _efforts_doc(rides), None)
    assert obs["weightSource"] == "current" and obs["weightKg"] == 64.0 and obs["zwift"] is None
    assert obs["strava"]["90"]["curve"]["w1200"] == 250 and obs["strava"]["90"]["activityCount"] == 1
    assert obs["performanceVelo"] == 1100 and obs["veloBefore"] == 1100

    snap = {"weightInGrams": 70000.0, "cp5s": 700.0, "cp1min": 420.0, "cp5min": 300.0, "cp20min": 260.0}
    obs = po.build_rider(perf, today, _efforts_doc(rides), snap)
    assert obs["weightSource"] == "snapshot" and obs["weightKg"] == 70.0
    assert obs["zwift"]["wkg20m"] == round(260 / 70, 2)


def test_a_rider_whose_strava_history_is_too_short_is_pending_not_weak():
    perf = next(p for p in lp.race_performances(_race(), RACE_START) if p["zwiftId"] == "5")
    row = {"zwiftId": "5", "userDocId": "d5", "hasStrava": True, "weightInGrams": 64000}
    obs = po.build_rider(perf, row, _efforts_doc({"x": _ride(10, 250)}, from_days=45), None)
    assert set(obs["strava"]) == {"30"} and obs["stravaPending"] is True


def test_observations_are_built_once_per_finalized_race_and_rebuilt_while_pending():
    db = FakeDb()
    now = RACE_START + timedelta(days=30)
    races = [(_race("r1"), RACE_START), (_race("r2", phase="provisional"), RACE_START + timedelta(days=7))]
    rows = [{"zwiftId": str(i), "userDocId": f"d{i}", "hasStrava": i == 5, "weightInGrams": 70000}
            for i in range(1, 11)]
    assert po.refresh_next(db, races, rows, now=now) == "r1"
    assert db.store["predictor_observations/r1"]["pending"] == 1  # rider 5 has Strava but no history yet
    assert po.refresh_next(db, races, rows, now=now + timedelta(hours=1)) is None   # too soon to retry
    db.store["strava_activity_efforts/d5"] = {"userDocId": "d5", **_efforts_doc({"x": _ride(10, 250)})}
    assert po.refresh_next(db, races, rows, now=now + timedelta(hours=25)) == "r1"
    assert db.store["predictor_observations/r1"]["pending"] == 0
    flat = po.read_all(db)
    assert len(flat) == 10 and all(o["raceId"] == "r1" for o in flat)
    assert next(o for o in flat if o["zwiftId"] == "5")["strava"]["90"]["curve"]["w1200"] == 250


# --- predictor ------------------------------------------------------------------------------


def _observation(row, *, race_id="r1", perf=None, weight_source="snapshot", factor=1.0):
    kg = row["weightInGrams"] / 1000
    curve = {"w5": row["cp5s"] * factor, "w60": row["cp1min"] * factor,
             "w300": row["cp5min"] * factor, "w1200": row["cp20min"] * factor}
    return {"zwiftId": row["zwiftId"], "raceId": race_id, "performanceVelo": perf or row["max30Rating"],
            "weightKg": kg, "weightSource": weight_source, "zwift": None,
            "strava": {"90": {"curve": curve, "curveIndoor": curve, "curveOutdoor": {}, "curveOutdoorRace": {},
                              "activityCount": 20, "split": True}}}


def test_the_default_config_ignores_league_observations():
    riders = [_rider(i) for i in range(40)]
    obs = [_observation(_rider(100 + i, rides=2), perf=3000) for i in range(10)]
    plain = vp.build_model(riders, vp.PredictorConfig())
    assert vp.build_model(riders, vp.PredictorConfig(), None, obs).coeffs == plain.coeffs


def test_league_rows_replace_the_velo_of_riders_whose_velo_is_unreliable():
    trusted = [_rider(i) for i in range(40)]
    new = [{**_rider(100 + i, rides=2), "max30Rating": 400} for i in range(10)]   # a vELO far too low
    cfg = vp.PredictorConfig.from_dict({"targetSource": "velo_or_league"})
    needed = {"cp1min", "cp5min", "cp20min"}
    obs = [_observation(_rider(100 + i, rides=2)) for i in range(10)] + [_observation(trusted[0], perf=3000)]
    rows = vp.all_training_rows(trusted + new, cfg, needed, obs)
    by_id = {}
    for r in rows:
        by_id.setdefault(r.zwiftId, []).append(r.velo)
    assert by_id[new[0]["zwiftId"]] == [_rider(100, rides=2)["max30Rating"]]   # league value, not 400
    assert by_id[trusted[0]["zwiftId"]] == [trusted[0]["max30Rating"]]          # reliable vELO wins
    assert len(rows) == 50

    strict = vp.PredictorConfig.from_dict({"targetSource": "velo_or_league", "strictPointInTime": True})
    loose = [_observation(_rider(100 + i, rides=2), weight_source="current") for i in range(10)]
    assert vp.league_training_rows(loose, strict, needed) == []
    assert len(vp.league_training_rows(loose, cfg, needed)) == 10


def test_outdoor_race_efforts_can_get_their_own_correction():
    split = {"indoor": None, "outdoor": {"weightKg": 70, "wkg5s": 10, "wkg1m": 6, "wkg5m": 4.5, "wkg20m": 4.0},
             "race": {"weightKg": 70, "wkg5s": 9, "wkg1m": 6, "wkg5m": 4.4, "wkg20m": 3.9}}
    scale = {k: 0.9 for k in vp.POWER_FIELDS}
    # Without a race correction a race is an ordinary outdoor ride: nothing changes.
    assert vp.strava_inputs(split, scale) == vp.strava_inputs({**split, "race": None}, scale)
    race_scale = {k: 1.0 for k in vp.POWER_FIELDS}
    out = vp.strava_inputs(split, scale, race_scale=race_scale)
    assert out["wkg20m"] == 3.9 and out["wkg5s"] == 9.0      # race 3.9 beats outdoor 4.0 x 0.9
    assert vp.strava_sources(split, scale, race_scale)["wkg20m"] == "outdoor_race"
    cfg = vp.PredictorConfig.from_dict({"outdoorRaceScale": race_scale, "targetSource": "velo_or_league"})
    assert vp.PredictorConfig.from_dict(cfg.to_dict()).to_dict() == cfg.to_dict()
    assert vp.PredictorConfig.from_dict({"outdoorRaceScale": {"wkg5s": 9}}).outdoorRaceScale is None


def test_tuning_scores_league_riders_separately_and_keeps_a_riders_races_in_one_fold():
    trusted = [_rider(i) for i in range(50)]
    new = [_rider(100 + i, rides=2) for i in range(12)]
    participants = trusted + new
    curves = {(p["userDocId"], 90): {"curve": {"w5": p["cp5s"], "w60": p["cp1min"], "w300": p["cp5min"],
                                               "w1200": p["cp20min"]}, "activityCount": 20} for p in trusted}
    obs = [_observation(p, race_id=f"r{k}") for p in new for k in range(2)]
    riders = pt.build_eval_set(participants, lambda d, w: curves.get((d, w)), min_rides=15)
    league = pt.build_league_eval(obs + [_observation(trusted[0])], participants, min_rides=15)
    assert len(league) == 24 and {r.truthSource for r in league} == {"league"}   # trusted riders stay vELO-only
    everyone = riders + league
    for fold in pt.folds_for(everyone, 5):
        assert len(fold) == len(set(fold))
    assert sum(len(f) for f in pt.folds_for(everyone, 5)) == 62   # by rider, not by race
    score, per = pt.cross_validate(participants, everyone, vp.PredictorConfig(), observations=obs)
    assert score.bySource["velo"]["n"] == 50 and score.bySource["league"]["n"] == 24
    assert score.bySource["leaguePointInTimeWeight"]["n"] == 24
    assert f"{new[0]['zwiftId']}@r0" in per and f"{new[0]['zwiftId']}@r1" in per


# --- struggling riders in the division agent ------------------------------------------------

SETTINGS = {"minZwiftRides": 15, "enabled": True, "assessModel": "claude-haiku-5-5", "maxPerRun": 8}
MODEL = vp.build_model([_rider(i) for i in range(60)], vp.PredictorConfig())


def _league(percentiles, division="Gold"):
    recent = [{"raceId": f"r{i}", "division": division, "rank": 9, "fieldSize": 10, "percentile": p,
               "dnf": False, "performanceVelo": 1010} for i, p in enumerate(percentiles)]
    return {"races": len(recent), "finishes": len(recent), "dnfs": 0, "ratedRaces": len(recent),
            "performanceVelo": 1010, "medianPercentile": 0.9, "recent": recent, "divisions": [division]}


def _placed(row, division):
    return {"ligaCategory": {"category": division, "locked": True}}, {**row, "category": division}


def test_struggling_is_a_reason_only_when_ticked():
    row = {**_rider(1), "league": _league([0.9, 1.0, 0.85, 0.95])}
    assert triage.needs_review(row, SETTINGS) == []
    on = {**SETTINGS, "reviewFilter": {"reasons": ["struggling"]}}
    assert triage.needs_review(row, on) == [triage.STRUGGLING]
    assert triage.needs_review({**row, "league": _league([0.9, 0.2, 0.3, 0.4])}, on) == []
    strict = {**SETTINGS, "reviewFilter": {"reasons": ["struggling"], "strugglingMinRaces": 5}}
    assert triage.needs_review(row, strict) == []


def _evidence(row, division, reasons=("struggling",), curve=None):
    user, row = _placed(row, division)
    return evidence.gather(row, user, model=MODEL, categories=None, curve_entry=curve, reasons=list(reasons),
                           min_rides=15)


def test_a_held_up_struggling_rider_is_proposed_one_division_down():
    base = _rider(3)                               # reliable vELO
    velo_division = vp.category_for_velo(base["max30Rating"])
    names = evidence.division_names(None)
    harder = names[names.index(velo_division) - 2]  # placed two divisions above the vELO
    ev = _evidence({**base, "league": _league([0.9, 1.0, 0.95], harder)}, harder)
    assert ev["heldUp"] and ev["aboveVeloDivision"] and ev["veloDivision"] == velo_division
    suggestion = decide.suggest(ev, None)
    assert suggestion["source"] == "league"
    assert suggestion["category"] == names[names.index(harder) + 1]   # one down, never two
    assert decide.needs_proposal(ev, suggestion)


def test_a_struggling_rider_whose_reliable_velo_belongs_in_the_division_stays():
    base = _rider(3)
    division = vp.category_for_velo(base["max30Rating"])
    ev = _evidence({**base, "league": _league([0.9, 1.0, 0.95], division)}, division)
    assert ev["heldUp"] is False
    suggestion = decide.suggest(ev, None)
    assert suggestion["category"] == division and not decide.needs_proposal(ev, suggestion)


def test_power_that_fits_the_division_stops_a_move_down():
    base = _rider(3, rides=2)                      # unreliable vELO: held up by definition
    power_division = vp.predict_inputs(MODEL, vp.inputs_from_participant(base))["category"]
    ev = _evidence({**base, "league": _league([0.9, 1.0, 0.95], power_division)}, power_division)
    assert ev["heldUp"] and not ev["veloReliable"]
    assert decide.suggest(ev, None)["category"] == power_division


def test_the_struggling_list_shows_every_such_rider_held_up_first():
    fits = _rider(3)
    division = vp.category_for_velo(fits["max30Rating"])
    rows = [
        {**fits, "league": _league([0.9, 1.0, 0.95], division)},
        {**_rider(4, rides=2), "league": _league([0.9, 1.0, 0.95], "Gold")},
        {**_rider(5), "league": _league([0.1, 0.2, 0.3], "Gold")},
    ]
    settings = {**SETTINGS, "reviewFilter": triage.normalize_filter(None)}   # reason not ticked: still listed
    out = runner.struggling_riders(rows, settings, None, [])
    assert [r["zwiftId"] for r in out] == [rows[1]["zwiftId"], rows[0]["zwiftId"]]
    assert out[0]["heldUp"] is True and out[1]["heldUp"] is False and out[0]["pendingProposal"] is None


def test_a_new_league_race_reopens_a_rider():
    base = {**_rider(3), "league": _league([0.9, 1.0, 0.95])}
    first = evidence.fingerprint(_evidence(base, "Gold"))
    more = evidence.fingerprint(_evidence({**base, "league": _league([0.9, 1.0, 0.95, 0.9])}, "Gold"))
    assert first != more
    no_races = {**_rider(3), "league": None}
    assert "leagueRaces" not in str(evidence.fingerprint(_evidence(no_races, "Gold", reasons=("few_rides",))))
