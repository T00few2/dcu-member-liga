from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import logging

from extensions import strava_service

from .time_series import (
    _compute_best_efforts,
    _mask_streams,
    _mse_sync_offset,
    _parse_event_start_iso,
    _parse_iso_utc,
    _resample_power_to_1hz,
)

logger = logging.getLogger(__name__)

# Among overlapping Strava files, pick the least Zwift-like trace so a
# Zwift→Strava upload is not compared with itself. Unrelated rides (outdoor,
# cooldown) score even lower, so ignore anything below the floor.
_ZWIFT_EXPORT_CORR = 0.995
_ZWIFT_EXPORT_NAMED_CORR = 0.98
_MIN_DUAL_RECORDING_CORR = 0.40
_CYCLING_SPORTS = frozenset({"Ride", "VirtualRide", "GravelRide", "MountainBikeRide"})


def _extract_stream(streams, stream_type):
    """Return the data array for a named stream from a Strava stream list."""
    for s in (streams or []):
        if s.get("type") == stream_type:
            return s.get("data") or []
    return []


def _is_cycling_strava_activity(act: dict) -> bool:
    sport = str(act.get("sport") or "Ride")
    return sport in _CYCLING_SPORTS


def _strava_activity_name(act: dict) -> str:
    return str(act.get("name") or "").strip()


def _is_zwift_named(act: dict) -> bool:
    return _strava_activity_name(act).lower().startswith("zwift")


def _is_zwift_export(act: dict, similarity: float | None) -> bool:
    if similarity is None:
        return False
    if similarity >= _ZWIFT_EXPORT_CORR:
        return True
    return similarity >= _ZWIFT_EXPORT_NAMED_CORR and _is_zwift_named(act)


def _activity_duration_sec(act: dict) -> int:
    return int(act.get("durationSec") or act.get("movingTimeSec") or 0)


def _event_start_as_utc_iso(event_start_iso: str | None) -> str | None:
    dt = _parse_event_start_iso(event_start_iso)
    if not dt:
        return None
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def _candidate_row(act: dict, overlap_sec: float, end_delta: float, start_delta: float, min_overlap_sec: float) -> dict:
    return {
        "activityId": str(act.get("id") or ""),
        "name": _strava_activity_name(act),
        "startDate": act.get("startDate"),
        "durationSec": _activity_duration_sec(act),
        "overlapSec": int(round(overlap_sec)),
        "endDeltaSec": int(round(end_delta)),
        "startDeltaSec": int(round(start_delta)),
        "meaningful": overlap_sec >= min_overlap_sec,
        "similarityScore": None,
        "selected": False,
        "excludedAsExport": False,
        "belowSimilarityFloor": False,
    }


def _choose_among_meaningful(
    meaningful: list[tuple[dict, float, float, float]],
    score_by_id: dict[str, float],
    zwift_window_sec: int,
) -> tuple[dict | None, str]:
    """Pick the dual-recording file: least similar to Zwift, but still the same ride."""
    dual_like: list[tuple[float, int, float, float, float, dict]] = []
    unscored: list[tuple[dict, float, float, float]] = []

    for act, overlap_sec, end_delta, start_delta in meaningful:
        aid = str(act.get("id") or "")
        score = score_by_id.get(aid)
        if score is None:
            unscored.append((act, overlap_sec, end_delta, start_delta))
            continue
        if _is_zwift_export(act, score) or score < _MIN_DUAL_RECORDING_CORR:
            continue
        duration_delta = abs(_activity_duration_sec(act) - zwift_window_sec)
        dual_like.append((score, duration_delta, overlap_sec, end_delta, start_delta, act))

    if dual_like:
        # Lowest correlation among same-ride files avoids the Zwift export.
        dual_like.sort(key=lambda row: (row[0], row[1], -row[2], row[3], row[4]))
        return dual_like[0][5], "lowest_similarity"

    if score_by_id and not unscored:
        return None, "no_similar_candidate"

    pool = [row for row in meaningful if not _is_zwift_named(row[0])] or list(meaningful)
    pool.sort(
        key=lambda row: (
            abs(_activity_duration_sec(row[0]) - zwift_window_sec),
            -row[1],
            row[2],
            row[3],
        )
    )
    return pool[0][0], "closest_duration"


