from __future__ import annotations

from typing import Any, Dict, List

from firebase_admin import firestore


POLICY_DATA_POLICY = "dataPolicy"
POLICY_PUBLIC_RESULTS = "publicResultsConsent"

KNOWN_POLICIES = [POLICY_DATA_POLICY, POLICY_PUBLIC_RESULTS]


class PolicyError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _policy_doc(db, policy_key: str):
    return db.collection("policies").document(policy_key)


def _version_doc(db, policy_key: str, version_id: str):
    return _policy_doc(db, policy_key).collection("versions").document(version_id)


def get_policy_meta(db) -> Dict[str, Dict[str, Any]]:
    """
    Returns authoritative meta for known policies:
      { policyKey: { displayVersion, requiredVersion } }
    """
    if not db:
        raise PolicyError("Database not available", 500)

    meta: Dict[str, Dict[str, Any]] = {}

    for key in KNOWN_POLICIES:
        doc = _policy_doc(db, key).get()
        if not doc.exists:
            raise PolicyError(f"Policy not configured: {key}", 500)

        data = doc.to_dict() or {}
        display_version = data.get("currentDisplayVersion")
        if not display_version:
            raise PolicyError(f"Policy missing currentDisplayVersion: {key}", 500)

        required_version = data.get("currentRequiredVersion") or display_version
        meta[key] = {"displayVersion": display_version, "requiredVersion": required_version}
    return meta


def get_current_policy(db, policy_key: str) -> Dict[str, Any]:
    """
    Returns the display policy document.
    """
    if not db:
        raise PolicyError("Database not available", 500)
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)

    meta = get_policy_meta(db)
    display_version = meta[policy_key]["displayVersion"]

    vdoc = _version_doc(db, policy_key, display_version).get()
    if not vdoc.exists:
        raise PolicyError(f"Policy version not found: {policy_key}@{display_version}", 404)

    data = vdoc.to_dict() or {}
    title = (data.get("titleDa") or "").strip()
    content = (data.get("contentMdDa") or "").strip()
    if not title or not content:
        raise PolicyError(f"Policy version is missing title/content: {policy_key}@{display_version}", 500)

    return {
        "policyKey": policy_key,
        "version": display_version,
        "titleDa": title,
        "contentMdDa": content,
        "requiresReaccept": bool(data.get("requiresReaccept", False)),
        "changeType": data.get("changeType") or ("major" if data.get("requiresReaccept") else "minor"),
        "status": data.get("status") or "published",
        "publishedAt": data.get("publishedAt"),
        "changeSummary": data.get("changeSummary") or "",
    }


def list_versions(db, policy_key: str) -> List[Dict[str, Any]]:
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)
    if not db:
        raise PolicyError("Database not available", 500)

    versions_ref = _policy_doc(db, policy_key).collection("versions")
    docs = versions_ref.order_by("createdAt", direction=firestore.Query.DESCENDING).stream()
    out: List[Dict[str, Any]] = []
    for d in docs:
        data = d.to_dict() or {}
        data["version"] = d.id
        out.append(data)
    return out


def _to_epoch_ms(value: Any) -> Any:
    """
    Convert Firestore timestamps / datetimes to epoch ms for JSON.
    Leaves other types unchanged.
    """
    try:
        # Firestore Timestamp often behaves like datetime with .timestamp()
        if hasattr(value, "timestamp"):
            return int(value.timestamp() * 1000)
    except Exception:
        pass
    return value


def serialize_policy_doc(doc: Dict[str, Any]) -> Dict[str, Any]:
    """
    Best-effort JSON-safe serialization for policy docs.
    """
    out: Dict[str, Any] = {}
    for k, v in (doc or {}).items():
        if isinstance(v, dict):
            out[k] = serialize_policy_doc(v)
        elif isinstance(v, list):
            out[k] = [serialize_policy_doc(x) if isinstance(x, dict) else _to_epoch_ms(x) for x in v]
        else:
            out[k] = _to_epoch_ms(v)
    return out


def upsert_draft(
    db,
    policy_key: str,
    version: str,
    *,
    title_da: str,
    content_md_da: str,
    change_type: str,
    requires_reaccept: bool,
    actor_uid: str,
) -> None:
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)
    if not db:
        raise PolicyError("Database not available", 500)
    if not version:
        raise PolicyError("Missing version", 400)
    if change_type not in ("minor", "major"):
        raise PolicyError("Invalid changeType", 400)

    doc_ref = _version_doc(db, policy_key, version)
    existing = doc_ref.get()
    if existing.exists:
        existing_data = existing.to_dict() or {}
        status = existing_data.get("status", "draft")
        if status != "draft":
            raise PolicyError("Cannot edit after submission/publish", 409)

    payload = {
        "titleDa": title_da,
        "contentMdDa": content_md_da,
        "changeType": change_type,
        "requiresReaccept": bool(requires_reaccept),
        "status": "draft",
        "createdByUid": actor_uid,
        "updatedAt": firestore.SERVER_TIMESTAMP,
    }
    if not existing.exists:
        payload["createdAt"] = firestore.SERVER_TIMESTAMP

    doc_ref.set(payload, merge=True)


