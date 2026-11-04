"""The backend vELO predictor (single source of truth for the admin page and agent).

`fixtures/velo_predictor_ts_parity.json` was exported from the TypeScript model
that the admin page used before the predictor moved to the backend. The parity
test proves the move did not change any prediction.
"""
from __future__ import annotations

import json
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import velo_predictor as vp  # noqa: E402

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "velo_predictor_ts_parity.json")


def _fixture() -> dict:
    with open(FIXTURE, encoding="utf-8") as fh:
        return json.load(fh)


@pytest.mark.parametrize("case", ["default", "wkg_only", "with_sprint_zrs"])
def test_matches_the_old_typescript_model(case):
    data = _fixture()
    expected = data["cases"][case]
    config = vp.PredictorConfig.from_dict({"features": expected["features"]})

    model = vp.build_model(data["participants"], config)

    assert model is not None
    assert model.n == expected["model"]["n"]
    assert model.rmse == expected["model"]["rmse"]
    assert model.activeFeatureKeys == expected["model"]["activeFeatureKeys"]
    assert model.r2 == pytest.approx(expected["model"]["r2"], rel=1e-9)
    assert model.coeffs == pytest.approx(expected["model"]["coeffs"], rel=1e-6, abs=1e-6)
    for item in expected["predictions"]:
        got = vp.predict_inputs(model, item["inputs"])
        for key in ("velo", "category", "low", "high", "catLow", "catHigh"):
            assert got[key] == item["prediction"][key], key


def _participants(n: int = 30) -> list[dict]:
    rows = []
    for i in range(n):
        kg = 60 + (i * 7) % 35
        wkg20 = 2.4 + (i * 0.11) % 2.4
        rows.append({
            "name": f"R{i}",
            "zwiftId": str(i),
            "weightInGrams": kg * 1000,
            "cp5s": round(kg * wkg20 * 3.8),
            "cp1min": round(kg * wkg20 * 1.9),
            "cp5min": round(kg * wkg20 * 1.22),
            "cp20min": round(kg * wkg20 * 1.05),
            "racingScore": 200 + i * 10,
            "max30Rating": round(450 + wkg20 * 360 + ((i * 37) % 60 - 30)),
        })
    return rows


def test_no_model_without_enough_riders():
    config = vp.PredictorConfig()
    assert vp.build_model(_participants(3), config) is None


def test_riders_without_velo_or_weight_are_not_trained_on():
    rows = _participants()
    rows[0]["max30Rating"] = "N/A"
    rows[1]["weightInGrams"] = None
    rows[2]["max30Rating"] = 0
    model = vp.build_model(rows, vp.PredictorConfig())
    assert model.n == len(rows) - 3


def test_missing_input_gives_an_empty_prediction():
    model = vp.build_model(_participants(), vp.PredictorConfig())
    inputs = {"weightKg": 75, "wkg1m": 6.0, "wkg5m": 4.0, "wkg20m": 0}
    assert vp.predict_inputs(model, inputs) == vp.EMPTY_PREDICTION


def test_ridge_with_zero_lambda_equals_ols():
    rows = _participants()
    ols = vp.build_model(rows, vp.PredictorConfig())
    ridge = vp.build_model(rows, vp.PredictorConfig.from_dict({"regression": "ridge", "ridgeLambda": 0}))
    assert ridge.coeffs == pytest.approx(ols.coeffs)


def test_ridge_shrinks_towards_the_mean():
    rows = _participants()
    strong = vp.build_model(rows, vp.PredictorConfig.from_dict({"regression": "ridge", "ridgeLambda": 1000}))
    inputs = {"weightKg": 75, "wkg1m": 9.0, "wkg5m": 6.0, "wkg20m": 5.0}
    mean_velo = sum(r["max30Rating"] for r in rows) / len(rows)
    assert abs(vp.predict_inputs(strong, inputs)["velo"] - mean_velo) < 20