def _match_strava_activity(
    user_id: str,
    strava_activity_id: str | None,
    zwift_started_at: str | None,
    zwift_duration_sec: int | None,
    zwift_times: list | None,
    zwift_watts: list | None,
    event_start_iso: str | None,
) -> tuple[dict | None, str | None, dict]:
    """Return (matched_strava_dict, resolved_strava_id, matching_debug)."""
    activities = strava_service.get_activities_for_matching(user_id)
    matching_debug: dict = {
        "selectionReason": "none",
        "anchorUsed": None,
        "anchorFallbackUsed": False,
        "minOverlapSec": None,
        "chosenActivityId": None,
        "meaningfulCandidateCount": 0,
        "candidates": [],
    }

    if strava_activity_id:
        match = next((a for a in activities if str(a["id"]) == str(strava_activity_id)), None)
        matching_debug.update(
            {
                "selectionReason": "manual_strava_id" if match else "manual_strava_id_not_found",
                "chosenActivityId": str(match.get("id")) if match else None,
            }
        )
        return match, strava_activity_id if match else None, matching_debug

    zwift_window_sec = int(zwift_duration_sec or 0)
    if zwift_window_sec <= 0:
        matching_debug.update(
            {
                "selectionReason": "invalid_zwift_window",
                "minOverlapSec": 0,
            }
        )
        return None, None, matching_debug

    min_overlap_sec = max(300, min(1200, int(zwift_window_sec * 0.35)))
    matching_debug["minOverlapSec"] = min_overlap_sec
    event_anchor = _event_start_as_utc_iso(event_start_iso)

    def _find_for_anchor(
        anchor_iso: str | None,
    ) -> tuple[dict | None, str | None, list[tuple[dict, float, float, float]], float, str | None, list[dict]]:
        anchor_dt = _parse_iso_utc(anchor_iso) if anchor_iso else None
        if not anchor_dt:
            return None, None, [], -1.0, None, []

        zwift_start = anchor_dt.timestamp()
        zwift_end = zwift_start + zwift_window_sec
        overlap_candidates: list[tuple[dict, float, float, float]] = []
        best_overlap = -1.0

        for act in activities:
            if not _is_cycling_strava_activity(act):
                continue
            act_dt = _parse_iso_utc(act.get("startDate", ""))
            if not act_dt:
                continue
            duration_sec = _activity_duration_sec(act)
            if duration_sec <= 0:
                continue

            act_start = act_dt.timestamp()
            act_end = act_start + duration_sec
            overlap_sec = max(0.0, min(zwift_end, act_end) - max(zwift_start, act_start))
            end_delta = abs(act_end - zwift_end)
            start_delta = abs(act_start - zwift_start)
            overlap_candidates.append((act, overlap_sec, end_delta, start_delta))
            if overlap_sec > best_overlap:
                best_overlap = overlap_sec

        overlap_candidates.sort(key=lambda row: (-row[1], row[2], row[3]))
        candidate_rows = [
            _candidate_row(act, overlap_sec, end_delta, start_delta, min_overlap_sec)
            for act, overlap_sec, end_delta, start_delta in overlap_candidates[:12]
        ]
        meaningful = [c for c in overlap_candidates if c[1] >= min_overlap_sec]
        if not meaningful:
            return None, None, [], best_overlap, "no_meaningful_overlap", candidate_rows

        score_by_id: dict[str, float] = {}
        can_score = bool(zwift_times and zwift_watts and zwift_started_at and zwift_window_sec > 0)
        if can_score:
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
                score_by_id[str(act.get("id"))] = float(score)

        chosen_act, selection_reason = _choose_among_meaningful(
            meaningful, score_by_id, zwift_window_sec
        )
        chosen_id = str(chosen_act.get("id")) if chosen_act else None
        act_by_id = {str(act.get("id") or ""): act for act, *_ in overlap_candidates}
        for row in candidate_rows:
            rid = str(row.get("activityId") or "")
            act = act_by_id.get(rid) or {"name": row.get("name")}
            if rid in score_by_id:
                row["similarityScore"] = round(score_by_id[rid], 6)
                row["excludedAsExport"] = _is_zwift_export(act, score_by_id[rid])
                row["belowSimilarityFloor"] = score_by_id[rid] < _MIN_DUAL_RECORDING_CORR
            if chosen_id and rid == chosen_id:
                row["selected"] = True

        if not chosen_act:
            return None, None, meaningful, best_overlap, selection_reason, candidate_rows

        chosen_score = score_by_id.get(chosen_id) if chosen_id else None
        logger.info(
            "Strava dual-recording match: rider=%s reason=%s chosen=%s score=%s overlap_candidates=%s",
            user_id,
            selection_reason,
            chosen_act.get("id"),
            f"{chosen_score:.4f}" if chosen_score is not None else "n/a",
            len(meaningful),
        )
        return (
            chosen_act,
            str(chosen_act["id"]),
            meaningful,
            best_overlap,
            selection_reason,
            candidate_rows,
        )

    if zwift_started_at:
        primary_anchor, primary_label = zwift_started_at, "zwift_start"
        secondary_anchor, secondary_label = (
            (event_anchor, "event_start")
            if event_anchor and event_anchor != str(zwift_started_at).strip()
            else (None, None)
        )
    else:
        primary_anchor, primary_label = event_anchor, "event_start"
        secondary_anchor, secondary_label = None, None

    matched, resolved, meaningful, best_overlap, selection_reason, candidate_rows = _find_for_anchor(
        primary_anchor
    )
    matching_debug.update(
        {
            "anchorUsed": primary_label,
            "selectionReason": selection_reason or "none",
            "chosenActivityId": str(resolved) if resolved else None,
            "meaningfulCandidateCount": len(meaningful),
            "candidates": candidate_rows,
        }
    )
    if matched:
        return matched, resolved, matching_debug

    if secondary_anchor:
        matched_fb, resolved_fb, meaningful_fb, best_overlap_fb, reason_fb, rows_fb = _find_for_anchor(
            secondary_anchor
        )
        matching_debug.update(
            {
                "anchorUsed": secondary_label,
                "anchorFallbackUsed": True,
                "selectionReason": reason_fb or "none",
                "chosenActivityId": str(resolved_fb) if resolved_fb else None,
                "meaningfulCandidateCount": len(meaningful_fb),
                "candidates": rows_fb,
            }
        )
        if matched_fb:
            logger.info(
                "Strava match fallback used %s for rider=%s (primary=%s)",
                secondary_label,
                user_id,
                primary_label,
            )
            return matched_fb, resolved_fb, matching_debug
        meaningful = meaningful_fb
        best_overlap = best_overlap_fb

    if not meaningful:
        logger.info(
            "No meaningful Strava overlap match for rider=%s (best_overlap=%.0fs, required=%ss)",
            user_id,
            best_overlap if best_overlap >= 0 else 0,
            min_overlap_sec,
        )
    return None, None, matching_debug


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
    """Compute merged peak curve across rider activities.

    Streams are requested at full resolution (resolution=None) so long rides are not
    time-averaged before the peaks are read, and gaps are zero-filled rather than
    interpolated so a stop never contributes watts to a best effort.
    """
    merged: dict = {}
    futures = {}
    with ThreadPoolExecutor(max_workers=max_workers) as executor:
        for act in activities:
            fut = executor.submit(
                strava_service.get_activity_streams,
                rider_id,
                act["id"],
                "time,watts",
                None,
            )
            futures[fut] = act["id"]

    for fut, act_id in futures.items():
        try:
            streams = fut.result()
            times = _extract_stream(streams or [], "time")
            watts = _extract_stream(streams or [], "watts")
            if not times or not watts:
                continue
            w_1hz = _resample_power_to_1hz(times, watts)
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

