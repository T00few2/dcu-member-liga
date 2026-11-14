"""Rider preference and file upload for dual recording."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import logging
import threading

from flask import jsonify, request

from authz import AuthzError, verify_user_token
from extensions import db
from routes.users import users_bp
from services.dual_recording.scope import is_dr_candidate
from services.dual_recording.submitted import (
    SubmittedRecordingError,
    activity_id_on_race,
    normalize_method,
    parse_fit_bytes,
    race_slot_start,
    rider_category,
    samples_to_streams,
    store_submitted_recording,
    summarize_streams,
    upload_allowed,
)
from services.request_models import DualRecordingMethodRequest, parse_body
from services.schema_validation import log_schema_issues, validate_user_doc, with_schema_version
from services.user_service import UserService

logger = logging.getLogger(__name__)

_SIGNUP_OK = {"registered", "pending"}
_LIST_BACK = timedelta(days=21)
_LIST_FORWARD = timedelta(days=2)


def _user_or_error():
    try:
        decoded = verify_user_token(request)
    except AuthzError as exc:
        return None, (jsonify({"message": exc.message}), exc.status_code)
    if not db:
        return None, (jsonify({"message": "Database not available"}), 500)
    user = UserService.get_user_by_auth_uid(decoded["uid"])
    if not user or not user.is_registered:
        return None, (jsonify({"message": "User not registered"}), 403)
    return user, None


def _require_candidate(user) -> tuple[dict, str] | tuple[None, tuple]:
    data = user._data or {}
    category = rider_category(data)
    included, _source = is_dr_candidate(
        db,
        str(user.zwift_id or user.id),
        category=category,
        user_data=data,
    )
    if not included:
        return None, (jsonify({"message": "Dual recording er ikke slået til for dig."}), 403)
    return data, None


def _race_and_signup(zwift_id: str, race_id: str) -> tuple[dict, str]:
    race_snap = db.collection("races").document(str(race_id)).get()
    if not race_snap.exists:
        raise SubmittedRecordingError("Løbet blev ikke fundet", 404)
    signup = (
        db.collection("races")
        .document(str(race_id))
        .collection("signups")
        .document(str(zwift_id))
        .get()
    )
    status = ((signup.to_dict() or {}).get("status") if signup.exists else "") or ""
    if status not in _SIGNUP_OK:
        raise SubmittedRecordingError("Du er ikke tilmeldt løbet", 403)
    return race_snap.to_dict() or {}, str(zwift_id)


def _verification_status(race_id: str, zwift_id: str) -> str | None:
    snap = (
        db.collection("races")
        .document(str(race_id))
        .collection("dr_verifications")
        .document(str(zwift_id))
        .get()
    )
    if not snap.exists:
        return None
    return str((snap.to_dict() or {}).get("status") or "") or None


def _queue_comparison(user, race_id: str, race_data: dict, zwift_id: str) -> str:
    activity_id = activity_id_on_race(race_data, zwift_id)
    if not activity_id:
        return "awaiting_results"
    from services.dual_recording.runner import _run_dr_verification_background

    start = race_slot_start(race_data, rider_category(user._data or {}))
    threading.Thread(
        target=_run_dr_verification_background,
        kwargs={
            "db": db,
            "user_doc_id": str(user.id),
            "zwift_id_canonical": zwift_id,
            "activity_id": activity_id,
            "race_id": str(race_id),
            "event_start_iso": start.isoformat() if start else None,
        },
        daemon=True,
    ).start()
    return "comparing"


@users_bp.route("/profile/dual-recording-method", methods=["POST"])
def set_dual_recording_method():
    user, err = _user_or_error()
    if err:
        return err
    _data, err = _require_candidate(user)
    if err:
        return err
    body, parse_err = parse_body(DualRecordingMethodRequest, request.get_json(silent=True) or {})
    if parse_err:
        return parse_err
    payload = with_schema_version({"dualRecordingMethod": body.method})
    log_schema_issues(logger, f"users/{user.id} (dual-recording-method)", validate_user_doc(payload, partial=True))
    db.collection("users").document(str(user.id)).set(payload, merge=True)
    return jsonify({"ok": True, "dualRecordingMethod": body.method}), 200


@users_bp.route("/profile/dual-recording-files", methods=["GET"])
def list_dual_recording_files():
    user, err = _user_or_error()
    if err:
        return err
    data, err = _require_candidate(user)
    if err:
        return err
    zwift_id = str(user.zwift_id or user.id)
    method = normalize_method((data or {}).get("dualRecordingMethod"))
    now = datetime.now(timezone.utc)
    category = rider_category(data)
    rows: list[dict] = []
    try:
        signups = db.collection_group("signups").where("zwiftId", "==", zwift_id).stream()
    except Exception as exc:
        logger.warning("dual recording file list: %s", exc)
        signups = []
    seen: set[str] = set()
    for signup in signups:
        signup_data = signup.to_dict() or {}
        if str(signup_data.get("status") or "") not in _SIGNUP_OK:
            continue
        race_id = str(signup_data.get("raceId") or "")
        if not race_id:
            parts = [part for part in str(getattr(signup.reference, "path", "")).split("/") if part]
            if len(parts) >= 2 and parts[0] == "races":
                race_id = parts[1]
        if not race_id or race_id in seen:
            continue
        seen.add(race_id)
        race_snap = db.collection("races").document(race_id).get()
        if not race_snap.exists:
            continue
        race_data = race_snap.to_dict() or {}
        start = race_slot_start(race_data, category)
        if start is None:
            continue
        recording_snap = (
            db.collection("races").document(race_id).collection("dual_recordings").document(zwift_id).get()
        )
        recording = recording_snap.to_dict() if recording_snap.exists else None
        ver_status = _verification_status(race_id, zwift_id)
        has_file = recording is not None
        offer = upload_allowed(kind="upload", start=start, now=now, verification_status=ver_status) and (
            ver_status in {"missing_strava", "failed", "awaiting_file"}
            or (method in {"direct", "upload"} and not has_file)
            or has_file
        )
        recent = now - _LIST_BACK <= start <= now + _LIST_FORWARD
        failed = ver_status in {"missing_strava", "failed", "awaiting_file"}
        if not recent and not failed:
            continue
        if not offer and not has_file:
            continue
        rows.append({
            "raceId": race_id,
            "raceName": race_data.get("name") or race_id,
            "startTime": start.isoformat(),
            "offerUpload": bool(offer),
            "verificationStatus": ver_status,
            "recording": None if not recording else {
                "source": recording.get("source"),
                "status": recording.get("status"),
                "avgPower": recording.get("avgPower"),
                "avgCadence": recording.get("avgCadence"),
                "avgHr": recording.get("avgHr"),
                "powerCoveragePct": recording.get("powerCoveragePct"),
                "durationSec": recording.get("durationSec"),
                "uploadedAt": recording.get("uploadedAt"),
            },
        })
    rows.sort(key=lambda row: row.get("startTime") or "", reverse=True)
    return jsonify({"method": method, "rows": rows}), 200


def _accept_streams(user, race_id: str, source: str, streams: dict, devices: dict | None):
    data, err = _require_candidate(user)
    if err:
        return err
    zwift_id = str(user.zwift_id or user.id)
    try:
        race_data, zwift_id = _race_and_signup(zwift_id, race_id)
        start = race_slot_start(race_data, rider_category(data))
        ver_status = _verification_status(race_id, zwift_id)
        if not upload_allowed(
            kind=source,
            start=start,
            now=datetime.now(timezone.utc),
            verification_status=ver_status,
        ):
            raise SubmittedRecordingError("Det er ikke tid til at sende en fil til det løb")
        summary = summarize_streams(streams)
        store_submitted_recording(
            db,
            race_id=str(race_id),
            zwift_id=zwift_id,
            source=source,
            streams=streams,
            devices=devices,
        )
        state = _queue_comparison(user, str(race_id), race_data, zwift_id)
    except SubmittedRecordingError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    return jsonify({"ok": True, "status": state, "source": source, "summary": summary}), 200


@users_bp.route("/profile/races/<race_id>/dual-recording", methods=["POST"])
def upload_direct_recording(race_id: str):
    user, err = _user_or_error()
    if err:
        return err
    body = request.get_json(silent=True) or {}
    devices = body.get("devices") if isinstance(body.get("devices"), dict) else {}
    try:
        streams = samples_to_streams(body.get("samples") or [])
    except SubmittedRecordingError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    return _accept_streams(user, race_id, "direct", streams, devices)


@users_bp.route("/profile/races/<race_id>/dual-recording/fit", methods=["POST"])
def upload_fit_recording(race_id: str):
    user, err = _user_or_error()
    if err:
        return err
    upload = request.files.get("file")
    if upload is None:
        return jsonify({"message": "Vælg en FIT-fil"}), 400
    try:
        streams = parse_fit_bytes(upload.read())
    except SubmittedRecordingError as exc:
        return jsonify({"message": exc.message}), exc.status_code
    preview = str(request.args.get("commit") or "1") == "0"
    if preview:
        return jsonify({"ok": True, "preview": True, "summary": summarize_streams(streams)}), 200
    return _accept_streams(user, race_id, "upload", streams, None)
