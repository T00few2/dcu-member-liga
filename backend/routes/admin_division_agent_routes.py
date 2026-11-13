"""Admin routes for the division agent: proposals, decisions, scan, status and the help bot's unanswered questions."""
from __future__ import annotations

import json
import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db, strava_service
from routes.admin import admin_bp
from services import predictor_service as ps
from services.division_agent import evidence, proposals, runner
from services.division_agent import league_tools as lt
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
        stats: dict = {}
        queued = runner.scan(db, stats=stats)
        return jsonify({"queued": queued, "closed": stats.get("closed", 0)}), 200
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


@admin_bp.route("/admin/division-agent/settings", methods=["POST"])
def division_agent_settings_update():
    """Body with any of: `autoReply` (bool: division answers on Discord without approval),
    `reviewFilter` (which riders the agent checks) and `minZwiftRides` (1-200)."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    update: dict = {}
    if "autoReply" in body:
        if not isinstance(body["autoReply"], bool):
            return jsonify({"message": "autoReply must be true or false"}), 400
        update["autoReply"] = body["autoReply"]
    if "reviewFilter" in body:
        if not isinstance(body["reviewFilter"], dict):
            return jsonify({"message": "reviewFilter must be an object"}), 400
        update["reviewFilter"] = ps.triage_filter(body["reviewFilter"])
    if "minZwiftRides" in body:
        rides = body["minZwiftRides"]
        if not isinstance(rides, int) or isinstance(rides, bool) or not 1 <= rides <= 200:
            return jsonify({"message": "minZwiftRides must be a whole number from 1 to 200"}), 400
        update["minZwiftRides"] = rides
    if not update:
        return jsonify({"message": "Nothing to save"}), 400
    try:
        db.collection("league").document("settings").set({"divisionAgent": update}, merge=True)
        ps.clear_caches()
        settings = ps.division_agent_settings(db)
        return jsonify({k: settings[k] for k in ("autoReply", "reviewFilter", "minZwiftRides")}), 200
    except Exception as e:
        logger.error("division_agent_settings_update error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/division-agent/filter-preview", methods=["GET"])
def division_agent_filter_preview():
    """How many riders a filter would select (`?filter=<json>&minZwiftRides=<n>`); saves nothing."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        raw = json.loads(request.args.get("filter") or "{}")
    except ValueError:
        return jsonify({"message": "filter must be JSON"}), 400
    settings = dict(ps.division_agent_settings(db))
    settings["reviewFilter"] = ps.triage_filter(raw)
    rides = request.args.get("minZwiftRides", type=int)
    if rides is not None and 1 <= rides <= 200:
        settings["minZwiftRides"] = rides
    try:
        rows = ps.cached_participants(db)
        return jsonify(runner.filter_preview(rows, settings, proposals.all_proposals(db))), 200
    except Exception as e:
        logger.error("division_agent_filter_preview error: %s", e)
        return jsonify({"message": "Could not count riders"}), 500


@admin_bp.route("/admin/division-agent/struggling", methods=["GET"])
def division_agent_struggling():
    """Riders who keep finishing at the back of their division (the review filter's thresholds),
    with their results, vELO and whether their division is held above their own vELO."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        settings = ps.division_agent_settings(db)
        riders = runner.struggling_riders(ps.cached_participants(db), settings, ps.load_categories(db),
                                          proposals.all_proposals(db))
        flt = settings["reviewFilter"]
        return jsonify({
            "riders": riders,
            "thresholds": {k: flt[k] for k in ("strugglingMinRaces", "strugglingPercentile", "strugglingShare")},
            "reasonEnabled": "struggling" in flt["reasons"],
        }), 200
    except Exception as e:
        logger.error("division_agent_struggling error: %s", e)
        return jsonify({"message": "Could not list struggling riders"}), 500


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
        bundle = runner.fresh_bundle(db)
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


@admin_bp.route("/admin/division-agent/unanswered", methods=["GET"])
def division_agent_unanswered():
    """Questions the Discord help bot could not answer: `?status=open` (default) or `?status=resolved`."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    status = "resolved" if request.args.get("status") == "resolved" else "open"
    try:
        return jsonify({"items": lt.list_unanswered(db, status=status)}), 200
    except Exception as e:
        logger.error("division_agent_unanswered error: %s", e)
        return jsonify({"message": "Could not load the questions"}), 500


@admin_bp.route("/admin/division-agent/unanswered/<item_id>/resolve", methods=["POST"])
def division_agent_unanswered_resolve(item_id: str):
    decoded, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        item = lt.resolve_unanswered(db, item_id, resolved_by=_who(decoded),
                                     note=body.get("note") if isinstance(body.get("note"), str) else None)
        return jsonify({"item": item}), 200
    except LookupError:
        return jsonify({"message": "Not found"}), 404
    except Exception as e:
        logger.error("division_agent_unanswered_resolve error: %s", e)
        return jsonify({"message": "Could not update the question"}), 500
