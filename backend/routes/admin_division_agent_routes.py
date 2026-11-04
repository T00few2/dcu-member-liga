"""Admin routes for the division agent: proposals, decisions, scan and status."""
from __future__ import annotations

import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db, strava_service
from routes.admin import admin_bp
from services import predictor_service as ps
from services.division_agent import evidence, proposals, runner
from services.dual_recording.strava import _compute_strava_power_curve

logger = logging.getLogger(__name__)


def _admin():
    try:
        return require_admin(request), None
    except AuthzError as e:
        return None, (jsonify({"message": e.message}), e.status_code)


def _who(decoded: dict | None) -> str:
    decoded = decoded or {}
    return str(decoded.get("email") or decoded.get("uid") or "admin")


@admin_bp.route("/admin/division-agent/proposals", methods=["GET"])
def division_agent_proposals():
    """`?status=pending` (default) or `?status=history`."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    status = "history" if request.args.get("status") == "history" else "pending"
    try:
        return jsonify({"proposals": proposals.list_proposals(db, status)}), 200
    except Exception as e:
        logger.error("division_agent_proposals error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/division-agent/proposals/<proposal_id>/decision", methods=["POST"])
def division_agent_decision(proposal_id: str):
    """Body `{action: approve|edit|reject, category?, note?}`."""
    decoded, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        result = proposals.decide(
            db, proposal_id, str(body.get("action") or ""), decided_by=_who(decoded),
            category=body.get("category") if isinstance(body.get("category"), str) else None,
            note=body.get("note") if isinstance(body.get("note"), str) else None,
        )
        ps.clear_caches()  # the rider's division changed: predictor pages re-read participants
        return jsonify({"proposal": result}), 200
    except proposals.ProposalError as e:
        return jsonify({"message": e.message}), e.status_code
    except Exception as e:
        logger.error("division_agent_decision error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/division-agent/scan", methods=["POST"])
def division_agent_scan():
    """Queue every rider who needs a look (the worker processes them within minutes)."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify({"queued": runner.scan(db)}), 200
    except Exception as e:
        logger.error("division_agent_scan error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/division-agent/status", methods=["GET"])
def division_agent_status():
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify(runner.status(db)), 200
    except Exception as e:
        logger.error("division_agent_status error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/division-agent/assess/<zwift_id>", methods=["POST"])
def division_agent_assess(zwift_id: str):
    """Review one rider now. `?dryRun=1` returns the would-be proposal without saving it."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    dry_run = request.args.get("dryRun") in ("1", "true")
    try:
        bundle = ps.get_model(db)
        row = next((r for r in bundle[1] if str(r.get("zwiftId")) == str(zwift_id)), None)
        if row is None:
            return jsonify({"message": "Rider not found"}), 404
        result = runner.process_rider(
            db, row, settings=ps.division_agent_settings(db), model_bundle=bundle,
            strava_service=strava_service, compute_curve=_compute_strava_power_curve, dry_run=dry_run,
        )
        return jsonify(result), 200
    except evidence.WaitingForStrava:
        return jsonify({"message": "The Strava budget is used up right now; try again later."}), 429
    except Exception as e:
        logger.error("division_agent_assess error: %s", e)
        return jsonify({"message": str(e)}), 500
