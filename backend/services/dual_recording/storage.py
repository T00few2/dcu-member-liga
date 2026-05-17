"""Firebase Storage helpers for DR stream blobs."""
from __future__ import annotations

from datetime import datetime, timezone
import gzip
import hashlib
import json
import logging
import os

import firebase_admin
from firebase_admin import storage

logger = logging.getLogger(__name__)


def _resolve_storage_bucket():
    bucket_name = (
        os.getenv("FIREBASE_STORAGE_BUCKET")
        or os.getenv("NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET")
        or ""
    ).strip()
    if bucket_name:
        return storage.bucket(bucket_name)

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
            race_id, zwift_id_canonical, activity_id, exc,
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
