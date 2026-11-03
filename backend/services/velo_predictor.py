"""vELO predictor: the single implementation used by the admin page, the division
agent and predictor tuning.

A linear regression of 30-day max ZwiftRacing vELO on power features, trained on
every registered rider who has a real vELO. The admin UI no longer fits its own
model; it calls the endpoints in `routes/admin_predictor_routes.py`, which use
this module.

Settings live in the admin-only `predictor_settings/current.config` (see
`PredictorConfig` and `services/predictor_service.py`). The legacy
`league/settings.predictorFeatures` map is still read as a fallback.
"""
from __future__ import annotations

import hashlib
import json
import math
import threading
import time
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Callable, Iterable

from services.category_engine import get_zr_category

# ---------------------------------------------------------------------------
# Small numeric helpers (kept JS-compatible so results match the old TS model)
# ---------------------------------------------------------------------------


def js_round(value: float) -> int:
    """Math.round: halves round towards +infinity (Python's round() is banker's)."""
    return int(math.floor(value + 0.5))


def round2(value: float) -> float:
    """Number((x).toFixed(2)) — round half up on the exact binary value."""
    return float(Decimal(value).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def to_float(value: Any) -> float | None:
    """parseFloat-like: numbers pass through, numeric strings parse, anything else is None."""
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)):
        return float(value) if math.isfinite(value) else None
    if value is None:
        return None
    try:
        parsed = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    return parsed if math.isfinite(parsed) else None


# ---------------------------------------------------------------------------
# Inputs
# ---------------------------------------------------------------------------

POWER_FIELDS = ("wkg5s", "wkg1m", "wkg5m", "wkg20m")
INPUT_FIELDS = ("weightKg", "racingScore") + POWER_FIELDS

# Strava peak-curve keys (seconds) for each W/kg input.
STRAVA_CURVE_KEYS = {"wkg5s": "w5", "wkg1m": "w60", "wkg5m": "w300", "wkg20m": "w1200"}


def empty_inputs() -> dict[str, float]:
    return {k: 0.0 for k in INPUT_FIELDS}


def clean_inputs(raw: dict | None) -> dict[str, float]:
    """Coerce an inputs object from a request body; unknown or bad values become 0."""
    out = empty_inputs()
    for k in INPUT_FIELDS:
        v = to_float((raw or {}).get(k))
        out[k] = v if v is not None and v > 0 else 0.0
    return out


def inputs_from_participant(p: dict) -> dict[str, float]:
    """Zwift power inputs for a participant row (W/kg rounded to 2 decimals)."""
    kg = (to_float(p.get("weightInGrams")) or 0.0) / 1000

    def wkg(watts: Any) -> float:
        w = to_float(watts)
        return round2(w / kg) if kg > 0 and w and w > 0 else 0.0

    return {
        "weightKg": kg,
        "wkg5s": wkg(p.get("cp5s")),
        "wkg1m": wkg(p.get("cp1min")),
        "wkg5m": wkg(p.get("cp5min")),
        "wkg20m": wkg(p.get("cp20min")),
        "racingScore": to_float(p.get("racingScore")) or 0.0,
    }


def inputs_from_strava_curve(curve: dict, weight_kg: float, racing_score: float = 0.0) -> dict[str, float]:
    """Strava peak-power curve (watts keyed w5/w60/w300/w1200) to predictor inputs."""
    out = {"weightKg": weight_kg, "racingScore": racing_score}
    for field_name, curve_key in STRAVA_CURVE_KEYS.items():
        watts = to_float((curve or {}).get(curve_key)) or 0.0
        out[field_name] = round2(watts / weight_kg) if weight_kg > 0 and watts > 0 else 0.0
    return out


# ---------------------------------------------------------------------------
# Feature definitions
# ---------------------------------------------------------------------------

CPArgs = tuple[float, float, float, float, float, float]  # kg, cp5s, cp1min, cp5min, cp20min, zrs


