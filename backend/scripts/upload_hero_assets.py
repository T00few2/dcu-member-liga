"""Upload compressed hero video/poster to Firebase Storage (public site assets)."""
from __future__ import annotations

import json
import os
import uuid
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen

import firebase_admin
from firebase_admin import credentials, storage

VIDEO_PATH = Path(os.path.expanduser(r"~\Downloads\hero-video.mp4"))
POSTER_PATH = Path(os.path.expanduser(r"~\Downloads\hero-video-poster.jpg"))
VIDEO_BLOB = "public/hero-video.mp4"
POSTER_BLOB = "public/hero-video-poster.jpg"
BUCKET_NAME = os.getenv(
    "FIREBASE_STORAGE_BUCKET",
    "dcu-member-liga-479507.firebasestorage.app",
)
CORS_ORIGINS = [
    "https://www.dansk-ecykling.dk",
    "https://dansk-ecykling.dk",
    "http://localhost:3000",
]


def _init() -> None:
    if firebase_admin._apps:
        return
    gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    local_sa = Path(__file__).resolve().parents[1] / "serviceAccountKey.json"
    if gac and Path(gac).exists():
        firebase_admin.initialize_app(
            credentials.Certificate(gac),
            {"storageBucket": BUCKET_NAME},
        )
    elif local_sa.exists():
        firebase_admin.initialize_app(
            credentials.Certificate(str(local_sa)),
            {"storageBucket": BUCKET_NAME},
        )
    else:
        firebase_admin.initialize_app(options={"storageBucket": BUCKET_NAME})


def _media_url(bucket_name: str, blob_path: str, token: str) -> str:
    encoded = quote(blob_path, safe="")
    return (
        f"https://firebasestorage.googleapis.com/v0/b/{bucket_name}/o/"
        f"{encoded}?alt=media&token={token}"
    )


def _upload(bucket, local_path: Path, blob_path: str, content_type: str) -> str:
    if not local_path.exists():
        raise FileNotFoundError(local_path)
    token = str(uuid.uuid4())
    blob = bucket.blob(blob_path)
    blob.cache_control = "public, max-age=31536000, immutable"
    blob.content_type = content_type
    blob.metadata = {"firebaseStorageDownloadTokens": token}
    blob.upload_from_filename(str(local_path), content_type=content_type)
    blob.patch()
    return _media_url(bucket.name, blob_path, token)


def _ensure_cors(bucket) -> None:
    existing = list(bucket.cors or [])
    origins = {o for rule in existing for o in (rule.get("origin") or [])}
    if all(origin in origins for origin in CORS_ORIGINS) and existing:
        return
    merged_origins = sorted(origins.union(CORS_ORIGINS))
    bucket.cors = [
        {
            "origin": merged_origins,
            "method": ["GET", "HEAD"],
            "responseHeader": [
                "Content-Type",
                "Content-Length",
                "Content-Range",
                "Accept-Ranges",
                "Range",
            ],
            "maxAgeSeconds": 3600,
        }
    ]
    bucket.patch()


def _head(url: str) -> tuple[int, str]:
    req = Request(url, method="HEAD")
    try:
        with urlopen(req, timeout=30) as resp:
            length = resp.headers.get("Content-Length", "")
            return resp.status, length
    except Exception as exc:
        return 0, str(exc)


def main() -> None:
    _init()
    bucket = storage.bucket(BUCKET_NAME)
    video_url = _upload(bucket, VIDEO_PATH, VIDEO_BLOB, "video/mp4")
    poster_url = _upload(bucket, POSTER_PATH, POSTER_BLOB, "image/jpeg")
    _ensure_cors(bucket)
    video_status, video_len = _head(video_url)
    poster_status, poster_len = _head(poster_url)
    print(json.dumps(
        {
            "bucket": bucket.name,
            "videoUrl": video_url,
            "posterUrl": poster_url,
            "videoHead": {"status": video_status, "contentLength": video_len},
            "posterHead": {"status": poster_status, "contentLength": poster_len},
        },
        indent=2,
    ))


if __name__ == "__main__":
    main()
