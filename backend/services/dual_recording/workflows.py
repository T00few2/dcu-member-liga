from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import json
import logging
import os

import firebase_admin
from firebase_admin import storage
from extensions import get_zwift_service, strava_service
from services.zwift_tokens import get_valid_access_token

from .strava import _extract_stream, _match_strava_activity, _trim_strava_streams
from .time_series import _compute_avg_power_diff, _compute_best_efforts, _resample_to_1hz
from .verdict import _build_cp_comparison, _check_dr_pass, _compute_similarity_metrics
from .zwift import _extract_zwift_activity_fields, _fetch_zwift_streams

logger = logging.getLogger(__name__)

# Maximum fraction of the Zwift stream that may be cropped to align with a
# late-starting Strava recording.  Gaps within this limit are compensated by
# cropping the Zwift stream so both sides cover the same window before peak
# watts are computed.  Gaps exceeding the limit are flagged but still compared.
_STRAVA_CROP_MAX_FRACTION: float = 0.15


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
            "matchingDebug": matching_debug,
            "warning": "No matching Strava activity found with meaningful overlap in the race window.",
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

    # Raw Strava curve from full unaligned stream (unchanged behaviour)
    strava_cp_raw = _compute_best_efforts(_resample_to_1hz(s_times, s_watts), durations)

    # --- Gap detection ---
    trimmed_times = trimmed.get("time") or []
    strava_cover_start_sec = int(trimmed_times[0]) if trimmed_times else (zwift_duration_sec or 0)
    strava_gap_sec = max(0, strava_cover_start_sec)
    strava_gap_frac = strava_gap_sec / zwift_duration_sec if zwift_duration_sec else 0.0
    zwift_gap_exceeds_limit = strava_gap_sec > 0 and strava_gap_frac > _STRAVA_CROP_MAX_FRACTION

    # --- Zwift: compute peak watts from stream, not Zwift API ---
    z_times_raw = zwift_streams.get("time") or []
    z_watts_raw = zwift_streams.get("watts") or []
    z_1hz_full = _resample_to_1hz(z_times_raw, z_watts_raw)

    zwift_cropped_sec = 0
    if z_1hz_full:
        if strava_gap_sec > 0 and not zwift_gap_exceeds_limit:
            z_1hz_for_comparison = z_1hz_full[strava_cover_start_sec:]
            zwift_cropped_sec = strava_gap_sec
        else:
            z_1hz_for_comparison = z_1hz_full
        zwift_cp_synced = _compute_best_efforts(z_1hz_for_comparison, durations)
    else:
        # No stream available: fall back to Zwift API curve values
        zwift_cp_synced = zwift_cp_curve
        z_1hz_for_comparison = []

    # --- Strava: slice to actual coverage to avoid backward extrapolation ---
    strava_1hz_raw = _resample_to_1hz(trimmed_times, trimmed.get("watts") or [])
    strava_1hz_for_comparison = (
        strava_1hz_raw[strava_cover_start_sec:] if strava_cover_start_sec > 0 else strava_1hz_raw
    )
    strava_cp_synced = _compute_best_efforts(strava_1hz_for_comparison, durations)
    strava_avg_synced = (
        round(sum(strava_1hz_for_comparison) / len(strava_1hz_for_comparison), 1)
        if strava_1hz_for_comparison else None
    )

    # Similarity over the common (cropped) window
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
            "stravaStartGapSec": strava_gap_sec,
            "stravaGapFraction": round(strava_gap_frac, 3),
            "zwiftCroppedSec": zwift_cropped_sec,
            "zwiftGapExceedsLimit": zwift_gap_exceeds_limit,
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


def _resolve_storage_bucket():
    bucket_name = (
        os.getenv("FIREBASE_STORAGE_BUCKET")
        or os.getenv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET")
        or ""
    ).strip()
    if bucket_name:
        return storage.bucket(bucket_name)

    # Fallback: derive common Firebase bucket names from project id.
    project_id = ""
    try:
        project_id = str(firebase_admin.get_app().project_id or "").strip()
    except Exception:
        project_id = ""

    if project_id:
        candidates = (
            f"{project_id}.firebasestorage.app",
            f"{project_id}.appspot.com",
        )
        for candidate in candidates:
            try:
                bucket = storage.bucket(candidate)
                # Validate candidate once here; otherwise first upload fails later.
                bucket.exists()
                return bucket
            except Exception:
                continue

    raise RuntimeError(
        "Storage bucket name not configured. Set FIREBASE_STORAGE_BUCKET "
        "(or NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET) in backend runtime."
    )


