from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import logging

from extensions import strava_service

from .time_series import _compute_best_efforts, _mask_streams, _mse_sync_offset, _parse_iso_utc, _resample_to_1hz

logger = logging.getLogger(__name__)


def _extract_stream(streams, stream_type):
    """Return the data array for a named stream from a Strava stream list."""
    for s in (streams or []):
        if s.get("type") == stream_type:
            return s.get("data") or []
    return []


def _match_strava_activity(
    user_id: str,
    strava_activity_id: str | None,
    zwift_started_at: str | None,
    zwift_duration_sec: int | None,
    event_start_iso: str | None,
) -> tuple[dict | None, str | None]:
    """Return (matched_strava_dict, resolved_strava_id)."""
    activities = strava_service.get_activities_for_matching(user_id)

    if strava_activity_id:
        match = next((a for a in activities if str(a["id"]) == str(strava_activity_id)), None)
        return match, strava_activity_id if match else None

    anchor_iso = zwift_started_at or event_start_iso
    anchor_dt = _parse_iso_utc(anchor_iso) if anchor_iso else None
    if not anchor_dt:
        return None, None

    zwift_window_sec = int(zwift_duration_sec or 0)
    if zwift_window_sec <= 0:
        # Strict mode: without a race duration we cannot compute meaningful overlap.
        return None, None

    zwift_start = anchor_dt
    zwift_end = zwift_start.timestamp() + zwift_window_sec
    min_overlap_sec = max(300, min(1200, int(zwift_window_sec * 0.35)))

    best = None
    best_overlap = -1.0
    best_end_delta = float("inf")
    best_start_delta = float("inf")

    for act in activities:
        act_dt = _parse_iso_utc(act.get("startDate", ""))
        if not act_dt:
            continue

        duration_sec = int(
            act.get("durationSec")
            or act.get("movingTimeSec")
            or 0
        )
        if duration_sec <= 0:
            continue

        act_start = act_dt.timestamp()
        act_end = act_start + duration_sec
        overlap_sec = max(0.0, min(zwift_end, act_end) - max(zwift_start.timestamp(), act_start))

        end_delta = abs(act_end - zwift_end)
        start_delta = abs(act_start - zwift_start.timestamp())

        if overlap_sec > best_overlap:
            best = act
            best_overlap = overlap_sec
            best_end_delta = end_delta
            best_start_delta = start_delta
            continue
        if overlap_sec == best_overlap:
            if end_delta < best_end_delta or (end_delta == best_end_delta and start_delta < best_start_delta):
                best = act
                best_end_delta = end_delta
                best_start_delta = start_delta

    if best and best_overlap >= min_overlap_sec:
        return best, str(best["id"])

    logger.info(
        "No meaningful Strava overlap match for rider=%s (best_overlap=%.0fs, required=%ss)",
        user_id,
        best_overlap if best_overlap >= 0 else 0,
        min_overlap_sec,
    )
    return None, None


def _trim_strava_streams(
    s_times: list,
    s_watts: list,
    s_cadence: list,
    s_hr: list,
    s_alt: list,
    z_times: list,
    z_watts: list,
    zwift_started_at: str,
    strava_started_at: str,
    zwift_duration_sec: int | None,
) -> tuple[dict, int, str, int]:
    """Align Strava streams to Zwift time axis and trim to race window."""
    z_dt = _parse_iso_utc(zwift_started_at) if zwift_started_at else None
    s_dt = _parse_iso_utc(strava_started_at) if strava_started_at else None
    ts_offset = int((s_dt - z_dt).total_seconds()) if (z_dt and s_dt) else 0

    power_offset = _mse_sync_offset(z_times, z_watts, s_times, s_watts)
    if power_offset is None:
        strava_offset = ts_offset
        sync_method = "timestamp"
    elif power_offset == 0:
        strava_offset = 0
        sync_method = "power_mse_no_shift"
    else:
        strava_offset = power_offset
        sync_method = "power_mse"

    s_aligned = [strava_offset + t for t in s_times] if s_times else []
    win_end = zwift_duration_sec or 0

    if s_aligned and zwift_duration_sec:
        mask = [0 <= t <= win_end for t in s_aligned]
        trimmed = _mask_streams(
            mask,
            time=s_aligned,
            watts=s_watts or [],
            cadence=s_cadence or [],
            heartrate=s_hr or [],
            altitude=s_alt or [],
        )
    else:
        trimmed = {
            "time": list(s_aligned),
            "watts": list(s_watts or []),
            "cadence": list(s_cadence or []),
            "heartrate": list(s_hr or []),
            "altitude": list(s_alt or []),
        }

    return trimmed, strava_offset, sync_method, ts_offset


def _compute_strava_power_curve(rider_id: str, activities: list, max_workers: int = 10) -> dict:
    """Compute merged peak curve across rider activities."""
    merged: dict = {}
    futures = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for act in activities:
            fut = executor.submit(
                strava_service.get_activity_streams,
                rider_id,
                act["id"],
                "time,watts",
            )
            futures[fut] = act["id"]

    for fut, act_id in futures.items():
        try:
            streams = fut.result()
            times = _extract_stream(streams or [], "time")
            watts = _extract_stream(streams or [], "watts")
            if not times or not watts:
                continue
            w_1hz = _resample_to_1hz(times, watts)
            if not w_1hz:
                continue
            efforts = _compute_best_efforts(w_1hz)
            for k, v in efforts.items():
                if v > merged.get(k, 0):
                    merged[k] = v
        except Exception as exc:
            logger.warning(
                "_compute_strava_power_curve: stream error for activity %s: %s",
                act_id,
                exc,
            )
    return merged

