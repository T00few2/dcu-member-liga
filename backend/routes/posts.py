from __future__ import annotations

import logging

from flask import Blueprint, jsonify, request
from firebase_admin import firestore

from authz import AuthzError, verify_user_token
from extensions import db

logger = logging.getLogger(__name__)

posts_bp = Blueprint("posts", __name__)

MAX_COMMENT_LENGTH = 2000


@posts_bp.route("/posts/<post_id>/comments", methods=["POST", "OPTIONS"])
def create_comment(post_id: str):
    if request.method == "OPTIONS":
        return "", 204

    try:
        decoded_token = verify_user_token(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"message": "Database not available"}), 500

    data = request.get_json(silent=True) or {}
    body = (data.get("body") or "").strip()
    if not body:
        return jsonify({"message": "Comment body is required"}), 400
    if len(body) > MAX_COMMENT_LENGTH:
        return jsonify({"message": f"Comment must be at most {MAX_COMMENT_LENGTH} characters"}), 400

    uid = decoded_token["uid"]
    display_name = (data.get("displayName") or "").strip() or "Anonym"
    parent_id = data.get("parentId") or None

    post_ref = db.collection("posts").document(post_id)
    post_snap = post_ref.get()
    if not post_snap.exists:
        return jsonify({"message": "Post not found"}), 404

    comment_ref = post_ref.collection("comments").document()
    now = firestore.SERVER_TIMESTAMP

    batch = db.batch()
    batch.set(comment_ref, {
        "uid": uid,
        "displayName": display_name,
        "body": body,
        "parentId": parent_id,
        "reported": False,
        "createdAt": now,
    })
    batch.update(post_ref, {"commentCount": firestore.Increment(1)})
    batch.commit()

    return jsonify({"id": comment_ref.id}), 201
