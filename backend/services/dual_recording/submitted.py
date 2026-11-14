"""Direct and FIT dual recordings supplied by the rider."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
import gzip
import hashlib
import io
import json
import logging

from services.dual_recording.time_series import _parse_event_start_iso

logger = logging.getLogger(__name__)

METHODS = ("direct", "strava", "upload")
DIRECT_LEAD = timedelta(hours=48)
DIRECT_TAIL = timedelta(hours=18)
FIT_TAIL = timedelta(days=14)
MAX_SAMPLES = 30_000
_REPLACE_STATUSES = {"missing_strava", "failed", "awaiting_file"}


class SubmittedRecordingError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_method(value: object) -> str:
    method = str(value or "").strip()
    if method in METHODS:
        return method
    return "strava"


def rider_category(user_data: dict | None) -> str | None:
    raw = (user_data or {}).get("ligaCategory")
    if isinstance(raw, dict):
        raw = raw.get("category") or raw.get("name")
    text = str(raw or "").strip()
    return text or None


def race_slot_start(race_data: dict | None, category: str | None) -> datetime | None:
    data = race_data or {}
    wanted = str(category or "").strip().lower()
    if wanted:
        for cfg in data.get("eventConfiguration") or []:
            if not isinstance(cfg, dict):
                continue
            name = str(cfg.get("customCategory") or "").strip().lower()
            if name == wanted and cfg.get("startTime"):
                parsed = _parse_event_start_iso(str(cfg.get("startTime")))
                if parsed:
                    return parsed
        for group in data.get("raceGroups") or []:
            if not isinstance(group, dict):
                continue
            names = [
                str((cat or {}).get("category") or "").strip().lower()
                for cat in (group.get("categories") or [])
                if isinstance(cat, dict)
            ]
            if wanted in names and group.get("startTime"):
                parsed = _parse_event_start_iso(str(group.get("startTime")))
                if parsed:
                    return parsed
    return _parse_event_start_iso(str(data.get("date") or ""))


def upload_allowed(
    *,
    kind: str,
    start: datetime | None,
    now: datetime,
    verification_status: str | None,
) -> bool:
    """Direct files can be sent from 48h before the slot through the next morning.

    A FIT file can be sent once the race has started, for 14 days, and later
    when the check is missing, failed, or still waiting for a file.
    """
    if start is None:
        return False
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    status = str(verification_status or "")
    if kind == "direct":
        return start - DIRECT_LEAD <= now <= start + DIRECT_TAIL
    if kind == "upload":
        if status in _REPLACE_STATUSES and now >= start:
            return True
        return start <= now <= start + FIT_TAIL
    return False


def _num(value: object, low: float, high: float) -> float | None:
    if value is None or value == "":
        return None
    try:
        number = float(value)
    except (TypeError, ValueError) as exc:
        raise SubmittedRecordingError("Ugyldigt tal i optagelsen") from exc
    if number < low or number > high:
        raise SubmittedRecordingError("En måling ligger uden for det tilladte interval")
    return number


def samples_to_streams(samples: list) -> dict:
    """Turn rider samples into elapsed-second streams. Power and heart rate are required."""
    if not isinstance(samples, list) or not samples:
        raise SubmittedRecordingError("Optagelsen er tom")
    if len(samples) > MAX_SAMPLES:
        raise SubmittedRecordingError("Optagelsen er for lang")

    rows: list[tuple[int, float | None, float | None, float | None, float | None]] = []
    for sample in samples:
        if not isinstance(sample, dict):
            raise SubmittedRecordingError("Ugyldig måling")
        try:
            stamp = int(sample.get("t"))
        except (TypeError, ValueError) as exc:
            raise SubmittedRecordingError("Optagelsen mangler tidspunkter") from exc
        rows.append((
            stamp,
            _num(sample.get("watts"), 0, 2500),
            _num(sample.get("cadence"), 0, 250),
            _num(sample.get("hr"), 0, 250),
            _num(sample.get("trainerWatts"), 0, 2500),
        ))
    rows.sort(key=lambda row: row[0])
    origin = rows[0][0]
    times: list[int] = []
    watts: list[float | None] = []
    cadence: list[float | None] = []
    heart: list[float | None] = []
    trainer: list[float | None] = []
    previous = -1
    for stamp, watt, cad, hr, trainer_watt in rows:
        elapsed = int((stamp - origin) / 1000)
        if elapsed < previous:
            raise SubmittedRecordingError("Tidspunkterne går baglæns")
        previous = elapsed
        times.append(elapsed)
        watts.append(watt)
        cadence.append(cad)
        heart.append(hr)
        trainer.append(trainer_watt)
    if not any(value is not None for value in watts):
        raise SubmittedRecordingError("Optagelsen mangler watt")
    if not any(value is not None for value in heart):
        raise SubmittedRecordingError("Optagelsen mangler puls")
    started = datetime.fromtimestamp(origin / 1000, tz=timezone.utc)
    return {
        "startedAt": started.isoformat(),
        "time": times,
        "watts": watts,
        "cadence": cadence,
        "heartrate": heart,
        "trainerWatts": trainer,
    }


def _mean(values: list) -> float | None:
    present = [float(value) for value in values if value is not None]
    if not present:
        return None
    return round(sum(present) / len(present), 1)


def summarize_streams(streams: dict) -> dict:
    times = streams.get("time") or []
    watts = streams.get("watts") or []
    duration = int(times[-1] - times[0]) if len(times) >= 2 else (int(times[-1]) if times else 0)
    duration = max(duration, 0)
    covered = 0
    previous_t = None
    previous_w = None
    for stamp, watt in zip(times, watts):
        if previous_t is not None and previous_w is not None:
            covered += max(0, int(stamp) - int(previous_t))
        previous_t = stamp
        previous_w = watt
    span = duration or (1 if watts else 0)
    coverage = round(100 * min(covered, span) / span, 1) if span else 0.0
    trainer_watts = streams.get("trainerWatts") or []
    return {
        "durationSec": duration,
        "avgPower": _mean(watts),
        "avgCadence": _mean(streams.get("cadence") or []),
        "avgHr": _mean(streams.get("heartrate") or []),
        "powerCoveragePct": coverage,
        "trainerAvgWatts": _mean(trainer_watts),
        "sampleCount": len(times),
    }


def _fit_field(frame: object, name: str):
    try:
        if hasattr(frame, "has_field") and frame.has_field(name):
            return frame.get_value(name)
    except Exception:
        return None
    return None


def parse_fit_bytes(raw: bytes) -> dict:
    try:
        import fitdecode
    except ImportError as exc:
        raise SubmittedRecordingError("FIT-filer kan ikke læses på serveren", 500) from exc
    if not raw:
        raise SubmittedRecordingError("Filen er tom")
    samples: list[dict] = []
    try:
        with fitdecode.FitReader(io.BytesIO(raw)) as fit:
            for frame in fit:
                if not isinstance(frame, fitdecode.FitDataMessage) or frame.name != "record":
                    continue
                ts = _fit_field(frame, "timestamp")
                if ts is None:
                    continue
                try:
                    epoch_ms = int(ts.timestamp() * 1000)
                except AttributeError:
                    epoch_ms = int(float(ts) * 1000)
                samples.append({
                    "t": epoch_ms,
                    "watts": _fit_field(frame, "power"),
                    "cadence": _fit_field(frame, "cadence"),
                    "hr": _fit_field(frame, "heart_rate"),
                })
    except SubmittedRecordingError:
        raise
    except Exception as exc:
        raise SubmittedRecordingError("FIT-filen kunne ikke læses") from exc
    return samples_to_streams(samples)


def _clean_name(value: object) -> str | None:
    text = str(value or "").strip()
    if not text:
        return None
    return text[:80]


def recording_method(db: object, user_doc_id: str) -> str:
    try:
        snap = db.collection("users").document(str(user_doc_id)).get()
        data = snap.to_dict() if getattr(snap, "exists", False) else {}
    except Exception as exc:
        logger.warning("recording_method(%s): %s", user_doc_id, exc)
        data = {}
    return normalize_method((data or {}).get("dualRecordingMethod"))


def _blob_path(race_id: str, zwift_id: str) -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return f"dual-recordings/{race_id}/{zwift_id}/{stamp}.json.gz"


def store_submitted_recording(
    db: object,
    *,
    race_id: str,
    zwift_id: str,
    source: str,
    streams: dict,
    devices: dict | None = None,
) -> dict:
    summary = summarize_streams(streams)
    payload = {
        "schemaVersion": 1,
        "source": source,
        "raceId": race_id,
        "zwiftId": zwift_id,
        "startedAt": streams.get("startedAt"),
        "streams": {
            "time": streams.get("time") or [],
            "watts": streams.get("watts") or [],
            "cadence": streams.get("cadence") or [],
            "heartrate": streams.get("heartrate") or [],
            "trainerWatts": streams.get("trainerWatts") or [],
        },
        "devices": devices or {},
        "summary": summary,
    }
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    gz_bytes = gzip.compress(raw, compresslevel=6)
    digest = hashlib.sha256(raw).hexdigest()
    path = _blob_path(race_id, zwift_id)
    from services.dual_recording.storage import _resolve_storage_bucket

    bucket = _resolve_storage_bucket()
    blob = bucket.blob(path)
    blob.cache_control = "private, max-age=3600"
    blob.metadata = {
        "raceId": race_id,
        "zwiftId": zwift_id,
        "source": source,
        "sha256": digest,
    }
    blob.upload_from_string(gz_bytes, content_type="application/json")
    blob.content_encoding = "gzip"
    blob.patch()

    trainer_name = _clean_name((devices or {}).get("trainer"))
    trainer = None
    if summary.get("trainerAvgWatts") is not None:
        trainer = {"name": trainer_name, "avgWatts": summary["trainerAvgWatts"]}
    doc = {
        "raceId": race_id,
        "zwiftId": zwift_id,
        "source": source,
        "status": "awaiting_results",
        "startedAt": streams.get("startedAt"),
        "uploadedAt": datetime.now(timezone.utc).isoformat(),
        "durationSec": summary["durationSec"],
        "avgPower": summary["avgPower"],
        "avgCadence": summary["avgCadence"],
        "avgHr": summary["avgHr"],
        "powerCoveragePct": summary["powerCoveragePct"],
        "sampleCount": summary["sampleCount"],
        "devices": {
            "powerMeter": _clean_name((devices or {}).get("powerMeter")),
            "heartRate": _clean_name((devices or {}).get("heartRate")),
            "trainer": trainer_name,
        },
        "trainer": trainer,
        "streamBlobPath": path,
        "streamHash": digest,
    }
    (
        db.collection("races")
        .document(str(race_id))
        .collection("dual_recordings")
        .document(str(zwift_id))
        .set(doc)
    )
    return doc


def _read_blob(path: str) -> dict | None:
    from services.dual_recording.storage import _resolve_storage_bucket

    try:
        bucket = _resolve_storage_bucket()
        blob = bucket.blob(path)
        if not blob.exists():
            return None
        raw = blob.download_as_bytes()
        if path.endswith(".gz") or blob.content_encoding == "gzip":
            try:
                raw = gzip.decompress(raw)
            except Exception:
                pass
        payload = json.loads(raw.decode("utf-8"))
        return payload if isinstance(payload, dict) else None
    except Exception as exc:
        logger.warning("Failed to read dual recording %s: %s", path, exc)
        return None


def load_submitted_recording(db: object, race_id: str, user_doc_id: str) -> dict | None:
    """Return a stored rider file, or a broken marker when the blob cannot be read."""
    ids = [str(user_doc_id)]
    try:
        user = db.collection("users").document(str(user_doc_id)).get()
        if getattr(user, "exists", False):
            zwift_id = str((user.to_dict() or {}).get("zwiftId") or "").strip()
            if zwift_id and zwift_id not in ids:
                ids.append(zwift_id)
    except Exception as exc:
        logger.warning("load_submitted_recording user %s: %s", user_doc_id, exc)

    for zwift_id in ids:
        try:
            snap = (
                db.collection("races")
                .document(str(race_id))
                .collection("dual_recordings")
                .document(zwift_id)
                .get()
            )
        except Exception as exc:
            logger.warning("load_submitted_recording doc: %s", exc)
            continue
        if not getattr(snap, "exists", False):
            continue
        data = snap.to_dict() or {}
        path = str(data.get("streamBlobPath") or "")
        payload = _read_blob(path) if path else None
        streams = (payload or {}).get("streams") if isinstance(payload, dict) else None
        if not isinstance(streams, dict) or not streams.get("time"):
            return {
                "source": data.get("source") or "upload",
                "broken": True,
                "streams": None,
            }
        streams = dict(streams)
        streams["startedAt"] = data.get("startedAt") or (payload or {}).get("startedAt")
        return {
            "source": data.get("source") or "upload",
            "startedAt": streams.get("startedAt"),
            "durationSec": data.get("durationSec"),
            "avgPower": data.get("avgPower"),
            "streams": streams,
            "trainer": data.get("trainer"),
            "broken": False,
        }
    return None


def mark_recording_compared(db: object, race_id: str, zwift_id: str) -> None:
    try:
        (
            db.collection("races")
            .document(str(race_id))
            .collection("dual_recordings")
            .document(str(zwift_id))
            .update({"status": "compared"})
        )
    except Exception as exc:
        logger.warning("mark_recording_compared: %s", exc)


def activity_id_on_race(race_data: dict | None, zwift_id: str) -> str | None:
    results = (race_data or {}).get("results") or {}
    target = str(zwift_id)
    if not isinstance(results, dict):
        return None
    for riders in results.values():
        for rider in riders or []:
            if not isinstance(rider, dict):
                continue
            if str(rider.get("zwiftId") or "") == target and rider.get("activityId"):
                return str(rider.get("activityId"))
    return None
