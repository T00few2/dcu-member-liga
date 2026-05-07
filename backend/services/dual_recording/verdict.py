from __future__ import annotations

_DR_THRESHOLDS: dict[str, float] = {
    "w1200": 5.0,  # 20 min
    "w300": 5.5,  # 5 min
    "w60": 6.0,  # 1 min
    "w15": 6.5,  # 15 sec
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
    return len(failing) == 0, failing

