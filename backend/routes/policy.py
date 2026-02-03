from __future__ import annotations

from flask import Blueprint, jsonify, request

from authz import require_admin, AuthzError
from extensions import db
from services.policy_store import (
    PolicyError,
    KNOWN_POLICIES,
    get_policy_meta,
    get_current_policy,
    list_versions,
    upsert_draft,
    submit_for_review,
    approve_version,
    publish_version,
    serialize_policy_doc,
)


policy_bp = Blueprint("policy", __name__)


@policy_bp.route("/policy/meta", methods=["GET"])
def policy_meta():
    # This endpoint can safely fall back to defaults if DB is unavailable.
    return jsonify({"policies": get_policy_meta(db), "knownPolicies": KNOWN_POLICIES}), 200


@policy_bp.route("/policy/<policy_key>/current", methods=["GET"])
def policy_current(policy_key: str):
    try:
        return jsonify(serialize_policy_doc(get_current_policy(db, policy_key))), 200
    except PolicyError as e:
        return jsonify({"message": e.message}), e.status_code


# --- Admin endpoints ---

@policy_bp.route("/admin/policy/<policy_key>/versions", methods=["GET"])
def admin_list_versions(policy_key: str):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    try:
        versions = [serialize_policy_doc(v) for v in list_versions(db, policy_key)]
        return jsonify({"versions": versions}), 200
    except PolicyError as e:
        return jsonify({"message": e.message}), e.status_code


@policy_bp.route("/admin/policy/<policy_key>/versions/<version>", methods=["PUT"])
def admin_upsert_draft(policy_key: str, version: str):
    try:
        decoded = require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    body = request.get_json(silent=True) or {}
    try:
        upsert_draft(
            db,
            policy_key,
            version,
            title_da=body.get("titleDa", ""),
            content_md_da=body.get("contentMdDa", ""),
            change_type=body.get("changeType", "minor"),
            requires_reaccept=bool(body.get("requiresReaccept", False)),
            actor_uid=decoded.get("uid"),
        )
        return jsonify({"message": "Draft saved"}), 200
    except PolicyError as e:
        return jsonify({"message": e.message}), e.status_code


@policy_bp.route("/admin/policy/<policy_key>/versions/<version>/submit", methods=["POST"])
def admin_submit(policy_key: str, version: str):
    try:
        decoded = require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    try:
        submit_for_review(db, policy_key, version, actor_uid=decoded.get("uid"))
        return jsonify({"message": "Submitted for review"}), 200
    except PolicyError as e:
        return jsonify({"message": e.message}), e.status_code


@policy_bp.route("/admin/policy/<policy_key>/versions/<version>/approve", methods=["POST"])
def admin_approve(policy_key: str, version: str):
    try:
        decoded = require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code
    try:
        approve_version(db, policy_key, version, actor_uid=decoded.get("uid"))
        return jsonify({"message": "Approved"}), 200
    except PolicyError as e:
        return jsonify({"message": e.message}), e.status_code


@policy_bp.route("/admin/policy/<policy_key>/versions/<version>/publish", methods=["POST"])
def admin_publish(policy_key: str, version: str):
    try:
        decoded = require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    body = request.get_json(silent=True) or {}
    try:
        result = publish_version(
            db,
            policy_key,
            version,
            actor_uid=decoded.get("uid"),
            change_summary=body.get("changeSummary", ""),
        )
        return jsonify({"message": "Published", "meta": result}), 200
    except PolicyError as e:
        return jsonify({"message": e.message}), e.status_code

