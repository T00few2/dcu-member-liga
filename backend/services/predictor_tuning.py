"""Measure and tune the vELO predictor for its real job: Strava power → division.

Ground truth is riders whose vELO can be trusted: enough Zwift rides in the CP
window and a current rating close to their 30-day max. For those with a cached
Strava power curve we predict their vELO **from Strava** (the way the predictor
is used for riders who barely race on Zwift) and check the division against the
division their real vELO gives.

Everything here is deterministic plain Python so a run can be repeated:
- k-fold cross-validation, grouped by rider: a rider's own Zwift data is never
  in the training set used to predict them;
- a greedy forward feature search, then a small grid over regression, ridge
  strength, Strava window and the outdoor→indoor power correction;
- the main score is division accuracy, MAE (vELO points) breaks ties.

Only cached Strava curves are used (`strava_power_curves`), so tuning never
spends Strava API requests.

League results add a second kind of ground truth, for exactly the riders the predictor
is for: a rider without a reliable vELO who has ridden league races is scored per race,
power known **before** the race against the performance vELO of that race
(`services/predictor_observations.py`). Scores are reported for both kinds.
"""
from __future__ import annotations

import statistics
from dataclasses import dataclass, field
from typing import Any, Callable

from services import velo_predictor as vp
from services.category_engine import ZR_CATEGORIES, get_zr_category

MIN_EVAL_RIDERS = 40
MIN_IMPROVEMENT_PP = 2.0
DEFAULT_FOLDS = 5
STABLE_RATING_TOLERANCE = vp.STABLE_RATING_TOLERANCE
MAX_GREEDY_FEATURES = 6
RIDGE_LAMBDAS = (0.01, 0.1, 1.0)
# Indoor-first thresholds tuning tries (0 = rule off). Predictor research found 1, 5 and 10
# indoor rides equally good on riders with a reliable vELO, so one middle value is enough.
INDOOR_FIRST_MIN_RIDES = (0, 5)
# Never tried or proposed by tuning. ZRS is as unreliable as vELO for riders with few
# Zwift rides (exactly the riders the predictor is for), but the eval riders all have
# many rides, so ZRS would look far better here than it is in real use. The admin page
# can still switch it on by hand.
TUNING_EXCLUDED_FEATURES = frozenset({"zrs"})


def _without_excluded(features: dict[str, bool]) -> dict[str, bool]:
    return {k: (v and k not in TUNING_EXCLUDED_FEATURES) for k, v in features.items()}


# ---------------------------------------------------------------------------
# Eval set
# ---------------------------------------------------------------------------


@dataclass
class EvalRider:
    zwiftId: str
    realVelo: float
    realCategory: str
    weightKg: float
    racingScore: float
    zwiftInputs: dict
    # window days -> ({"indoor": inputs|None, "outdoor": inputs|None, "race": inputs|None}, activityCount)
    strava: dict[int, tuple[dict, int]] = field(default_factory=dict)
    # "velo": the rider's own reliable vELO. "league": one league race of a rider without
    # one; `realVelo` is then the performance vELO of that race and `strava` the power
    # known before it.
    truthSource: str = "velo"
    key: str = ""  # unique per entry (a league rider has one entry per race)
    pointInTimeWeight: bool = True

    def __post_init__(self) -> None:
        self.key = self.key or self.zwiftId


def reliable_velo(p: dict, min_rides: int) -> float | None:
    """30-day max vELO when it can be trusted as ground truth, else None."""
    return vp.reliable_velo(p, min_rides)


def build_eval_set(
    participants: list[dict],
    read_curve: Callable[[str, int], dict | None],
    *,
    min_rides: int,
    categories: Any = None,
) -> list[EvalRider]:
    """Riders with a reliable vELO and at least one cached Strava curve."""
    out: list[EvalRider] = []
    for p in participants:
        velo = reliable_velo(p, min_rides)
        kg = (vp.to_float(p.get("weightInGrams")) or 0) / 1000
        doc_id = p.get("userDocId")
        if velo is None or kg <= 0 or not doc_id:
            continue
        zwift_inputs = vp.inputs_from_participant(p)
        strava = {}
        for days in vp.STRAVA_WINDOWS:
            entry = read_curve(str(doc_id), days)
            if not entry or not entry.get("curve"):
                continue
            strava[days] = (vp.strava_split_inputs(entry, kg), int(entry.get("activityCount") or 0))
        if not strava:
            continue
        out.append(EvalRider(
            zwiftId=str(p.get("zwiftId")),
            realVelo=velo,
            realCategory=get_zr_category(velo, categories)[0],
            weightKg=kg,
            racingScore=zwift_inputs["racingScore"],
            zwiftInputs=zwift_inputs,
            strava=strava,
        ))
    return out


