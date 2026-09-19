from __future__ import annotations

from datetime import datetime, timezone
from statistics import median

import pytz

_COPENHAGEN_TZ = pytz.timezone("Europe/Copenhagen")


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


def _coerce_float(value) -> float:
    """Stream samples may be null; treat a missing reading as zero."""
    return float(value) if value is not None else 0.0


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
            result[t] = _coerce_float(values[src])
        else:
            t0, t1 = float(times[src]), float(times[src + 1])
            if t1 == t0:
                result[t] = _coerce_float(values[src])
            else:
                alpha = (t - t0) / (t1 - t0)
                result[t] = _coerce_float(values[src]) * (1 - alpha) + _coerce_float(values[src + 1]) * alpha
    return result


#: Gaps longer than this many seconds are read as "the rider was not pedalling",
#: not as a stretch of power to be invented by interpolation.
POWER_GAP_THRESHOLD_SEC = 15


def _resample_power_to_1hz(
    times: list, watts: list, gap_threshold_sec: int = POWER_GAP_THRESHOLD_SEC
) -> list:
    """Put a power stream on a 1 Hz grid, treating recording gaps as zero watts.

    Devices with auto-pause or smart recording emit no samples while the rider is
    stopped, so the time stream jumps. Interpolating across such a jump (what
    `_resample_to_1hz` does) invents power that was never produced and inflates
    long-duration peaks — a 20-minute best effort can be built half out of a traffic
    light. Short gaps are still interpolated; anything longer than
    `gap_threshold_sec` is filled with zeros.
    """
    if not times or not watts:
        return []

    n = min(len(times), len(watts))
    if n == 0:
        return []

    ts = [int(t) for t in times[:n]]
    vals = [_coerce_float(w) for w in watts[:n]]

    start = ts[0]
    total = ts[-1] - start + 1
    if total <= 0:
        return []

    result = [0.0] * total
    for i in range(n - 1):
        t0 = ts[i] - start
        t1 = ts[i + 1] - start
        if t1 <= t0:
            result[t0] = vals[i]
            continue
        gap = t1 - t0
        if gap > gap_threshold_sec:
            # Rider was stopped (or the device was): only the sampled second counts.
            result[t0] = vals[i]
            continue
        for t in range(t0, t1):
            alpha = (t - t0) / gap
            result[t] = vals[i] * (1 - alpha) + vals[i + 1] * alpha
    result[total - 1] = vals[n - 1]
    return result


def _mse_sync_offset(
    z_times: list,
    z_watts: list,
    s_times: list,
    s_watts: list,
    search_sec: int = 600,
    hint_offset: int | None = None,
) -> int | None:
    """Find integer-second offset to minimize MSE of power streams.

    Searches ±search_sec around 0 and, when given, around hint_offset (clock
    difference). A 20-minute late Strava start sits far outside ±10 minutes,
    so without the hint MSE can lock onto a local minimum near t=0 and report
    an early stop instead of a late start.
    """
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

    offsets = set(range(-search_sec, search_sec + 1))
    if hint_offset is not None:
        offsets.update(range(hint_offset - search_sec, hint_offset + search_sec + 1))

    best_mse = mse_zero
    best_tau = 0
    for tau in offsets:
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


def _parse_event_start_iso(iso_str: str | None) -> datetime | None:
    """Parse a race/event start. Naive timestamps are Europe/Copenhagen local time."""
    if not iso_str:
        return None
    raw = str(iso_str).strip()
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except (ValueError, AttributeError):
        return _parse_iso_utc(raw)
    if dt.tzinfo is None:
        dt = _COPENHAGEN_TZ.localize(dt)
    return dt.astimezone(timezone.utc)


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


_GW_DEFAULTS: dict = {
    "cadZeroThresh": 5,
    "minGhostWatts": 8,
    "minRun": 3,
    "minGhostSeconds": 20,
    "minGhostEvents": 3,
    "suspiciousFloorW": 10,
}

# Pedaling samples used to decide whether cadence data is real (missing sensors
# write 0 rpm for the whole ride and would otherwise mass-flag ghost watts).
_GW_ACTIVE_WATTS = 50
_GW_MIN_ACTIVE_CADENCE_SHARE = 0.20