def submit_for_review(db, policy_key: str, version: str, *, actor_uid: str) -> None:
    if not db:
        raise PolicyError("Database not available", 500)
    doc_ref = _version_doc(db, policy_key, version)
    snap = doc_ref.get()
    if not snap.exists:
        raise PolicyError("Version not found", 404)
    data = snap.to_dict() or {}
    if data.get("status") != "draft":
        raise PolicyError("Only drafts can be submitted", 409)

    doc_ref.set(
        {
            "status": "pending_review",
            "submittedAt": firestore.SERVER_TIMESTAMP,
            "submittedByUid": actor_uid,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def approve_version(db, policy_key: str, version: str, *, actor_uid: str) -> None:
    if not db:
        raise PolicyError("Database not available", 500)
    doc_ref = _version_doc(db, policy_key, version)
    snap = doc_ref.get()
    if not snap.exists:
        raise PolicyError("Version not found", 404)
    data = snap.to_dict() or {}
    if data.get("status") != "pending_review":
        raise PolicyError("Only pending_review versions can be approved", 409)

    created_by = data.get("createdByUid")
    if created_by and created_by == actor_uid:
        raise PolicyError("Four-eyes: author cannot approve own version", 403)

    doc_ref.set(
        {
            "status": "approved",
            "approvedAt": firestore.SERVER_TIMESTAMP,
            "approvedByUid": actor_uid,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )


def publish_version(
    db,
    policy_key: str,
    version: str,
    *,
    actor_uid: str,
    change_summary: str = "",
) -> Dict[str, Any]:
    """
    Publish a version and update policy meta.
    Four-eyes rule:
      - minor: can be published by author (status must be draft)
      - major (requiresReaccept): must be approved by a different admin first (status must be approved)
    """
    if not db:
        raise PolicyError("Database not available", 500)
    if policy_key not in KNOWN_POLICIES:
        raise PolicyError("Unknown policy key", 404)

    policy_ref = _policy_doc(db, policy_key)
    version_ref = _version_doc(db, policy_key, version)

    @firestore.transactional
    def txn(transaction):
        vsnap = version_ref.get(transaction=transaction)
        if not vsnap.exists:
            raise PolicyError("Version not found", 404)
        v = vsnap.to_dict() or {}
        status = v.get("status", "draft")
        requires = bool(v.get("requiresReaccept", False))
        created_by = v.get("createdByUid")
        approved_by = v.get("approvedByUid")

        psnap = policy_ref.get(transaction=transaction)
        p = psnap.to_dict() or {} if psnap.exists else {}
        prev_display = p.get("currentDisplayVersion")
        prev_required = p.get("currentRequiredVersion")

        if requires:
            if status != "approved":
                raise PolicyError("Major changes must be approved before publish", 409)
            if created_by and approved_by and created_by == approved_by:
                raise PolicyError("Four-eyes: author cannot approve own version", 403)
            if not approved_by:
                raise PolicyError("Missing approval", 409)
        else:
            if status not in ("draft", "approved"):
                raise PolicyError("Only drafts can be published", 409)

        transaction.set(
            version_ref,
            {
                "status": "published",
                "publishedAt": firestore.SERVER_TIMESTAMP,
                "publishedByUid": actor_uid,
                "changeSummary": change_summary or v.get("changeSummary", ""),
                "updatedAt": firestore.SERVER_TIMESTAMP,
            },
            merge=True,
        )

        updates = {
            "currentDisplayVersion": version,
            "updatedAt": firestore.SERVER_TIMESTAMP,
        }
        if requires:
            updates["currentRequiredVersion"] = version
        else:
            # Ensure required version is stable across "minor" publishes.
            # If the policy doc was created before we stored currentRequiredVersion,
            # missing requiredVersion would otherwise fall back to displayVersion and
            # unintentionally force re-accept for minor edits.
            if not prev_required:
                updates["currentRequiredVersion"] = prev_display or version
        transaction.set(policy_ref, updates, merge=True)

        return {"displayVersion": version, "requiredVersion": updates.get("currentRequiredVersion")}

    transaction = db.transaction()
    return txn(transaction)