def build_league_eval(
    observations: list[dict] | None,
    participants: list[dict],
    *,
    min_rides: int,
    categories: Any = None,
) -> list[EvalRider]:
    """League races of riders **without** a reliable vELO, as eval entries.

    Riders with a reliable vELO are already in the eval set with that as the truth.
    """
    trusted = {str(p.get("zwiftId")) for p in participants if reliable_velo(p, min_rides) is not None}
    out: list[EvalRider] = []
    for o in observations or []:
        zid = str(o.get("zwiftId") or "")
        perf = vp.to_float(o.get("performanceVelo"))
        kg = vp.to_float(o.get("weightKg")) or 0.0
        if not zid or zid in trusted or not perf or perf <= 0 or kg <= 0:
            continue
        strava = {}
        for days in vp.STRAVA_WINDOWS:
            entry = (o.get("strava") or {}).get(str(days))
            if isinstance(entry, dict) and entry.get("curve"):
                strava[days] = (vp.strava_split_inputs(entry, kg), int(entry.get("activityCount") or 0))
        if not strava:
            continue
        out.append(EvalRider(
            zwiftId=zid, realVelo=perf, realCategory=get_zr_category(perf, categories)[0], weightKg=kg,
            racingScore=0.0, zwiftInputs=vp.clean_inputs(o.get("zwift")), strava=strava,
            truthSource="league", key=f"{zid}@{o.get('raceId')}",
            pointInTimeWeight=o.get("weightSource") == "snapshot",
        ))
    return out


def past_prediction_outcomes(
    participants: list[dict], *, min_rides: int, categories: Any = None,
    league_ratings: dict[str, dict] | None = None,
) -> dict:
    """How good were earlier predicted placements, now that those riders have a real vELO
    (or, without a reliable one, a performance vELO from their league races)?"""
    pairs = []
    for p in participants:
        lc = p.get("ligaCategory") or {}
        if lc.get("manualAssignedFrom") != "predicted":
            continue
        predicted = vp.to_float(lc.get("predictedVelo"))
        real = reliable_velo(p, min_rides)
        if real is None:
            real = vp.to_float(((league_ratings or {}).get(str(p.get("zwiftId"))) or {}).get("performanceVelo"))
        if not predicted or real is None:
            continue
        pairs.append((predicted, real))
    if not pairs:
        return {"n": 0}
    same = sum(1 for pr, re in pairs if get_zr_category(pr, categories)[0] == get_zr_category(re, categories)[0])
    return {
        "n": len(pairs),
        "divisionAccuracy": round(100 * same / len(pairs), 1),
        "maeVelo": round(statistics.mean(abs(pr - re) for pr, re in pairs), 1),
        "meanBias": round(statistics.mean(pr - re for pr, re in pairs), 1),
    }


# ---------------------------------------------------------------------------
# Cross-validation
# ---------------------------------------------------------------------------


def folds_for(riders: list[EvalRider], k: int) -> list[set[str]]:
    """Deterministic folds by rider id (stable across runs)."""
    ids = sorted({r.zwiftId for r in riders})
    k = max(2, min(k, len(ids))) if ids else 1
    return [set(ids[i::k]) for i in range(k)]


def fit_strava_scale(riders: list[EvalRider], days: int, part: str = "outdoor") -> dict[str, float]:
    """Median Zwift / outdoor-Strava W/kg ratio per duration (outdoor → indoor correction).

    Only outdoor efforts are compared: indoor Strava rides are usually the same Zwift
    rides, so including them would pull the correction towards 1. With `part="race"`,
    only outdoor rides marked as a race are compared (the correction for race efforts).
    A league entry counts only when it has Zwift power recorded before its race.
    """
    scale = {}
    for fld in vp.POWER_FIELDS:
        ratios = []
        for r in riders:
            if days not in r.strava:
                continue
            outdoor = r.strava[days][0].get(part) or {}
            z = r.zwiftInputs.get(fld) or 0
            s = outdoor.get(fld) or 0
            if z > 0 and s > 0:
                ratios.append(z / s)
        value = statistics.median(ratios) if len(ratios) >= 5 else 1.0
        scale[fld] = round(min(1.5, max(0.5, value)), 3)
    return scale