@dataclass(frozen=True)
class FeatureDef:
    key: str
    label: str
    description: str
    requires: tuple[str, ...]
    from_cp: Callable[..., float]
    from_inputs: Callable[[dict], float]

    def public(self) -> dict:
        return {
            "key": self.key,
            "label": self.label,
            "description": self.description,
            "requires": list(self.requires),
        }


def _compound(inp: dict, field_name: str) -> float:
    kg = inp["weightKg"]
    return (inp[field_name] * kg) ** 2 / kg if kg > 0 else 0.0


FEATURE_DEFS: list[FeatureDef] = [
    FeatureDef(
        "weight_kg", "Weight (kg)",
        "Raw rider weight. Lets the model reward heavier riders at the same W/kg — on flat terrain, "
        "absolute watts matter.",
        (), lambda kg, c5, c1, c5m, c20, zrs: kg, lambda inp: inp["weightKg"],
    ),
    FeatureDef(
        "zrs", "ZRS",
        "Zwift Racing Score, earned from Zwift races. Like vELO it is unreliable for riders with few Zwift "
        "rides, the riders this predictor is for, so tuning never uses or proposes it.",
        ("racingScore",), lambda kg, c5, c1, c5m, c20, zrs: zrs, lambda inp: inp["racingScore"],
    ),
    FeatureDef(
        "wkg5s", "5s W/kg", "5-second peak power per kg — pure neuromuscular / sprint ceiling.",
        ("cp5s",), lambda kg, c5, c1, c5m, c20, zrs: c5 / kg, lambda inp: inp["wkg5s"],
    ),
    FeatureDef(
        "wkg1m", "1min W/kg", "1-minute power per kg — anaerobic capacity.",
        ("cp1min",), lambda kg, c5, c1, c5m, c20, zrs: c1 / kg, lambda inp: inp["wkg1m"],
    ),
    FeatureDef(
        "wkg5m", "5min W/kg", "5-minute power per kg — VO₂max proxy.",
        ("cp5min",), lambda kg, c5, c1, c5m, c20, zrs: c5m / kg, lambda inp: inp["wkg5m"],
    ),
    FeatureDef(
        "wkg20m", "20min W/kg",
        "Sustained aerobic ceiling (FTP proxy) — typically the strongest single predictor of vELO.",
        ("cp20min",), lambda kg, c5, c1, c5m, c20, zrs: c20 / kg, lambda inp: inp["wkg20m"],
    ),
    FeatureDef(
        "watts5s", "5s watts", "Absolute 5-second peak watts. Scale-free on flat sprints.",
        ("cp5s",), lambda kg, c5, c1, c5m, c20, zrs: c5, lambda inp: inp["wkg5s"] * inp["weightKg"],
    ),
    FeatureDef(
        "watts1m", "1min watts", "Absolute 1-minute watts.",
        ("cp1min",), lambda kg, c5, c1, c5m, c20, zrs: c1, lambda inp: inp["wkg1m"] * inp["weightKg"],
    ),
    FeatureDef(
        "watts5m", "5min watts", "Absolute 5-minute watts.",
        ("cp5min",), lambda kg, c5, c1, c5m, c20, zrs: c5m, lambda inp: inp["wkg5m"] * inp["weightKg"],
    ),
    FeatureDef(
        "watts20m", "20min watts", "Absolute 20-minute watts (FTP in absolute terms).",
        ("cp20min",), lambda kg, c5, c1, c5m, c20, zrs: c20, lambda inp: inp["wkg20m"] * inp["weightKg"],
    ),
    FeatureDef(
        "compound5s", "5s²/kg", "5s watts² ÷ weight. Sprint compound score — rewards heavier sprinters.",
        ("cp5s",), lambda kg, c5, c1, c5m, c20, zrs: c5 * c5 / kg, lambda inp: _compound(inp, "wkg5s"),
    ),
    FeatureDef(
        "compound1m", "1m²/kg", "1min watts² ÷ weight. Anaerobic compound score.",
        ("cp1min",), lambda kg, c5, c1, c5m, c20, zrs: c1 * c1 / kg, lambda inp: _compound(inp, "wkg1m"),
    ),
    FeatureDef(
        "compound5m", "5m²/kg",
        "5min watts² ÷ weight. Flat-terrain VO₂max — same W/kg but heavier → higher score.",
        ("cp5min",), lambda kg, c5, c1, c5m, c20, zrs: c5m * c5m / kg, lambda inp: _compound(inp, "wkg5m"),
    ),
    FeatureDef(
        "compound20m", "20m²/kg", "20min watts² ÷ weight. Sustained flat power — the FTP compound score.",
        ("cp20min",), lambda kg, c5, c1, c5m, c20, zrs: c20 * c20 / kg, lambda inp: _compound(inp, "wkg20m"),
    ),
]
FEATURE_BY_KEY = {f.key: f for f in FEATURE_DEFS}

