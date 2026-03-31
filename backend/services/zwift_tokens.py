from __future__ import annotations

import time
from typing import Any

from firebase_admin import firestore

from extensions import db
from services.zwift import ZwiftService


TOKEN_COLLECTION = "zwift_tokens"


def resolve_user_doc_id_from_auth_uid(auth_uid: str) -> str | None:
    if not db:
        return None

    mapping_doc = db.collection("auth_mappings").document(auth_uid).get()
    if mapping_doc.exists:
        mapping = mapping_doc.to_dict() or {}
        mapped_zwift_id = mapping.get("zwiftId")
        if mapped_zwift_id:
            return str(mapped_zwift_id)

    docs = db.collection("users").where("authUid", "==", auth_uid).limit(1).stream()
    for doc in docs:
        return doc.id
    return auth_uid


def get_token_doc(user_doc_id: str) -> dict[str, Any] | None:
    if not db or not user_doc_id:
        return None
    snap = db.collection(TOKEN_COLLECTION).document(str(user_doc_id)).get()
    if not snap.exists:
        return None
    return snap.to_dict() or {}


def save_token_doc(user_doc_id: str, token_payload: dict[str, Any]) -> None:
    if not db:
        return
    db.collection(TOKEN_COLLECTION).document(str(user_doc_id)).set(token_payload, merge=True)


def delete_token_doc(user_doc_id: str) -> None:
    if not db:
        return
    db.collection(TOKEN_COLLECTION).document(str(user_doc_id)).delete()


def upsert_from_token_response(
    user_doc_id: str,
    token_data: dict[str, Any],
    *,
    scopes: str | None = None,
    zwift_user_id: str | None = None,
) -> None:
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = int(token_data.get("expires_in", 1800))
    now = int(time.time())
    payload = {
        "access_token": access_token,
        "refresh_token": refresh_token,
        "expires_at": now + expires_in,
        "scope": scopes or token_data.get("scope"),
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    if zwift_user_id:
        payload["zwiftUserId"] = zwift_user_id
    save_token_doc(user_doc_id, payload)


def get_valid_access_token(user_doc_id: str, zwift_service: ZwiftService) -> str | None:
    token_doc = get_token_doc(user_doc_id)
    if not token_doc:
        return None

    access_token = token_doc.get("access_token")
    refresh_token = token_doc.get("refresh_token")
    expires_at = int(token_doc.get("expires_at", 0) or 0)
    now = int(time.time())

    if access_token and expires_at > now + 60:
        return access_token

    if not refresh_token:
        return None

    status, refreshed = zwift_service.refresh_user_token(refresh_token)
    if status != 200:
        return None

    upsert_from_token_response(
        user_doc_id,
        refreshed,
        scopes=refreshed.get("scope") or token_doc.get("scope"),
        zwift_user_id=token_doc.get("zwiftUserId"),
    )
    return refreshed.get("access_token")