@dataclass
class Score:
    n: int
    divisionAccuracy: float
    adjacentAccuracy: float
    maeVelo: float
    zwiftDivisionAccuracy: float
    # Per kind of ground truth: {"velo": {n, divisionAccuracy, maeVelo}, "league": {...},
    # "leaguePointInTimeWeight": {...}} (the last one: league races whose weight was
    # recorded before the race, not today's).
    bySource: dict = field(default_factory=dict)

    def key(self) -> tuple[float, float]:
        return (self.divisionAccuracy, -self.maeVelo)

    def to_dict(self) -> dict:
        return {
            "n": self.n,
            "divisionAccuracy": self.divisionAccuracy,
            "adjacentAccuracy": self.adjacentAccuracy,
            "maeVelo": self.maeVelo,
            "zwiftDivisionAccuracy": self.zwiftDivisionAccuracy,
            "bySource": self.bySource,
        }


def _division_index(name: str, categories: Any) -> int:
    cats = categories or ZR_CATEGORIES
    for i, (cat_name, _lower, _upper) in enumerate(cats):
        if cat_name == name:
            return i
    return -1


def cross_validate(
    participants: list[dict],
    riders: list[EvalRider],
    config: vp.PredictorConfig,
    *,
    categories: Any = None,
    folds: int = DEFAULT_FOLDS,
    fit_scale: bool = False,
    fit_race: bool = False,
    observations: list[dict] | None = None,
) -> tuple[Score | None, dict[str, dict]]:
    """Strava→division accuracy for `config`, plus each rider's out-of-fold prediction.

    With `fit_scale`, the Strava power correction is re-fitted inside every training
    fold (never on the riders being predicted) and replaces `config.stravaPowerScale`;
    with `fit_race`, the same for the outdoor-race correction.

    `observations` are the league-race training rows (used when the config trains on
    them). Folds are by rider, so none of a rider's races is in the training set used to
    predict any of that rider's races.
    """
    days = config.stravaWindowDays
    usable = [r for r in riders if days in r.strava]
    if not usable:
        return None, {}
    per_rider: dict[str, dict] = {}
    hits = adjacent = zwift_hits = zwift_n = 0
    abs_err = []
    groups: dict[str, list[tuple[bool, float]]] = {}
    for fold in folds_for(usable, folds):
        train_participants = [p for p in participants if str(p.get("zwiftId")) not in fold]
        train_obs = [o for o in observations or [] if str(o.get("zwiftId")) not in fold]
        train_riders = [r for r in usable if r.zwiftId not in fold]
        fold_cfg = vp.PredictorConfig.from_dict(config.to_dict())
        if fit_scale:
            fold_cfg.stravaPowerScale = fit_strava_scale(train_riders, days)
        if fit_race:
            fold_cfg.outdoorRaceScale = fit_strava_scale(train_riders, days, "race")
        model = vp.build_model(train_participants, fold_cfg, categories, train_obs)
        if model is None:
            return None, {}
        for r in usable:
            if r.zwiftId not in fold:
                continue
            split, count = r.strava[days]
            inputs = vp.strava_inputs(split, fold_cfg.stravaPowerScale, r.racingScore,
                                      race_scale=fold_cfg.outdoorRaceScale,
                                      indoor_first_min=fold_cfg.indoorFirstMinRides)
            pred = vp.predict_inputs(model, inputs, categories, source="strava", activity_count=count)
            if r.truthSource == "velo":
                zpred = vp.predict_inputs(model, r.zwiftInputs, categories)
                if zpred["velo"] is not None:
                    zwift_n += 1
                    zwift_hits += int(zpred["category"] == r.realCategory)
            if pred["velo"] is None:
                continue
            hit = pred["category"] == r.realCategory
            near = abs(_division_index(pred["category"], categories)
                       - _division_index(r.realCategory, categories)) <= 1
            hits += int(hit)
            adjacent += int(near)
            err = abs(pred["velo"] - r.realVelo)
            abs_err.append(err)
            groups.setdefault(r.truthSource, []).append((hit, err))
            if r.truthSource == "league" and r.pointInTimeWeight:
                groups.setdefault("leaguePointInTimeWeight", []).append((hit, err))
            per_rider[r.key] = {
                "predictedVelo": pred["velo"],
                "predictedCategory": pred["category"],
                "realVelo": r.realVelo,
                "realCategory": r.realCategory,
                "truthSource": r.truthSource,
            }
    n = len(abs_err)
    if n == 0:
        return None, {}
    score = Score(
        n=n,
        divisionAccuracy=round(100 * hits / n, 1),
        adjacentAccuracy=round(100 * adjacent / n, 1),
        maeVelo=round(statistics.mean(abs_err), 1),
        zwiftDivisionAccuracy=round(100 * zwift_hits / zwift_n, 1) if zwift_n else 0.0,
        bySource={
            name: {"n": len(rows),
                   "divisionAccuracy": round(100 * sum(1 for h, _ in rows if h) / len(rows), 1),
                   "maeVelo": round(statistics.mean(e for _, e in rows), 1)}
            for name, rows in sorted(groups.items())
        },
    )
    return score, per_rider


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------