DEFAULT_FEATURES: dict[str, bool] = {
    "weight_kg": True, "zrs": False, "wkg5s": False, "wkg1m": True, "wkg5m": False, "wkg20m": True,
    "watts5s": False, "watts1m": False, "watts5m": False, "watts20m": False,
    "compound5s": False, "compound1m": False, "compound5m": True, "compound20m": False,
}


def merge_features(saved: dict | None) -> dict[str, bool]:
    out = dict(DEFAULT_FEATURES)
    for k in DEFAULT_FEATURES:
        if isinstance((saved or {}).get(k), bool):
            out[k] = saved[k]
    return out


# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

STRAVA_WINDOWS = (90, 180, 360)
REGRESSIONS = ("ols", "ridge")


@dataclass
class PredictorConfig:
    features: dict[str, bool] = field(default_factory=lambda: dict(DEFAULT_FEATURES))
    regression: str = "ols"
    ridgeLambda: float = 0.0
    stravaWindowDays: int = 90
    # Multiplier per W/kg input applied to Strava (outdoor) power before predicting,
    # to correct for outdoor vs indoor power. 1.0 = no correction.
    stravaPowerScale: dict[str, float] = field(default_factory=lambda: {k: 1.0 for k in POWER_FIELDS})
    minStravaActivities: int = 3
    # Train only on riders whose vELO is reliable (at least this many Zwift rides in
    # 90 days and a stable rating); 0 = every rider with a vELO.
    trainingMinRides: int = 0

    @classmethod
    def from_settings(cls, settings: dict | None) -> "PredictorConfig":
        """Read `predictorConfig`, falling back to the legacy `predictorFeatures` map."""
        s = settings or {}
        raw = s.get("predictorConfig")
        if not isinstance(raw, dict):
            raw = {"features": s.get("predictorFeatures")}
        return cls.from_dict(raw)

    @classmethod
    def from_dict(cls, raw: dict | None) -> "PredictorConfig":
        raw = raw or {}
        cfg = cls()
        cfg.features = merge_features(raw.get("features") if isinstance(raw.get("features"), dict) else None)
        if raw.get("regression") in REGRESSIONS:
            cfg.regression = raw["regression"]
        lam = to_float(raw.get("ridgeLambda"))
        if lam is not None and lam >= 0:
            cfg.ridgeLambda = lam
        window = raw.get("stravaWindowDays")
        if isinstance(window, int) and window in STRAVA_WINDOWS:
            cfg.stravaWindowDays = window
        scale = raw.get("stravaPowerScale")
        if isinstance(scale, dict):
            for k in POWER_FIELDS:
                v = to_float(scale.get(k))
                if v is not None and 0.5 <= v <= 1.5:
                    cfg.stravaPowerScale[k] = v
        min_acts = raw.get("minStravaActivities")
        if isinstance(min_acts, int) and not isinstance(min_acts, bool) and 0 <= min_acts <= 100:
            cfg.minStravaActivities = min_acts
        min_train = raw.get("trainingMinRides")
        if isinstance(min_train, int) and not isinstance(min_train, bool) and 0 <= min_train <= 200:
            cfg.trainingMinRides = min_train
        return cfg

    def to_dict(self) -> dict:
        return {
            "features": dict(self.features),
            "regression": self.regression,
            "ridgeLambda": self.ridgeLambda,
            "stravaWindowDays": self.stravaWindowDays,
            "stravaPowerScale": dict(self.stravaPowerScale),
            "minStravaActivities": self.minStravaActivities,
            "trainingMinRides": self.trainingMinRides,
        }

    def active_features(self) -> list[FeatureDef]:
        return [f for f in FEATURE_DEFS if self.features.get(f.key)]

    def fingerprint(self) -> str:
        return hashlib.sha1(json.dumps(self.to_dict(), sort_keys=True).encode()).hexdigest()[:12]


