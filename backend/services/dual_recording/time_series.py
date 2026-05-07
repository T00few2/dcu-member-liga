from __future__ import annotations

from datetime import datetime, timezone


def _mask_streams(mask: list, **arrays: list) -> dict:
    """Apply a boolean mask to one or more parallel stream arrays."""
    return {k: [v for v, m in zip(arr, mask) if m] for k, arr in arrays.items()}


def _compute_avg_power_diff(
    zwift_avg: float | None, strava_avg: float | None
) -> tuple[float | None, float | None]:
    """Return (diff_watts, diff_pct) or (None, None) if missing."""
    if not zwift_avg or not strava_avg:
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
        zw = z_1hz[z_start : z_start + length]
        sw = s_1hz[s_start : s_start + length]
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

