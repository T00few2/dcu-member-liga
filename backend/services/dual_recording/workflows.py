"""Core dual-recording computation: fetch streams and compare Zwift vs Strava."""
from __future__ import annotations

import logging

from extensions import get_zwift_service, strava_service
from services.zwift_tokens import get_valid_access_token

from .strava import _extract_stream, _match_strava_activity, _trim_strava_streams
from .time_series import (
    _compute_avg_power_diff,
    _compute_best_efforts,
    _compute_best_efforts_with_windows,
    _compute_efforts_on_reference_windows,
    _resample_to_1hz,
    analyze_sticky_watts,
)
from .verdict import _build_cp_comparison, _compute_similarity_metrics
from .zwift import _extract_zwift_activity_fields, _fetch_zwift_streams

logger = logging.getLogger(__name__)

# Maximum fraction of the Zwift stream that may be cropped to align with a
# late-starting Strava recording before the gap is flagged in sync metadata.
_STRAVA_CROP_MAX_FRACTION: float = 0.15


def _compute_dual_recording_for_rider(
    db: object,
    user_doc_id: str,
    zwift_activity_id: str,
    event_start_iso: str | None = None,
    strava_activity_id: str | None = None,
    sw_thresholds: dict | None = None,
) -> dict:
    """Run the full dual-recording comparison for one rider/activity."""
    access_token = get_valid_access_token(user_doc_id, get_zwift_service())

    zwift_doc = db.collection("zwift_activities").document(str(zwift_activity_id)).get()
    zwift_raw: dict = {}
    fresh_activity: dict = {}
    if zwift_doc.exists:
        zwift_raw = (zwift_doc.to_dict() or {}).get("data") or {}
    elif access_token:
        fresh_activity = get_zwift_service().get_user_activity(str(zwift_activity_id), access_token) or {}
        zwift_raw = fresh_activity
    if not zwift_raw:
        raise ValueError(f"Zwift activity {zwift_activity_id} not found")

    zf = _extract_zwift_activity_fields(zwift_raw)
    zwift_started_at = zf["startedAt"]
    zwift_duration_sec = zf["durationSec"]
    zwift_avg_watts = zf["avgWatts"]

    zwift_streams: dict = {}
    if access_token:
        try:
            # Pass fresh_activity to avoid a second get_user_activity call when
            # we already fetched it above (non-cached path).
            zwift_streams, _ = _fetch_zwift_streams(
                zwift_raw, zwift_activity_id, access_token,
                fresh_activity=fresh_activity or None,
            )
        except Exception as exc:
            logger.warning("_compute_dual_recording_for_rider: zwift streams: %s", exc)

    sticky_watts = analyze_sticky_watts(
        zwift_streams.get("time") or [],
        zwift_streams.get("watts") or [],
        sw_thresholds,
    )

    zwift_cp_curve: dict = {}
    if access_token:
        try:
            curve_data = get_zwift_service().get_best_power_curve_activity(
                access_token, str(zwift_activity_id)
            )
            points = (curve_data or {}).get("pointsWatts") or {}
            zwift_cp_curve = {f"w{dur}": pt.get("value", 0) for dur, pt in points.items()}
        except Exception as exc:
            logger.warning("_compute_dual_recording_for_rider: cp curve: %s", exc)

    matched_strava, resolved_strava_id, matching_debug = _match_strava_activity(
        user_doc_id,
        strava_activity_id,
        zwift_started_at,
        zwift_duration_sec,
        zwift_streams.get("time") or [],
        zwift_streams.get("watts") or [],
        event_start_iso,
    )
    if not matched_strava:
        candidate_count = len((matching_debug or {}).get("candidates") or [])
        warning = (
            "No matching Strava activities found."
            if candidate_count > 0
            else "No Strava activities found."
        )
        return {
            "zwift": {
                "activityId": zwift_activity_id,
                "startedAt": zwift_started_at,
                "durationSec": zwift_duration_sec,
                "avgWatts": zwift_avg_watts,
                "cpCurve": zwift_cp_curve,
                "streams": zwift_streams or None,
                "stickyWatts": sticky_watts,
            },
            "strava": None,
            "sync": None,
            "comparison": None,
            "matchingDebug": matching_debug,
            "warning": warning,
        }

    raw_streams = strava_service.get_activity_streams(user_doc_id, resolved_strava_id)
    s_times = _extract_stream(raw_streams, "time")
    s_watts = _extract_stream(raw_streams, "watts")
    s_cadence = _extract_stream(raw_streams, "cadence")
    s_hr = _extract_stream(raw_streams, "heartrate")
    s_alt = _extract_stream(raw_streams, "altitude")

    strava_started_at = matched_strava.get("startDate", "")
    trimmed, strava_offset, sync_method, ts_offset = _trim_strava_streams(
        s_times, s_watts, s_cadence, s_hr, s_alt,
        zwift_streams.get("time") or [],
        zwift_streams.get("watts") or [],
        zwift_started_at,
        strava_started_at,
        zwift_duration_sec,
    )

    durations = (5, 15, 30, 60, 120, 300, 1200)

    strava_cp_raw = _compute_best_efforts(_resample_to_1hz(s_times, s_watts), durations)

    z_times_raw = zwift_streams.get("time") or []
    z_watts_raw = zwift_streams.get("watts") or []
    z_1hz_full = _resample_to_1hz(z_times_raw, z_watts_raw)
    zwift_stream_start_sec = int(z_times_raw[0]) if z_times_raw else 0
    zwift_stream_end_sec   = int(z_times_raw[-1]) if z_times_raw else 0

    trimmed_times = trimmed.get("time") or []
    strava_cover_start_sec = int(trimmed_times[0]) if trimmed_times else (zwift_duration_sec or 0)
    strava_cover_end_sec   = int(trimmed_times[-1]) if trimmed_times else 0
    strava_gap_sec = max(0, strava_cover_start_sec - zwift_stream_start_sec)
    zwift_stream_duration_sec = (
        int(z_times_raw[-1]) - zwift_stream_start_sec
    ) if z_times_raw else (zwift_duration_sec or 0)
    strava_gap_frac = strava_gap_sec / zwift_stream_duration_sec if zwift_stream_duration_sec else 0.0

    strava_end_gap_sec = max(0, zwift_stream_end_sec - strava_cover_end_sec)
    strava_end_gap_frac = strava_end_gap_sec / zwift_stream_duration_sec if zwift_stream_duration_sec else 0.0

    total_crop_frac = strava_gap_frac + strava_end_gap_frac
    crop_exceeds_limit = total_crop_frac > _STRAVA_CROP_MAX_FRACTION

    zwift_cropped_sec = 0
    zwift_end_cropped_sec = 0
    zwift_peak_windows: dict[str, tuple[int, int]] = {}
    if z_1hz_full:
        z_slice_start = strava_cover_start_sec if strava_gap_sec > 0 else 0
        z_slice_end = (strava_cover_end_sec + 1) if strava_end_gap_sec > 0 else len(z_1hz_full)
        z_1hz_for_comparison = z_1hz_full[z_slice_start:z_slice_end]
        if strava_gap_sec > 0:
            zwift_cropped_sec = strava_gap_sec
        if strava_end_gap_sec > 0:
            zwift_end_cropped_sec = strava_end_gap_sec
        zwift_cp_synced, zwift_peak_windows = _compute_best_efforts_with_windows(
            z_1hz_for_comparison, durations,
        )
    else:
        zwift_cp_synced = zwift_cp_curve
        z_1hz_for_comparison = []

    strava_1hz_raw = _resample_to_1hz(trimmed_times, trimmed.get("watts") or [])
    strava_1hz_for_comparison = (
        strava_1hz_raw[strava_cover_start_sec:] if strava_cover_start_sec > 0 else strava_1hz_raw
    )
    if zwift_peak_windows:
        strava_cp_synced = _compute_efforts_on_reference_windows(
            strava_1hz_for_comparison, zwift_peak_windows,
        )
    else:
        strava_cp_synced = _compute_best_efforts(strava_1hz_for_comparison, durations)
    strava_avg_synced = (
        round(sum(strava_1hz_for_comparison) / len(strava_1hz_for_comparison), 1)
        if strava_1hz_for_comparison else None
    )

    similarity_metrics = _compute_similarity_metrics(z_1hz_for_comparison, strava_1hz_for_comparison)
    avg_diff_w, avg_diff_pct = _compute_avg_power_diff(zwift_avg_watts, strava_avg_synced)

    return {
        "zwift": {
            "activityId": zwift_activity_id,
            "startedAt": zwift_started_at,
            "durationSec": zwift_duration_sec,
            "avgWatts": zwift_avg_watts,
            "cpCurve": zwift_cp_curve,
            "cpCurveSynced": zwift_cp_synced,
            "streams": zwift_streams or None,
            "stickyWatts": sticky_watts,
        },
        "strava": {
            "activityId": int(resolved_strava_id) if resolved_strava_id else None,
            "name": matched_strava.get("name", ""),
            "startedAt": strava_started_at,
            "durationSec": matched_strava.get("durationSec"),
            "avgWattsRaw": matched_strava.get("averageWatts"),
            "avgWattsSynced": strava_avg_synced,
            "cpCurveRaw": strava_cp_raw,
            "cpCurveSynced": strava_cp_synced,
            "streams": trimmed,
        },
        "sync": {
            "stravaOffsetSec": strava_offset,
            "zwiftDurationSec": zwift_duration_sec,
            "syncMethod": sync_method,
            "timestampOffsetSec": ts_offset,
            "zwiftStreamStartSec": zwift_stream_start_sec,
            "stravaStartGapSec": strava_gap_sec,
            "stravaGapFraction": round(strava_gap_frac, 3),
            "zwiftCroppedSec": zwift_cropped_sec,
            "stravaEndGapSec": strava_end_gap_sec,
            "stravaEndGapFraction": round(strava_end_gap_frac, 3),
            "zwiftEndCroppedSec": zwift_end_cropped_sec,
            "totalCropFraction": round(total_crop_frac, 3),
            "cropExceedsLimit": crop_exceeds_limit,
        },
        "comparison": {
            "cpDiff": _build_cp_comparison(zwift_cp_synced, strava_cp_synced),
            "avgPower": {
                "zwift": zwift_avg_watts,
                "strava": strava_avg_synced,
                "diffW": avg_diff_w,
                "diffPct": avg_diff_pct,
            },
            "similarity": similarity_metrics,
        },
        "matchingDebug": matching_debug,
    }