# ---------------------------------------------------------------------------
# Linear algebra (pure Python; the systems are at most 15x15)
# ---------------------------------------------------------------------------


def solve_linear(a: list[list[float]], b: list[float]) -> list[float]:
    """Gaussian elimination with partial pivoting. Raises ValueError when singular."""
    n = len(b)
    m = [list(row) + [b[i]] for i, row in enumerate(a)]
    for col in range(n):
        max_row = max(range(col, n), key=lambda r: abs(m[r][col]))
        m[col], m[max_row] = m[max_row], m[col]
        if abs(m[col][col]) < 1e-12:
            raise ValueError("Singular matrix")
        for row in range(col + 1, n):
            f = m[row][col] / m[col][col]
            for k in range(col, n + 1):
                m[row][k] -= f * m[col][k]
    x = [0.0] * n
    for i in range(n - 1, -1, -1):
        x[i] = m[i][n]
        for j in range(i + 1, n):
            x[i] -= m[i][j] * x[j]
        x[i] /= m[i][i]
    return x


def fit_ols(x_rows: list[list[float]], y: list[float]) -> list[float]:
    """Ordinary least squares; returns [intercept, *coefficients]."""
    p = len(x_rows[0]) + 1
    xtx = [[0.0] * p for _ in range(p)]
    xty = [0.0] * p
    for row, target in zip(x_rows, y):
        xa = [1.0] + list(row)
        for j in range(p):
            xty[j] += xa[j] * target
            for k in range(p):
                xtx[j][k] += xa[j] * xa[k]
    return solve_linear(xtx, xty)


def fit_ridge(x_rows: list[list[float]], y: list[float], lam: float) -> list[float]:
    """Ridge on standardized features (intercept not penalized), returned on the raw scale.

    `lam` is scale-free: it is multiplied by the number of rows, so the same value
    means the same amount of shrinkage whatever the training-set size.
    """
    if lam <= 0:
        return fit_ols(x_rows, y)
    n = len(x_rows)
    p = len(x_rows[0])
    means = [sum(r[j] for r in x_rows) / n for j in range(p)]
    stds = []
    for j in range(p):
        var = sum((r[j] - means[j]) ** 2 for r in x_rows) / n
        stds.append(math.sqrt(var) if var > 1e-18 else 1.0)
    y_mean = sum(y) / n
    z = [[(r[j] - means[j]) / stds[j] for j in range(p)] for r in x_rows]
    ztz = [[0.0] * p for _ in range(p)]
    zty = [0.0] * p
    for row, target in zip(z, y):
        yc = target - y_mean
        for j in range(p):
            zty[j] += row[j] * yc
            for k in range(p):
                ztz[j][k] += row[j] * row[k]
    for j in range(p):
        ztz[j][j] += lam * n
    beta = solve_linear(ztz, zty)
    coeffs = [b / s for b, s in zip(beta, stds)]
    intercept = y_mean - sum(c * m for c, m in zip(coeffs, means))
    return [intercept] + coeffs


def dot_predict(coeffs: list[float], row: Iterable[float]) -> float:
    return coeffs[0] + sum(c * v for c, v in zip(coeffs[1:], row))


# ---------------------------------------------------------------------------
# Training data
# ---------------------------------------------------------------------------