def _stream_blob_payload(
    race_id: str,
    zwift_id_canonical: str,
    activity_id: str,
    result: dict,
) -> dict:
    return {
        "schemaVersion": 1,
        "capturedAt": datetime.now(timezone.utc).isoformat(),
        "raceId": race_id,
        "zwiftId": zwift_id_canonical,
        "activityId": activity_id,
        "result": result,
    }


def _store_dr_stream_blob(
    race_id: str,
    zwift_id_canonical: str,
    activity_id: str,
    result: dict,
) -> dict | None:
    try:
        payload = _stream_blob_payload(race_id, zwift_id_canonical, activity_id, result)
        payload_json = json.dumps(payload, separators=(",", ":"), ensure_ascii=True)
        payload_bytes = payload_json.encode("utf-8")
        gz_bytes = gzip.compress(payload_bytes, compresslevel=6)
        digest = hashlib.sha256(payload_bytes).hexdigest()

        verified_at = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        blob_path = (
            f"dr-streams/{race_id}/{zwift_id_canonical}/"
            f"{activity_id}-{verified_at}.json.gz"
        )
        bucket = _resolve_storage_bucket()
        blob = bucket.blob(blob_path)
        blob.cache_control = "private, max-age=3600"
        blob.metadata = {
            "raceId": race_id,
            "zwiftId": zwift_id_canonical,
            "activityId": str(activity_id),
            "sha256": digest,
            "schemaVersion": "1",
        }
        blob.upload_from_string(gz_bytes, content_type="application/json")
        blob.content_encoding = "gzip"
        blob.patch()

        return {
            "streamBlobPath": blob_path,
            "streamBytes": len(gz_bytes),
            "streamHash": digest,
            "streamStoredAt": datetime.now(timezone.utc).isoformat(),
            "streamSchemaVersion": 1,
        }
    except Exception as exc:
        logger.warning(
            "Failed to store DR stream blob (race=%s rider=%s activity=%s): %s",
            race_id,
            zwift_id_canonical,
            activity_id,
            exc,
        )
        return None


def _load_dr_stream_blob_result(stream_blob_path: str) -> dict | None:
    try:
        bucket = _resolve_storage_bucket()
        blob = bucket.blob(str(stream_blob_path))
        if not blob.exists():
            return None
        raw = blob.download_as_bytes()
        if str(stream_blob_path).lower().endswith(".gz") or blob.content_encoding == "gzip":
            # Some storage client paths can already return decoded bytes for
            # gzip-encoded objects; tolerate both encoded and decoded payloads.
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass
        payload = json.loads(raw.decode("utf-8"))
        if not isinstance(payload, dict):
            return None
        result = payload.get("result")
        return result if isinstance(result, dict) else None
    except Exception as exc:
        logger.warning("Failed to load DR stream blob %s: %s", stream_blob_path, exc)
        return None


def _persist_dr_verification_result(
    db: object,
    *,
    result: dict,
    zwift_id_canonical: str,
    activity_id: str,
    race_id: str,
) -> dict:
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
            "similarity": (comparison or {}).get("similarity") or {},
        },
    }
    if passed is not None:
        doc_payload["passed"] = passed
    if strava_id is not None:
        doc_payload["stravaActivityId"] = strava_id

    stream_meta = _store_dr_stream_blob(
        race_id=race_id,
        zwift_id_canonical=zwift_id_canonical,
        activity_id=activity_id,
        result=result,
    )
    if stream_meta:
        doc_payload.update(stream_meta)

    (
        db.collection("races")
        .document(race_id)
        .collection("dr_verifications")
        .document(zwift_id_canonical)
        .set(doc_payload)
    )
    return doc_payload


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
        doc_payload = _persist_dr_verification_result(
            db=db,
            result=result,
            zwift_id_canonical=zwift_id_canonical,
            activity_id=activity_id,
            race_id=race_id,
        )
        status = doc_payload.get("status", "unknown")
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