def _empty_ghost_watts(total: int, *, insufficient: bool) -> dict:
    return {
        "totalSamples": total,
        "ghostEvents": 0,
        "ghostSeconds": 0,
        "medianGhostWatts": 0.0,
        "maxGhostWatts": 0,
        "zeroCadenceSeconds": 0,
        "ghostShareOfZeroCadence": 0.0,
        "insufficientCadence": insufficient,
        "suspicious": False,
    }


def _sticky_run_mask(vals: list[int], min_watts: int, min_run: int) -> list[bool]:
    """True on samples that are already a sticky identical-watt plateau."""
    mask = [False] * len(vals)
    i = 0
    n = len(vals)
    while i < n:
        w = vals[i]
        if w <= min_watts:
            i += 1
            continue
        j = i + 1
        while j < n and vals[j] == w:
            j += 1
        if (j - i) >= min_run:
            for k in range(i, j):
                mask[k] = True
        i = j
    return mask


def analyze_ghost_watts(
    times: list,
    watts: list,
    cadence: list | None,
    thresholds: dict | None = None,
) -> dict:
    """Detect ghost-watts (raised power floor while cadence is ~0)."""
    t = {**_GW_DEFAULTS, **(thresholds or {})}
    cad_zero = t["cadZeroThresh"]
    min_ghost = t["minGhostWatts"]
    min_run = t["minRun"]

    n = min(len(times), len(watts))
    if n == 0:
        return _empty_ghost_watts(0, insufficient=True)

    vals: list[int] = [int(w) if w is not None else 0 for w in watts[:n]]
    cad_raw = cadence or []
    if not cad_raw:
        return _empty_ghost_watts(n, insufficient=True)

    n = min(n, len(cad_raw))
    vals = vals[:n]
    cad: list[int] = [int(c) if c is not None else 0 for c in cad_raw[:n]]

    active = 0
    active_with_cad = 0
    for w, c in zip(vals, cad):
        if w > _GW_ACTIVE_WATTS:
            active += 1
            if c >= cad_zero:
                active_with_cad += 1
    if active < 4 or (active_with_cad / active) < _GW_MIN_ACTIVE_CADENCE_SHARE:
        return _empty_ghost_watts(n, insufficient=True)

    sticky = _sticky_run_mask(vals, _SW_DEFAULTS["minWatts"], _SW_DEFAULTS["minRun"])

    zero_cadence_seconds = sum(1 for c in cad if c < cad_zero)
    ghost_share_samples = 0
    is_ghost = [False] * n
    for i in range(n):
        if cad[i] < cad_zero and vals[i] >= min_ghost and not sticky[i]:
            is_ghost[i] = True
            ghost_share_samples += 1

    ghost_share = (
        round(ghost_share_samples / zero_cadence_seconds * 100, 1)
        if zero_cadence_seconds > 0
        else 0.0
    )

    ghost_events = 0
    ghost_seconds = 0
    ghost_watts: list[int] = []
    i = 0
    while i < n:
        if not is_ghost[i]:
            i += 1
            continue
        j = i + 1
        while j < n and is_ghost[j]:
            j += 1
        run_len = j - i
        if run_len >= min_run:
            ghost_events += 1
            ghost_seconds += run_len
            ghost_watts.extend(vals[i:j])
        i = j

    median_w = round(float(median(ghost_watts)), 1) if ghost_watts else 0.0
    max_w = max(ghost_watts) if ghost_watts else 0
    suspicious = (
        median_w >= t["suspiciousFloorW"]
        and (ghost_seconds >= t["minGhostSeconds"] or ghost_events >= t["minGhostEvents"])
    )

    return {
        "totalSamples": n,
        "ghostEvents": ghost_events,
        "ghostSeconds": ghost_seconds,
        "medianGhostWatts": median_w,
        "maxGhostWatts": max_w,
        "zeroCadenceSeconds": zero_cadence_seconds,
        "ghostShareOfZeroCadence": ghost_share,
        "insufficientCadence": False,
        "suspicious": suspicious,
    }