def test_the_outdoor_correction_applies_to_outdoor_efforts_only():
    scale = {"wkg5s": 0.9, "wkg1m": 0.9, "wkg5m": 0.9, "wkg20m": 0.9}
    curve = {"w5": 1000.0, "w60": 500.0, "w300": 350.0, "w1200": 300.0}
    indoor_only = vp.strava_split_inputs(
        {"split": True, "curveIndoor": curve, "curveOutdoor": {}}, 75)
    outdoor_only = vp.strava_split_inputs(
        {"split": True, "curveIndoor": {}, "curveOutdoor": curve}, 75)
    assert vp.strava_inputs(indoor_only, scale)["wkg20m"] == 4.0  # untouched
    assert vp.strava_inputs(outdoor_only, scale)["wkg20m"] == 3.6  # 4.0 * 0.9
    mixed = vp.strava_split_inputs({
        "split": True,
        "curveIndoor": {"w5": 900.0, "w1200": 285.0},
        "curveOutdoor": {"w5": 1100.0, "w1200": 300.0},
    }, 75)
    combined = vp.strava_inputs(mixed, scale)
    assert combined["wkg20m"] == 3.8  # indoor 3.8 beats corrected outdoor 3.6
    assert combined["wkg5s"] == 13.2  # corrected outdoor 13.2 beats indoor 12.0
    assert vp.strava_sources(mixed, scale) == {"wkg5s": "outdoor", "wkg20m": "indoor"}


def test_entries_before_the_split_are_treated_as_outdoor():
    legacy = vp.strava_split_inputs({"curve": {"w1200": 300.0}}, 75)
    assert legacy["indoor"] is None and legacy["outdoor"]["wkg20m"] == 4.0
    assert vp.strava_inputs(legacy, {"wkg20m": 0.9})["wkg20m"] == 3.6


def test_predict_inputs_never_scales_strava_again():
    rows = _participants()
    plain = vp.build_model(rows, vp.PredictorConfig())
    scaled = vp.build_model(rows, vp.PredictorConfig.from_dict({
        "stravaPowerScale": {"wkg5s": 1.1, "wkg1m": 1.1, "wkg5m": 1.1, "wkg20m": 1.1},
    }))
    inputs = {"weightKg": 75, "wkg1m": 6.0, "wkg5m": 4.0, "wkg20m": 3.5}
    assert vp.predict_inputs(scaled, inputs, source="strava")["velo"] == vp.predict_inputs(plain, inputs)["velo"]


def test_few_strava_rides_mark_the_prediction_low_confidence():
    model = vp.build_model(_participants(), vp.PredictorConfig.from_dict({"minStravaActivities": 5}))
    inputs = {"weightKg": 75, "wkg1m": 6.0, "wkg5m": 4.0, "wkg20m": 3.5}
    assert vp.predict_inputs(model, inputs, source="strava", activity_count=2)["confidence"] == "low"
    assert vp.predict_inputs(model, inputs, source="strava", activity_count=8)["confidence"] in ("high", "medium")


def test_config_falls_back_to_the_legacy_feature_map():
    cfg = vp.PredictorConfig.from_settings({"predictorFeatures": {"zrs": True, "weight_kg": False}})
    assert cfg.features["zrs"] is True
    assert cfg.features["weight_kg"] is False
    assert cfg.features["wkg20m"] is True  # default kept for keys not saved


def test_config_rejects_out_of_range_values():
    cfg = vp.PredictorConfig.from_dict({
        "regression": "magic",
        "ridgeLambda": -1,
        "stravaWindowDays": 45,
        "stravaPowerScale": {"wkg20m": 3.0},
        "minStravaActivities": True,
    })
    assert cfg.to_dict() == vp.PredictorConfig().to_dict()


def test_strava_curve_inputs():
    inputs = vp.inputs_from_strava_curve({"w5": 900, "w60": 450, "w300": 330, "w1200": 280}, 75.0)
    assert inputs == {
        "weightKg": 75.0, "racingScore": 0.0,
        "wkg5s": 12.0, "wkg1m": 6.0, "wkg5m": 4.4, "wkg20m": 3.73,
    }


def test_js_compatible_rounding():
    assert vp.js_round(2.5) == 3
    assert vp.js_round(-2.5) == -2
    assert vp.round2(1.005) == 1.0  # 1.005 is 1.00499... in binary, as in JS toFixed
    assert vp.round2(4.125) == 4.13


def test_prediction_curve_corrects_outdoor_watts_only():
    entry = {"split": True, "curveIndoor": {"w5": 900.0, "w1200": 285.0},
             "curveOutdoor": {"w5": 1100.0, "w1200": 300.0, "w60": 500.0}}
    curve = vp.strava_prediction_curve(entry, {"wkg5s": 0.9, "wkg1m": 0.9, "wkg5m": 0.9, "wkg20m": 0.9})
    assert curve == {"w5": 990.0, "w60": 450.0, "w1200": 285.0}
    assert vp.strava_prediction_curve({"curve": {"w1200": 300.0}}, {"wkg20m": 0.9}) == {"w1200": 270.0}