@dataclass
class TrainingRow:
    name: str
    zwiftId: str
    kg: float
    cp5s: float
    cp1min: float
    cp5min: float
    cp20min: float
    zrs: float
    velo: float
    category: str | None

    def cp_args(self) -> CPArgs:
        return (self.kg, self.cp5s, self.cp1min, self.cp5min, self.cp20min, self.zrs)


def _positive(value: Any) -> float | None:
    v = to_float(value)
    return v if v is not None and v > 0 else None


# A rating is "stable" when today's vELO is within this share of the 30-day max.
STABLE_RATING_TOLERANCE = 0.10


def reliable_velo(p: dict, min_rides: int) -> float | None:
    """30-day max vELO when it can be trusted (enough Zwift rides, stable rating), else None."""
    max30 = to_float(p.get("max30Rating"))
    current = to_float(p.get("rating"))
    rides = p.get("zwiftActivityCount")
    if not max30 or max30 <= 0 or not current or current <= 0:
        return None
    if not isinstance(rides, int) or rides < min_rides:
        return None
    if abs(current - max30) > STABLE_RATING_TOLERANCE * max30:
        return None
    return max30


def training_rows(participants: list[dict], needed: set[str], min_rides: int = 0) -> list[TrainingRow]:
    """Riders with a real 30-day max vELO and every power value the active features need.

    With `min_rides`, only riders whose vELO is reliable (see `reliable_velo`).
    """
    rows: list[TrainingRow] = []
    for p in participants:
        wg = _positive(p.get("weightInGrams"))
        velo = _positive(p.get("max30Rating"))
        if wg is None or velo is None:
            continue
        if min_rides > 0 and reliable_velo(p, min_rides) is None:
            continue
        cps = {k: _positive(p.get(k)) for k in ("cp5s", "cp1min", "cp5min", "cp20min")}
        if any(k in needed and cps[k] is None for k in cps):
            continue
        zrs = to_float(p.get("racingScore"))
        if "racingScore" in needed and (zrs is None or zrs <= 0):
            continue
        lc = p.get("ligaCategory") or {}
        rows.append(TrainingRow(
            name=str(p.get("name") or ""),
            zwiftId=str(p.get("zwiftId") or ""),
            kg=wg / 1000,
            cp5s=cps["cp5s"] or 0.0,
            cp1min=cps["cp1min"] or 0.0,
            cp5min=cps["cp5min"] or 0.0,
            cp20min=cps["cp20min"] or 0.0,
            zrs=zrs or 0.0,
            velo=velo,
            category=lc.get("category") if isinstance(lc, dict) else None,
        ))
    return rows


# ---------------------------------------------------------------------------
# Model
# ---------------------------------------------------------------------------


@dataclass
class Model:
    coeffs: list[float]
    r2: float
    rmse: int
    n: int
    activeFeatureKeys: list[str]
    trainingPoints: list[dict]
    config: PredictorConfig

    def features(self) -> list[FeatureDef]:
        return [FEATURE_BY_KEY[k] for k in self.activeFeatureKeys]

    def to_dict(self) -> dict:
        return {
            "coeffs": self.coeffs,
            "r2": self.r2,
            "rmse": self.rmse,
            "n": self.n,
            "activeFeatureKeys": list(self.activeFeatureKeys),
            "trainingPoints": self.trainingPoints,
        }


def fit_rows(rows: list[TrainingRow], features: list[FeatureDef], config: PredictorConfig) -> list[float]:
    """Fit coefficients for already-filtered training rows. Raises ValueError when singular."""
    x = [[f.from_cp(*r.cp_args()) for f in features] for r in rows]
    y = [r.velo for r in rows]
    if config.regression == "ridge":
        return fit_ridge(x, y, config.ridgeLambda)
    return fit_ols(x, y)


