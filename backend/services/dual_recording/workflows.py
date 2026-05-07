from __future__ import annotations

from datetime import datetime, timezone
import logging

from extensions import get_zwift_service, strava_service
from services.zwift_tokens import get_valid_access_token

from .strava import _extract_stream, _match_strava_activity, _trim_strava_streams
from .time_series import _compute_avg_power_diff, _compute_best_efforts, _resample_to_1hz
from .verdict import _build_cp_comparison, _check_dr_pass
from .zwift import _extract_zwift_activity_fields, _fetch_zwift_streams

logger = logging.getLogger(__name__)


def _is_dual_recording_required(db: object, user_doc_id: str) -> bool:
    """Return True if rider's registered trainer requires dual recording."""
    try:
        user_doc = db.collection("users").document(user_doc_id).get()
        if not user_doc.exists:
            return False
        user_data = user_doc.to_dict() or {}
        trainer_name = (user_data.get("equipment") or {}).get("trainer")
        if not trainer_name:
            return False
        trainer_name_lower = " ".join(trainer_name.strip().lower().split())
        for doc in db.collection("trainers").stream():
            td = doc.to_dict() or {}
            norm = td.get("normalizedName") or " ".join(
                (td.get("name") or "").strip().lower().split()
            )
            if norm == trainer_name_lower:
                return bool(td.get("dualRecordingRequired"))
    except Exception as exc:
        logger.warning("_is_dual_recording_required(%s): %s", user_doc_id, exc)
    return False


def _compute_dual_recording_for_rider(
    db: object,
    user_doc_id: str,
    zwift_activity_id: str,
    event_start_iso: str | None = None,
    strava_activity_id: str | None = None,
) -> dict:
    """Run the dual-recording comparison for one rider/activity."""
    access_token = get_valid_access_token(user_doc_id, get_zwift_service())

    zwift_doc = db.collection("zwift_activities").document(str(zwift_activity_id)).get()
    zwift_raw: dict = {}
    if zwift_doc.exists:
        zwift_raw = (zwift_doc.to_dict() or {}).get("data") or {}
    elif access_token:
        zwift_raw = get_zwift_service().get_user_activity(str(zwift_activity_id), access_token) or {}
    if not zwift_raw:
        raise ValueError(f"Zwift activity {zwift_activity_id} not found")

    zf = _extract_zwift_activity_fields(zwift_raw)
    zwift_started_at = zf["startedAt"]
    zwift_duration_sec = zf["durationSec"]
    zwift_avg_watts = zf["avgWatts"]

    zwift_streams: dict = {}
    if access_token:
        try:
            zwift_streams, _ = _fetch_zwift_streams(zwift_raw, zwift_activity_id, access_token)
        except Exception as exc:
            logger.warning("_compute_dual_recording_for_rider: zwift streams: %s", exc)

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

    matched_strava, resolved_strava_id = _match_strava_activity(
        user_doc_id, strava_activity_id, zwift_started_at, event_start_iso
    )
    if not matched_strava:
        return {
            "zwift": {
                "activityId": zwift_activity_id,
                "startedAt": zwift_started_at,
                "durationSec": zwift_duration_sec,
                "avgWatts": zwift_avg_watts,
                "cpCurve": zwift_cp_curve,
                "streams": zwift_streams or None,
            },
            "strava": None,
            "sync": None,
            "comparison": None,
            "warning": "No matching Strava activity found within 4 hours of the Zwift activity.",
        }

    raw_streams = strava_service.get_activity_streams(user_doc_id, resolved_strava_id)
    s_times = _extract_stream(raw_streams, "time")
    s_watts = _extract_stream(raw_streams, "watts")
    s_cadence = _extract_stream(raw_streams, "cadence")
    s_hr = _extract_stream(raw_streams, "heartrate")
    s_alt = _extract_stream(raw_streams, "altitude")

    strava_started_at = matched_strava.get("startDate", "")
    trimmed, strava_offset, sync_method, ts_offset = _trim_strava_streams(
        s_times,
        s_watts,
        s_cadence,
        s_hr,
        s_alt,
        zwift_streams.get("time") or [],
        zwift_streams.get("watts") or [],
        zwift_started_at,
        strava_started_at,
        zwift_duration_sec,
    )

    durations = (5, 15, 30, 60, 120, 300, 1200)
    strava_cp_raw = _compute_best_efforts(_resample_to_1hz(s_times, s_watts), durations)
    strava_cp_synced = _compute_best_efforts(
        _resample_to_1hz(trimmed["time"], trimmed["watts"]), durations
    )
    synced_1hz = _resample_to_1hz(trimmed["time"], trimmed["watts"])
    strava_avg_synced = round(sum(synced_1hz) / len(synced_1hz), 1) if synced_1hz else None

    avg_diff_w, avg_diff_pct = _compute_avg_power_diff(zwift_avg_watts, strava_avg_synced)

    return {
        "zwift": {
            "activityId": zwift_activity_id,
            "startedAt": zwift_started_at,
            "durationSec": zwift_duration_sec,
            "avgWatts": zwift_avg_watts,
            "cpCurve": zwift_cp_curve,
            "streams": zwift_streams or None,
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
        },
        "comparison": {
            "cpDiff": _build_cp_comparison(zwift_cp_curve, strava_cp_synced),
            "avgPower": {
                "zwift": zwift_avg_watts,
                "strava": strava_avg_synced,
                "diffW": avg_diff_w,
                "diffPct": avg_diff_pct,
            },
        },
    }


def _run_dr_verification_background(
    db: object,
    user_doc_id: str,
    zwift_id_canonical: str,
    activity_id: str,
    race_id: str,
    event_start_iso: str | None,
) -> None:
    """Compute DR and persist result to races/{race_id}/dr_verifications/{zwift_id}."""
    try:
        result = _compute_dual_recording_for_rider(db, user_doc_id, activity_id, event_start_iso)
        comparison = result.get("comparison")
        strava_data = result.get("strava")

        if not strava_data:
            status = "missing_strava"
            passed = None
            failing: list[str] = []
        else:
            passed, failing = _check_dr_pass(comparison or {})
            status = "passed" if passed else "failed"

        strava_id = (strava_data or {}).get("activityId")
        doc_payload: dict = {
            "zwiftId": zwift_id_canonical,
            "raceId": race_id,
            "activityId": activity_id,
            "status": status,
            "verifiedAt": datetime.now(timezone.utc).isoformat(),
            "failingMetrics": failing,
            "comparison": {
                "cpDiff": (comparison or {}).get("cpDiff") or [],
                "avgPower": (comparison or {}).get("avgPower") or {},
            },
        }
        if passed is not None:
            doc_payload["passed"] = passed
        if strava_id is not None:
            doc_payload["stravaActivityId"] = strava_id

        (
            db.collection("races")
            .document(race_id)
            .collection("dr_verifications")
            .document(zwift_id_canonical)
            .set(doc_payload)
        )
        logger.info(
            "DR verification stored: race=%s rider=%s status=%s",
            race_id,
            zwift_id_canonical,
            status,
        )
    except Exception as exc:
        logger.error(
            "DR verification failed: race=%s rider=%s activity=%s: %s",
            race_id,
            zwift_id_canonical,
            activity_id,
            exc,
        )