@dataclass
class Candidate:
    config: vp.PredictorConfig
    fitScale: bool
    score: Score
    perRider: dict[str, dict]
    fitRace: bool = False

    def describe(self) -> dict:
        return {"config": self.config.to_dict(), "fitScale": self.fitScale, "fitRace": self.fitRace,
                "score": self.score.to_dict()}


def _evaluate(participants, riders, cfg, categories, folds, fit_scale, fit_race=False,
              observations=None) -> Candidate | None:
    score, per_rider = cross_validate(participants, riders, cfg, categories=categories, folds=folds,
                                      fit_scale=fit_scale, fit_race=fit_race, observations=observations)
    if score is None:
        return None
    return Candidate(cfg, fit_scale, score, per_rider, fit_race)


def _with(cfg: vp.PredictorConfig, **changes) -> vp.PredictorConfig:
    data = cfg.to_dict()
    data.update(changes)
    return vp.PredictorConfig.from_dict(data)


def greedy_features(
    participants: list[dict],
    riders: list[EvalRider],
    base: vp.PredictorConfig,
    *,
    categories: Any = None,
    folds: int = DEFAULT_FOLDS,
    max_features: int = MAX_GREEDY_FEATURES,
    observations: list[dict] | None = None,
) -> dict[str, bool]:
    """Forward selection: keep adding the feature that improves Strava accuracy most."""
    chosen: list[str] = []
    best: Candidate | None = None
    while len(chosen) < max_features:
        step_best: tuple[Candidate, str] | None = None
        for key in vp.FEATURE_BY_KEY:
            if key in chosen or key in TUNING_EXCLUDED_FEATURES:
                continue
            feats = {k: (k in chosen or k == key) for k in vp.FEATURE_BY_KEY}
            cand = _evaluate(participants, riders, _with(base, features=feats), categories, folds, False,
                             observations=observations)
            if cand and (step_best is None or cand.score.key() > step_best[0].score.key()):
                step_best = (cand, key)
        if step_best is None or (best is not None and step_best[0].score.key() <= best.score.key()):
            break
        best, added = step_best
        chosen.append(added)
    return {k: k in chosen for k in vp.FEATURE_BY_KEY} if chosen else _without_excluded(base.features)


@dataclass
class TuningResult:
    status: str  # "insufficient_data" | "no_improvement" | "improved"
    evalRiders: int
    current: dict | None
    best: dict | None
    improvementPP: float
    changedRiders: list[dict]
    pastPredictions: dict
    windowsAvailable: dict[int, int]
    message: str

    def to_dict(self) -> dict:
        return {
            "status": self.status,
            "evalRiders": self.evalRiders,
            "current": self.current,
            "best": self.best,
            "improvementPP": self.improvementPP,
            "changedRiders": self.changedRiders,
            "pastPredictions": self.pastPredictions,
            "windowsAvailable": {str(k): v for k, v in self.windowsAvailable.items()},
            "message": self.message,
        }