def build_model(
    participants: list[dict],
    config: PredictorConfig,
    categories: Any = None,
) -> Model | None:
    """Fit the model on every rider with a real vELO. None when there is not enough data."""
    active = config.active_features()
    if not active:
        return None
    needed = {req for f in active for req in f.requires}
    rows = training_rows(participants, needed, config.trainingMinRides)
    if len(rows) < len(active) + 2:
        return None
    try:
        coeffs = fit_rows(rows, active, config)
    except ValueError:
        return None

    x = [[f.from_cp(*r.cp_args()) for f in active] for r in rows]
    y = [r.velo for r in rows]
    preds = [dot_predict(coeffs, row) for row in x]
    y_mean = sum(y) / len(y)
    ss_tot = sum((v - y_mean) ** 2 for v in y)
    ss_res = sum((v - p) ** 2 for v, p in zip(y, preds))
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    points = [
        {
            "actual": r.velo,
            "predicted": js_round(pred),
            "name": r.name,
            "category": r.category or category_for_velo(r.velo, categories),
        }
        for r, pred in zip(rows, preds)
    ]
    return Model(
        coeffs=coeffs,
        r2=r2,
        rmse=js_round(math.sqrt(ss_res / len(y))),
        n=len(rows),
        activeFeatureKeys=[f.key for f in active],
        trainingPoints=points,
        config=config,
    )


# ---------------------------------------------------------------------------
# Prediction
# ---------------------------------------------------------------------------

EMPTY_PREDICTION: dict = {
    "velo": None, "category": None, "low": None, "high": None,
    "catLow": None, "catHigh": None, "confidence": None,
}


def category_for_velo(velo: float, categories: Any = None) -> str:
    return get_zr_category(velo, categories)[0]


def apply_strava_scale(inputs: dict, config: PredictorConfig) -> dict:
    out = dict(inputs)
    for k in POWER_FIELDS:
        out[k] = inputs[k] * config.stravaPowerScale.get(k, 1.0)
    return out


def predict_inputs(
    model: Model | None,
    inputs: dict,
    categories: Any = None,
    *,
    source: str = "zwift",
    activity_count: int | None = None,
) -> dict:
    """Predicted vELO, division and ±RMSE band for one set of inputs.

    `source="strava"` applies the configured outdoor→indoor power correction and
    marks the prediction low-confidence when there are too few Strava rides.
    """
    if model is None:
        return dict(EMPTY_PREDICTION)
    inp = clean_inputs(inputs)
    if source == "strava":
        inp = apply_strava_scale(inp, model.config)
    row = [f.from_inputs(inp) for f in model.features()]
    if not row or any(v <= 0 for v in row):
        return dict(EMPTY_PREDICTION)
    velo = js_round(dot_predict(model.coeffs, row))
    low = js_round(velo - model.rmse)
    high = js_round(velo + model.rmse)
    category = category_for_velo(velo, categories)
    cat_low = category_for_velo(low, categories)
    cat_high = category_for_velo(high, categories)
    if source == "strava" and activity_count is not None and activity_count < model.config.minStravaActivities:
        confidence = "low"
    elif cat_low == cat_high == category:
        confidence = "high"
    else:
        confidence = "medium"
    return {
        "velo": velo,
        "category": category,
        "low": low,
        "high": high,
        "catLow": cat_low,
        "catHigh": cat_high,
        "confidence": confidence,
    }


# ---------------------------------------------------------------------------
# Cached model for request handlers
# ---------------------------------------------------------------------------

MODEL_CACHE_TTL_SECONDS = 600
_cache_lock = threading.Lock()
_model_cache: dict[str, tuple[float, Model | None]] = {}


def cached_model(
    key: str,
    build: Callable[[], Model | None],
    ttl: float = MODEL_CACHE_TTL_SECONDS,
) -> Model | None:
    """Reuse a fitted model per config fingerprint for `ttl` seconds."""
    now = time.monotonic()
    with _cache_lock:
        hit = _model_cache.get(key)
        if hit and now - hit[0] < ttl:
            return hit[1]
    model = build()
    with _cache_lock:
        _model_cache[key] = (now, model)
    return model


def clear_model_cache() -> None:
    with _cache_lock:
        _model_cache.clear()
