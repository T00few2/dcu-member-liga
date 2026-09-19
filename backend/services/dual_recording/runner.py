"""Background task runners for DR and SW-only verification."""
from __future__ import annotations

from datetime import datetime, timezone
import logging

from extensions import get_zwift_service
from services.zwift_tokens import get_valid_access_token

from .persistence import (  # noqa: F401
    _load_gw_thresholds,
    _load_sw_thresholds,
    _persist_dr_verification_result,
)
from .time_series import analyze_ghost_watts, analyze_sticky_watts
from .workflows import _compute_dual_recording_for_rider
from .zwift import _fetch_zwift_streams

logger = logging.getLogger(__name__)


def _run_dr_verification_background(
    db: object,
    user_doc_id: str,
    zwift_id_canonical: str,
    activity_id: str,
    race_id: str,
    event_start_iso: str | None,
    sw_thresholds: dict | None = None,
    gw_thresholds: dict | None = None,
) -> None:
    """Compute full DR comparison and persist to races/{race_id}/dr_verifications/{zwift_id}."""
    try:
        from services.dual_recording.scope import resolve_dr_source  # noqa: PLC0415

        result = _compute_dual_recording_for_rider(
            db, user_doc_id, activity_id, event_start_iso,
            sw_thresholds=sw_thresholds,
            gw_thresholds=gw_thresholds,
        )
        source = resolve_dr_source(db, zwift_id_canonical, race_id=race_id)
        doc_payload = _persist_dr_verification_result(
            db=db,
            result=result,
            zwift_id_canonical=zwift_id_canonical,
            activity_id=activity_id,
            race_id=race_id,
            source=source,
        )
        logger.info(
            "DR verification stored: race=%s rider=%s status=%s",
            race_id, zwift_id_canonical, doc_payload.get("status", "unknown"),
        )
    except Exception as exc:
        logger.error(
            "DR verification failed: race=%s rider=%s activity=%s: %s",
            race_id, zwift_id_canonical, activity_id, exc,
        )


def _run_sw_only_background(
    db: object,
    user_doc_id: str,
    zwift_id_canonical: str,
    activity_id: str,
    race_id: str,
    sw_thresholds: dict | None = None,
    gw_thresholds: dict | None = None,
) -> None:
    """Fetch Zwift stream, compute sticky + ghost watts, patch dr_verifications/{zwift_id}."""
    try:
        access_token = get_valid_access_token(user_doc_id, get_zwift_service())

        zwift_doc = db.collection("zwift_activities").document(str(activity_id)).get()
        zwift_raw: dict = {}
        fresh_activity: dict = {}
        if zwift_doc.exists:
            zwift_raw = (zwift_doc.to_dict() or {}).get("data") or {}
        elif access_token:
            fresh_activity = get_zwift_service().get_user_activity(str(activity_id), access_token) or {}
            zwift_raw = fresh_activity

        zwift_streams: dict = {}
        if access_token and zwift_raw:
            try:
                zwift_streams, _ = _fetch_zwift_streams(
                    zwift_raw, activity_id, access_token,
                    fresh_activity=fresh_activity or None,
                )
            except Exception as exc:
                logger.warning("_run_sw_only_background: streams: %s", exc)

        sticky_watts = analyze_sticky_watts(
            zwift_streams.get("time") or [],
            zwift_streams.get("watts") or [],
            sw_thresholds,
        )
        ghost_watts = analyze_ghost_watts(
            zwift_streams.get("time") or [],
            zwift_streams.get("watts") or [],
            zwift_streams.get("cadence") or [],
            gw_thresholds,
        )

        trainer_name: str | None = None
        try:
            user_doc = db.collection("users").document(user_doc_id).get()
            if user_doc.exists:
                trainer_name = ((user_doc.to_dict() or {}).get("equipment") or {}).get("trainer") or None
        except Exception as exc:
            logger.warning("_run_sw_only_background: trainer lookup: %s", exc)

        vref = (
            db.collection("races")
            .document(race_id)
            .collection("dr_verifications")
            .document(zwift_id_canonical)
        )
        existing = vref.get()
        existing_status = ((existing.to_dict() or {}).get("status") or "") if existing.exists else ""

        now_iso = datetime.now(timezone.utc).isoformat()
        sw_patch: dict = {
            "stickyWatts": sticky_watts,
            "swVerifiedAt": now_iso,
            "ghostWatts": ghost_watts,
            "gwVerifiedAt": now_iso,
        }
        if trainer_name:
            sw_patch["trainerName"] = trainer_name

        if existing_status and existing_status != "sw_only":
            # Preserve the existing DR document — only patch SW fields.
            vref.update(sw_patch)
        else:
            vref.set({
                "zwiftId": zwift_id_canonical,
                "raceId": race_id,
                "activityId": activity_id,
                "status": "sw_only",
                "verifiedAt": datetime.now(timezone.utc).isoformat(),
                **sw_patch,
            })
        logger.info(
            "SW/GW stored: race=%s rider=%s sw=%s gw=%s (prior_status=%r)",
            race_id, zwift_id_canonical,
            sticky_watts.get("suspicious"), ghost_watts.get("suspicious"),
            existing_status or "none",
        )
    except Exception as exc:
        logger.error(
            "SW-only failed: race=%s rider=%s activity=%s: %s",
            race_id, zwift_id_canonical, activity_id, exc,
        )
