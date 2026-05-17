from __future__ import annotations

from datetime import datetime, timezone


def _mask_streams(mask: list, **arrays: list) -> dict:
    """Apply a boolean mask to one or more parallel stream arrays."""
    return {k: [v for v, m in zip(arr, mask) if m] for k, arr in arrays.items()}


def _compute_avg_power_diff(
    zwift_avg: float | None, strava_avg: float | None
) -> tuple[float | None, float | None]:
    """Return (diff_watts, diff_pct) or (None, None) if missing."""
    if zwift_avg is None or strava_avg is None:
        return None, None
    diff_w = round(zwift_avg - strava_avg, 1)
    diff_pct = round(diff_w / strava_avg * 100, 1)
    return diff_w, diff_pct


def _resample_to_1hz(times: list, values: list) -> list:
    """Interpolate (time,value) pairs onto integer-second grid."""
    if not times or not values:
        return []
    max_t = int(times[-1])
    result = [0.0] * (max_t + 1)
    n = len(times)
    src = 0
    for t in range(max_t + 1):
        while src + 1 < n and times[src + 1] <= t:
            src += 1
        if src + 1 >= n:
            result[t] = float(values[src])
        else:
            t0, t1 = float(times[src]), float(times[src + 1])
            if t1 == t0:
                result[t] = float(values[src])
            else:
                alpha = (t - t0) / (t1 - t0)
                result[t] = float(values[src]) * (1 - alpha) + float(values[src + 1]) * alpha
    return result


def _mse_sync_offset(
    z_times: list, z_watts: list, s_times: list, s_watts: list, search_sec: int = 600
) -> int | None:
    """Find integer-second offset to minimize MSE of power streams."""
    if not z_times or not z_watts or not s_times or not s_watts:
        return None

    z_1hz = [v if v is not None else 0.0 for v in _resample_to_1hz(z_times, z_watts)]
    s_1hz = [v if v is not None else 0.0 for v in _resample_to_1hz(s_times, s_watts)]

    nz, ns = len(z_1hz), len(s_1hz)
    if nz < 60 or ns < 60:
        return None
    if max(z_1hz) == 0 or max(s_1hz) == 0:
        return None

    def _mse(tau):
        z_start = max(0, tau)
        s_start = max(0, -tau)
        length = min(nz - z_start, ns - s_start)
        if length < 60:
            return None
        zw = z_1hz[z_start: z_start + length]
        sw = s_1hz[s_start: s_start + length]
        return sum((a - b) ** 2 for a, b in zip(zw, sw)) / length

    mse_zero = _mse(0)
    if mse_zero is None:
        return None

    best_mse = mse_zero
    best_tau = 0
    for tau in range(-search_sec, search_sec + 1):
        if tau == 0:
            continue
        m = _mse(tau)
        if m is not None and m < best_mse:
            best_mse = m
            best_tau = tau

    if best_tau != 0 and best_mse >= mse_zero * 0.97:
        return 0
    return best_tau


def _compute_best_efforts(
    w_1hz: list, durations=(5, 15, 30, 60, 120, 300, 1200)
) -> dict:
    """Rolling-window best average power at each duration."""
    n = len(w_1hz)
    result = {}
    for d in durations:
        if d > n:
            continue
        win = sum(w_1hz[:d])
        best = win
        for i in range(d, n):
            win += w_1hz[i] - w_1hz[i - d]
            if win > best:
                best = win
        result[f"w{d}"] = round(best / d, 1)
    return result


def _parse_iso_utc(iso_str: str) -> datetime | None:
    """Parse ISO-8601 string into UTC-aware datetime."""
    if not iso_str:
        return None
    try:
        clean = iso_str.rstrip("Z").split("+")[0]
        return datetime.fromisoformat(clean).replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _compute_best_efforts_with_windows(
    w_1hz: list[float],
    durations: tuple[int, ...],
) -> tuple[dict[str, float], dict[str, tuple[int, int]]]:
    """Return best-effort watts and winning window (start_sec, duration_sec)."""
    n = len(w_1hz)
    efforts: dict[str, float] = {}
    windows: dict[str, tuple[int, int]] = {}
    for d in durations:
        if d > n:
            continue
        win = sum(w_1hz[:d])
        best = win
        best_start = 0
        for i in range(d, n):
            win += w_1hz[i] - w_1hz[i - d]
            start = i - d + 1
            if win > best:
                best = win
                best_start = start
        key = f"w{d}"
        efforts[key] = round(best / d, 1)
        windows[key] = (best_start, d)
    return efforts, windows


def _compute_efforts_on_reference_windows(
    w_1hz: list[float],
    ref_windows: dict[str, tuple[int, int]],
) -> dict[str, float]:
    """Compute average watts on externally provided (start, duration) windows."""
    n = len(w_1hz)
    efforts: dict[str, float] = {}
    for key, (start, dur) in ref_windows.items():
        end = start + dur
        if start < 0 or dur <= 0 or end > n:
            continue
        efforts[key] = round(sum(w_1hz[start:end]) / dur, 1)
    return efforts


_SW_DEFAULTS: dict = {
    "minWatts": 100,
    "minRun": 3,
    "zeroThresh": 20,
    "suspiciousPairPct": 25,
    "suspiciousPreZero": 2,
}


def analyze_sticky_watts(times: list, watts: list, thresholds: dict | None = None) -> dict:
    """Detect sticky-watts signatures in a Zwift power stream."""
    t = {**_SW_DEFAULTS, **(thresholds or {})}

    n = min(len(times), len(watts))
    vals: list[int] = [int(w) if w is not None else 0 for w in watts[:n]]

    total = len(vals)
    nonzero = sum(1 for w in vals if w > t["minWatts"])

    if total < 4 or nonzero < 4:
        return {
            "totalSamples": total,
            "nonZeroSamples": nonzero,
            "identicalPairPct": 0.0,
            "stickyRuns": 0,
            "maxRunLength": 0,
            "preZeroEvents": 0,
            "suspicious": False,
        }

    identical_pairs = 0
    eligible_pairs = 0
    for i in range(len(vals) - 1):
        w0, w1 = vals[i], vals[i + 1]
        if w0 > t["minWatts"] and w1 > t["minWatts"]:
            eligible_pairs += 1
            if w0 == w1:
                identical_pairs += 1
    pair_pct = round(identical_pairs / eligible_pairs * 100, 1) if eligible_pairs > 0 else 0.0

    sticky_runs = 0
    max_run = 0
    pre_zero_events = 0

    i = 0
    while i < len(vals):
        w = vals[i]
        if w <= t["minWatts"]:
            i += 1
            continue
        run_len = 1
        j = i + 1
        while j < len(vals) and vals[j] == w:
            run_len += 1
            j += 1
        if run_len >= t["minRun"]:
            sticky_runs += 1
            if run_len > max_run:
                max_run = run_len
            if j < len(vals) and vals[j] < t["zeroThresh"]:
                pre_zero_events += 1
        i = j

    suspicious = pre_zero_events >= t["suspiciousPreZero"] or pair_pct >= t["suspiciousPairPct"]

    return {
        "totalSamples": total,
        "nonZeroSamples": nonzero,
        "identicalPairPct": pair_pct,
        "stickyRuns": sticky_runs,
        "maxRunLength": max_run,
        "preZeroEvents": pre_zero_events,
        "suspicious": suspicious,
    }

