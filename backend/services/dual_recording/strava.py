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
    zwift_times: list | None,
    zwift_watts: list | None,
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
    overlap_candidates: list[tuple[dict, float, float, float]] = []

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

        overlap_candidates.append((act, overlap_sec, end_delta, start_delta))

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

    meaningful = [c for c in overlap_candidates if c[1] >= min_overlap_sec]
    if not meaningful:
        logger.info(
            "No meaningful Strava overlap match for rider=%s (best_overlap=%.0fs, required=%ss)",
            user_id,
            best_overlap if best_overlap >= 0 else 0,
            min_overlap_sec,
        )
        return None, None

    # If several candidates overlap sufficiently, choose the lowest similarity score
    # (least similar power trace to Zwift) to avoid selecting exported Zwift uploads.
    if (
        len(meaningful) > 1
        and zwift_times
        and zwift_watts
        and zwift_started_at
        and zwift_window_sec > 0
    ):
        scored: list[tuple[float, dict, float, float, float]] = []
        for act, overlap_sec, end_delta, start_delta in meaningful:
            score = _compute_similarity_score_for_activity(
                user_id=user_id,
                activity=act,
                zwift_started_at=zwift_started_at,
                zwift_duration_sec=zwift_window_sec,
                zwift_times=zwift_times,
                zwift_watts=zwift_watts,
            )
            if score is None:
                continue
            scored.append((score, act, overlap_sec, end_delta, start_delta))

        if scored:
            scored.sort(key=lambda x: (x[0], -x[2], x[3], x[4]))
            chosen_score, chosen_act, chosen_overlap, _, _ = scored[0]
            logger.info(
                "Strava overlap tie-break by similarity: rider=%s candidates=%s chosen=%s score=%.4f overlap=%.0fs",
                user_id,
                len(scored),
                chosen_act.get("id"),
                chosen_score,
                chosen_overlap,
            )
            return chosen_act, str(chosen_act["id"])

    if best and best_overlap >= min_overlap_sec:
        return best, str(best["id"])
    return None, None


def _compute_similarity_score_for_activity(
    *,
    user_id: str,
    activity: dict,
    zwift_started_at: str,
    zwift_duration_sec: int,
    zwift_times: list,
    zwift_watts: list,
) -> float | None:
    """
    Return a similarity score in [-1, 1] where lower means less similar.
    Uses Pearson correlation over aligned power samples.
    """
    try:
        streams = strava_service.get_activity_streams(user_id, activity.get("id"), keys="time,watts")
        s_times = _extract_stream(streams, "time")
        s_watts = _extract_stream(streams, "watts")
        if not s_times or not s_watts:
            return None

        strava_started_at = activity.get("startDate", "")
        z_dt = _parse_iso_utc(zwift_started_at) if zwift_started_at else None
        s_dt = _parse_iso_utc(strava_started_at) if strava_started_at else None
        ts_offset = int((s_dt - z_dt).total_seconds()) if (z_dt and s_dt) else 0
        power_offset = _mse_sync_offset(zwift_times, zwift_watts, s_times, s_watts)
        if power_offset is None:
            strava_offset = ts_offset
        elif power_offset == 0:
            strava_offset = 0
        else:
            strava_offset = power_offset

        z_map: dict[int, float] = {}
        for t, w in zip(zwift_times, zwift_watts):
            if w is None:
                continue
            sec = int(round(float(t)))
            if sec < 0 or sec > zwift_duration_sec:
                continue
            z_map[sec] = float(w)

        z_vals: list[float] = []
        s_vals: list[float] = []
        for t, w in zip(s_times, s_watts):
            if w is None:
                continue
            sec = int(round(float(strava_offset + t)))
            if sec < 0 or sec > zwift_duration_sec:
                continue
            zw = z_map.get(sec)
            if zw is None:
                continue
            z_vals.append(zw)
            s_vals.append(float(w))

        n = len(z_vals)
        if n < 120:
            return None

        mz = sum(z_vals) / n
        ms = sum(s_vals) / n
        cov = sum((z - mz) * (s - ms) for z, s in zip(z_vals, s_vals)) / n
        var_z = sum((z - mz) ** 2 for z in z_vals) / n
        var_s = sum((s - ms) ** 2 for s in s_vals) / n
        if var_z <= 0 or var_s <= 0:
            return None
        corr = cov / ((var_z ** 0.5) * (var_s ** 0.5))
        if corr != corr:  # NaN guard
            return None
        return max(-1.0, min(1.0, float(corr)))
    except Exception as exc:
        logger.debug("Similarity score failed for Strava activity %s: %s", activity.get("id"), exc)
        return None


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