def tune(
    participants: list[dict],
    riders: list[EvalRider],
    current: vp.PredictorConfig,
    *,
    categories: Any = None,
    folds: int = DEFAULT_FOLDS,
    min_riders: int = MIN_EVAL_RIDERS,
    min_improvement_pp: float = MIN_IMPROVEMENT_PP,
    min_rides: int = 15,
    observations: list[dict] | None = None,
    league_ratings: dict[str, dict] | None = None,
) -> TuningResult:
    """Search for better settings. `riders` may hold league entries (`build_league_eval`);
    `observations` are the league-race training rows a config can train on."""
    windows = {d: sum(1 for r in riders if d in r.strava) for d in vp.STRAVA_WINDOWS}
    past = past_prediction_outcomes(participants, min_rides=min_rides, categories=categories,
                                    league_ratings=league_ratings)
    baseline = _evaluate(participants, riders, current, categories, folds, False, observations=observations)

    if len(riders) < min_riders or baseline is None:
        return TuningResult(
            status="insufficient_data",
            evalRiders=len(riders),
            current=baseline.describe() if baseline else None,
            best=None,
            improvementPP=0.0,
            changedRiders=[],
            pastPredictions=past,
            windowsAvailable=windows,
            message=(
                f"Only {len(riders)} riders have both a reliable vELO and a cached Strava curve "
                f"(need {min_riders}). Showing today's accuracy only; no new settings are proposed."
            ),
        )

    feature_sets = [_without_excluded(current.features)]
    greedy = greedy_features(participants, riders, current, categories=categories, folds=folds,
                             observations=observations)
    if greedy != feature_sets[0]:
        feature_sets.append(greedy)

    best = baseline
    for feats in feature_sets:
        for days in vp.STRAVA_WINDOWS:
            if windows.get(days, 0) < min_riders:
                continue
            regs = [("ols", 0.0)] + [("ridge", lam) for lam in RIDGE_LAMBDAS]
            for regression, lam in regs:
                # Train on every rider with a vELO, or only on riders whose vELO is reliable.
                for train_min in sorted({0, min_rides}):
                    for fit_scale in (False, True):
                        cfg = _with(current, features=feats, regression=regression, ridgeLambda=lam,
                                    stravaWindowDays=days, trainingMinRides=train_min,
                                    stravaPowerScale={k: 1.0 for k in vp.POWER_FIELDS},
                                    outdoorRaceScale=None, indoorFirstMinRides=0)
                        cand = _evaluate(participants, riders, cfg, categories, folds, fit_scale,
                                         observations=observations)
                        if cand and cand.score.key() > best.score.key():
                            best = cand

    # On top of the best settings so far: the indoor-first rule, an own correction for
    # outdoor races, and training on league results for riders without a reliable vELO.
    # Indoor-first is also tried without the fitted outdoor correction: the two answer
    # the same problem, and the correction may only have won for lack of the rule.
    start = best
    targets = vp.TARGET_SOURCES if observations else (start.config.targetSource,)
    for indoor_min in INDOOR_FIRST_MIN_RIDES:
        for fit_scale in sorted({start.fitScale, False}):
            for target in targets:
                for fit_race in (False, True):
                    if (indoor_min, fit_scale, target, fit_race) == (0, start.fitScale,
                                                                     start.config.targetSource, False):
                        continue
                    cfg = _with(start.config, targetSource=target, outdoorRaceScale=None,
                                indoorFirstMinRides=indoor_min,
                                stravaPowerScale={k: 1.0 for k in vp.POWER_FIELDS})
                    cand = _evaluate(participants, riders, cfg, categories, folds, fit_scale, fit_race,
                                     observations=observations)
                    if cand and cand.score.key() > best.score.key():
                        best = cand

    improvement = round(best.score.divisionAccuracy - baseline.score.divisionAccuracy, 1)
    if best is baseline or improvement < min_improvement_pp:
        return TuningResult(
            status="no_improvement",
            evalRiders=len(riders),
            current=baseline.describe(),
            best=best.describe() if best is not baseline else None,
            improvementPP=max(improvement, 0.0),
            changedRiders=[],
            pastPredictions=past,
            windowsAvailable=windows,
            message=(
                f"Best alternative improves division accuracy by {max(improvement, 0.0)} pp; "
                f"needs at least {min_improvement_pp} pp to be proposed."
            ),
        )

    final_cfg = vp.PredictorConfig.from_dict(best.config.to_dict())
    if best.fitScale:
        final_cfg.stravaPowerScale = fit_strava_scale(riders, final_cfg.stravaWindowDays)
    if best.fitRace:
        final_cfg.outdoorRaceScale = fit_strava_scale(riders, final_cfg.stravaWindowDays, "race")
    changed = []
    for zid, after in best.perRider.items():
        before = baseline.perRider.get(zid)
        if before and before["predictedCategory"] != after["predictedCategory"]:
            changed.append({
                "zwiftId": zid,
                "realCategory": after["realCategory"],
                "before": before["predictedCategory"],
                "after": after["predictedCategory"],
            })
    best_desc = best.describe()
    best_desc["config"] = final_cfg.to_dict()
    return TuningResult(
        status="improved",
        evalRiders=len(riders),
        current=baseline.describe(),
        best=best_desc,
        improvementPP=improvement,
        changedRiders=sorted(changed, key=lambda c: c["zwiftId"]),
        pastPredictions=past,
        windowsAvailable=windows,
        message=f"New settings improve Strava→division accuracy by {improvement} pp.",
    )
