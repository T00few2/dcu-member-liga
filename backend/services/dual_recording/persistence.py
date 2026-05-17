"""Firestore persistence helpers for DR/SW verification results."""
from __future__ import annotations

from datetime import datetime, timezone
import logging

from .storage import _store_dr_stream_blob
from .verdict import _check_dr_pass

logger = logging.getLogger(__name__)


def _is_dual_recording_required(db: object, user_doc_id: str) -> bool:
    """Return True if the rider's registered trainer requires dual recording."""
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


def _load_sw_thresholds(db: object) -> dict | None:
    """Read saved sticky-watts thresholds from Firestore admin settings."""
    try:
        snap = db.collection("league").document("adminSettings").get()
        if snap.exists:
            return (snap.to_dict() or {}).get("stickyWattsThresholds") or None
    except Exception as exc:
        logger.warning("_load_sw_thresholds: %s", exc)
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
    trainer_name: str | None = None
    try:
        user_doc = db.collection("users").document(zwift_id_canonical).get()
        if user_doc.exists:
            trainer_name = ((user_doc.to_dict() or {}).get("equipment") or {}).get("trainer") or None
    except Exception as exc:
        logger.warning("_persist_dr_verification_result: trainer lookup: %s", exc)
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

    if trainer_name:
        doc_payload["trainerName"] = trainer_name

    sticky_watts = (result.get("zwift") or {}).get("stickyWatts")
    if sticky_watts:
        doc_payload["stickyWatts"] = sticky_watts

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
