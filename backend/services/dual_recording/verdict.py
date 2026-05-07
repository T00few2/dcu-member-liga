from __future__ import annotations

_DR_THRESHOLDS: dict[str, float] = {
    "w1200": 5.0,  # 20 min
    "w300": 5.5,  # 5 min
    "w60": 6.0,  # 1 min
    "w15": 6.5,  # 15 sec
}

_SIM_THRESHOLDS: dict[str, float] = {
    "maxMeanAbsDiffW": 5.0,
    "maxStdDiffW": 6.0,
    "maxStdDeltaDiffW": 3.0,
    "minOverlapSec": 180.0,
}


def _build_cp_comparison(zwift_curve: dict, strava_curve: dict) -> list:
    """Return list of per-duration comparison dicts."""
    labels = [
        ("w5", "5s"),
        ("w15", "15s"),
        ("w30", "30s"),
        ("w60", "1m"),
        ("w120", "2m"),
        ("w300", "5m"),
        ("w1200", "20m"),
    ]
    rows = []
    for key, label in labels:
        z = zwift_curve.get(key)
        s = strava_curve.get(key)
        if z is None and s is None:
            continue
        diff_w = round((z or 0) - (s or 0), 1)
        diff_pct = round(diff_w / s * 100, 1) if s else None
        rows.append(
            {
                "label": label,
                "key": key,
                "zwift": z,
                "strava": s,
                "diffW": diff_w,
                "diffPct": diff_pct,
            }
        )
    return rows


def _check_dr_pass(comparison: dict) -> tuple[bool, list[str]]:
    """Return (passed, failing_metric_keys) against DR thresholds."""
    failing: list[str] = []
    for row in (comparison or {}).get("cpDiff") or []:
        key = row.get("key")
        threshold = _DR_THRESHOLDS.get(key)
        if threshold is None:
            continue
        diff_pct = row.get("diffPct")
        if diff_pct is None:
            continue
        if diff_pct > threshold:
            failing.append(key)

    similarity = (comparison or {}).get("similarity") or {}
    overlap_sec = float(similarity.get("overlapSec") or 0.0)
    if overlap_sec >= _SIM_THRESHOLDS["minOverlapSec"]:
        mean_abs = similarity.get("meanAbsDiffW")
        std_diff = similarity.get("stdDiffW")
        std_delta = similarity.get("stdDeltaDiffW")
        if mean_abs is not None and float(mean_abs) <= _SIM_THRESHOLDS["maxMeanAbsDiffW"]:
            failing.append("similarity_mean_abs")
        if std_diff is not None and float(std_diff) <= _SIM_THRESHOLDS["maxStdDiffW"]:
            failing.append("similarity_std_diff")
        if std_delta is not None and float(std_delta) <= _SIM_THRESHOLDS["maxStdDeltaDiffW"]:
            failing.append("similarity_std_delta")
    return len(failing) == 0, failing


def _compute_similarity_metrics(zwift_1hz: list[float], strava_1hz: list[float]) -> dict:
    """
    Compute power-difference similarity metrics.
    diff(t) = zwift(t) - strava(t)
    """
    n = min(len(zwift_1hz), len(strava_1hz))
    if n == 0:
        return {"overlapSec": 0}

    diffs = [float(zwift_1hz[i]) - float(strava_1hz[i]) for i in range(n)]
    abs_diffs = [abs(d) for d in diffs]
    mean_abs = sum(abs_diffs) / n

    mean_diff = sum(diffs) / n
    var_diff = sum((d - mean_diff) ** 2 for d in diffs) / n
    std_diff = var_diff ** 0.5

    delta = [diffs[i] - diffs[i - 1] for i in range(1, n)]
    if delta:
        mean_delta = sum(delta) / len(delta)
        var_delta = sum((d - mean_delta) ** 2 for d in delta) / len(delta)
        std_delta = var_delta ** 0.5
    else:
        std_delta = 0.0

    return {
        "overlapSec": int(n),
        "meanAbsDiffW": round(mean_abs, 3),
        "stdDiffW": round(std_diff, 3),
        "stdDeltaDiffW": round(std_delta, 3),
    }

