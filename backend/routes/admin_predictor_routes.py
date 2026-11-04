"""Admin endpoints for the vELO predictor.

The admin predictor page has no model code of its own: it gets the fitted model,
every rider's prediction and predictions for typed or Strava inputs from here.
"""
from __future__ import annotations

import logging

from flask import jsonify, request

from authz import AuthzError, require_admin, require_scheduler
from extensions import db, strava_service
from routes.admin import admin_bp
from services import predictor_research as research
from services.division_agent import runner as agent_runner
from services import predictor_service as ps
from services import predictor_tuning_runs as runs
from services import strava_cache_warmer as warmer
from services.dual_recording.strava import _compute_strava_power_curve
from services.predictor_tuning import MIN_EVAL_RIDERS
from services import velo_predictor as vp

logger = logging.getLogger(__name__)

MAX_PREDICT_ROWS = 2000


def _admin():
    try:
        return require_admin(request), None
    except AuthzError as e:
        return None, (jsonify({"message": e.message}), e.status_code)


def _who(decoded: dict | None) -> str:
    decoded = decoded or {}
    return str(decoded.get("email") or decoded.get("uid") or "admin")


def _config_from_body(body: dict) -> vp.PredictorConfig | None:
    """Optional unsaved config from the page (e.g. features being toggled), merged over the saved one."""
    raw = body.get("config")
    if not isinstance(raw, dict):
        return None
    merged = {**ps.load_config(db).to_dict(), **raw}
    return vp.PredictorConfig.from_dict(merged)


def _feature_defs() -> list[dict]:
    return [f.public() for f in vp.FEATURE_DEFS]


@admin_bp.route("/admin/predictor/model", methods=["POST"])
def predictor_model():
    """Fitted model + every rider's Zwift-power prediction.

    Body: `{config?: {...}}` to preview an unsaved config; omitted = saved config.
    """
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        body = request.get_json(silent=True) or {}
        config = _config_from_body(body) or ps.load_config(db)
        model, participants, cats = ps.get_model(db, config)
        return jsonify({
            "model": model.to_dict() if model else None,
            "config": config.to_dict(),
            "defaultFeatures": dict(vp.DEFAULT_FEATURES),
            "features": _feature_defs(),
            "predictions": ps.zwift_predictions(model, participants, cats),
        }), 200
    except Exception as e:
        logger.error("predictor_model error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/predict", methods=["POST"])
def predictor_predict():
    """Predictions for a batch of input rows.

    Body: `{config?, rows: [{id, inputs: {weightKg, racingScore, wkg5s, wkg1m, wkg5m, wkg20m},
    source?: "zwift"|"strava", activityCount?}]}` → `{predictions: {id: prediction}}`.
    """
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    rows = body.get("rows")
    if not isinstance(rows, list) or len(rows) > MAX_PREDICT_ROWS:
        return jsonify({"message": f"rows must be a list of at most {MAX_PREDICT_ROWS} items"}), 400
    try:
        config = _config_from_body(body) or ps.load_config(db)
        model, _, cats = ps.get_model(db, config)
        out = {}
        for row in rows:
            if not isinstance(row, dict) or row.get("id") is None:
                continue
            source = "strava" if row.get("source") == "strava" else "zwift"
            count = row.get("activityCount")
            out[str(row["id"])] = vp.predict_inputs(
                model,
                row.get("inputs") if isinstance(row.get("inputs"), dict) else {},
                cats,
                source=source,
                activity_count=count if isinstance(count, int) and not isinstance(count, bool) else None,
            )
        return jsonify({"predictions": out}), 200
    except Exception as e:
        logger.error("predictor_predict error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/config", methods=["GET"])
def get_predictor_config():
    """Active config, its latest tuning metrics and the change history."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        saved = ps.predictor_settings(db)
        return jsonify({
            "config": ps.load_config(db).to_dict(),
            "metrics": saved.get("metrics"),
            "history": saved.get("history") or [],
            "updatedAt": saved.get("updatedAt"),
        }), 200
    except Exception as e:
        logger.error("get_predictor_config error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/config", methods=["POST"])
def save_predictor_config():
    """Save a new active config (body `{config, reason?}`) or roll back (`{rollbackIndex}`)."""
    decoded, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        saved_by = _who(decoded)
        if "rollbackIndex" in body:
            idx = body.get("rollbackIndex")
            history = ps.predictor_settings(db).get("history") or []
            if not isinstance(idx, int) or isinstance(idx, bool) or not 0 <= idx < len(history):
                return jsonify({"message": "rollbackIndex is out of range"}), 400
            entry = history[idx] or {}
            config = vp.PredictorConfig.from_dict(entry.get("config"))
            ps.save_config(db, config, saved_by=saved_by, reason=f"Rollback to version from {entry.get('replacedAt')}",
                           metrics=entry.get("metrics"))
            return jsonify({"config": config.to_dict(), "message": "Rolled back"}), 200

        raw = body.get("config")
        if not isinstance(raw, dict):
            return jsonify({"message": "config must be an object"}), 400
        config = vp.PredictorConfig.from_dict({**ps.load_config(db).to_dict(), **raw})
        if not config.active_features():
            return jsonify({"message": "Select at least one feature"}), 400
        reason = body.get("reason") if isinstance(body.get("reason"), str) else "Saved from admin page"
        ps.save_config(db, config, saved_by=saved_by, reason=reason[:500])
        return jsonify({"config": config.to_dict(), "message": "Saved"}), 200
    except Exception as e:
        logger.error("save_predictor_config error: %s", e)
        return jsonify({"message": str(e)}), 500


# --- Tuning ------------------------------------------------------------------


@admin_bp.route("/admin/predictor/tune", methods=["POST"])
def predictor_tune():
    """Start a tuning run (returns at once with status `running`).

    The work is done by POST /admin/predictor/tune/<runId>/process. Uses only cached
    Strava curves.
    """
    decoded, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify(runs.start_run(db, started_by=_who(decoded))), 200
    except runs.TuningRunError as e:
        return jsonify({"message": e.message}), e.status_code
    except Exception as e:
        logger.error("predictor_tune error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/tune/<run_id>/process", methods=["POST"])
def predictor_tune_process(run_id: str):
    """Do the work for a run created by POST /admin/predictor/tune.

    The admin page calls this right after starting a run and polls /tune/runs for the
    result. If this call never arrives, /admin/predictor/worker processes the run.
    """
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        run = runs.process_run(db, run_id)
        return jsonify({"runId": run.get("runId"), "status": run.get("status")}), 200
    except runs.TuningRunError as e:
        return jsonify({"message": e.message}), e.status_code
    except Exception as e:
        logger.error("predictor_tune_process error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/worker", methods=["POST"])
def predictor_worker():
    """Process one waiting predictor job (scheduler or admin): a tuning run, else research,
    else a batch of the division agent's queue.

    Called every 5 minutes by Cloud Scheduler (see deploy-backend.yml), so jobs finish
    even when the admin page's own processing request never reaches the server. Each
    job is claimed once, so this never repeats work the page already started.
    """
    try:
        require_scheduler(request)
    except AuthzError:
        _, err = _admin()
        if err:
            return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        tuned = runs.process_waiting(db)
        # One job per call: research needs nearly the whole request time limit, so after
        # a tuning run it waits for the next call (5 minutes later) instead of being cut off.
        researched = research.process_next(db) if tuned is None else None
        # Then the division agent's queue (riders to review), when nothing else ran.
        divisions = None
        if tuned is None and researched is None:
            divisions = agent_runner.process_batch(
                db, strava_service=strava_service, compute_curve=_compute_strava_power_curve)
        # Counts and statuses only: scheduler responses may end up in logs.
        return jsonify({
            "tuning": tuned.get("status") if tuned else None,
            "research": research.public_summary(researched),
            "divisionAgent": divisions,
        }), 200
    except Exception as e:
        logger.error("predictor_worker error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/tune/runs", methods=["GET"])
def predictor_tune_runs():
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify({"runs": runs.list_runs(db)}), 200
    except Exception as e:
        logger.error("predictor_tune_runs error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/tune/<run_id>/decision", methods=["POST"])
def predictor_tune_decision(run_id: str):
    """Apply or reject a tuning proposal. Body: `{action: "apply"|"reject", note?}`."""
    decoded, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    action = body.get("action")
    try:
        if action == "apply":
            return jsonify(runs.apply_run(db, run_id, decided_by=_who(decoded))), 200
        if action == "reject":
            note = body.get("note") if isinstance(body.get("note"), str) else ""
            runs.reject_run(db, run_id, decided_by=_who(decoded), note=note)
            return jsonify({"message": "Rejected"}), 200
        return jsonify({"message": "action must be apply or reject"}), 400
    except runs.TuningRunError as e:
        return jsonify({"message": e.message}), e.status_code
    except Exception as e:
        logger.error("predictor_tune_decision error: %s", e)
        return jsonify({"message": str(e)}), 500


# --- Strava curve cache for tuning ----------------------------------------------


def _cache_context():
    participants = ps.load_participants(db)
    min_rides = ps.division_agent_settings(db)["minZwiftRides"]
    days = ps.load_config(db).stravaWindowDays
    return participants, min_rides, days


@admin_bp.route("/admin/predictor/strava-cache/status", methods=["GET"])
def predictor_strava_cache_status():
    """How many tuning-eligible riders already have a fresh cached Strava curve."""
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        participants, min_rides, days = _cache_context()
        status = warmer.cache_status(db, participants, min_rides=min_rides, days=days)
        return jsonify({
            "days": status["days"],
            "eligible": status["eligible"],
            "cached": status["cached"],
            "noPowerData": status["noPowerData"],
            "remaining": len(status["missing"]),
            "minEvalRiders": MIN_EVAL_RIDERS,
            "stravaUsage": warmer.strava_usage(db),
            "lastWarm": warmer.last_warm(db),
        }), 200
    except Exception as e:
        logger.error("predictor_strava_cache_status error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/strava-cache/warm", methods=["POST"])
def predictor_strava_cache_warm():
    """Fetch Strava curves for a couple of eligible riders (scheduler or admin).

    Called every 15 minutes by Cloud Scheduler (see `deploy-backend.yml`); a no-op
    once every eligible rider has a fresh curve, and `busy` when another call is
    still running.
    """
    try:
        require_scheduler(request)
    except AuthzError:
        _, err = _admin()
        if err:
            return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        participants, min_rides, days = _cache_context()
        result = warmer.warm(
            db, strava_service, participants,
            min_rides=min_rides, days=days, compute_curve=_compute_strava_power_curve,
        )
        if result.get("busy"):
            return jsonify({"busy": True, "warmed": 0, "rateLimited": False}), 200
        # Counts only: the scheduled workflow's logs are public, so no rider IDs.
        return jsonify({
            "days": result["days"],
            "eligible": result["eligible"],
            "cached": result["cached"],
            "noPowerData": result["noPowerData"],
            "warmed": len(result["warmed"]),
            "failed": len(result["failed"]),
            "remaining": result["remaining"],
            "rateLimited": result["rateLimited"],
            "minEvalRiders": MIN_EVAL_RIDERS,
        }), 200
    except Exception as e:
        logger.error("predictor_strava_cache_warm error: %s", e)
        return jsonify({"message": str(e)}), 500


# --- Claude sandbox research -----------------------------------------------------


@admin_bp.route("/admin/predictor/research", methods=["POST"])
def predictor_research_queue():
    """Queue a sandbox research run; it is processed by .../research/process."""
    decoded, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify(research.queue_run(db, started_by=_who(decoded))), 200
    except research.ResearchError as e:
        return jsonify({"message": e.message}), e.status_code
    except Exception as e:
        logger.error("predictor_research_queue error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/research/process", methods=["POST"])
def predictor_research_process():
    """Run the oldest queued research run (scheduler or admin). Can take up to ~13 minutes.

    Body: `{autoQueueIfOlderThanDays?: int}` queues a run first when none was
    created in that many days (the monthly schedule uses this).
    """
    try:
        require_scheduler(request)
    except AuthzError:
        _, err = _admin()
        if err:
            return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    body = request.get_json(silent=True) or {}
    try:
        days = body.get("autoQueueIfOlderThanDays")
        queued = False
        if isinstance(days, int) and not isinstance(days, bool) and days > 0:
            queued = research.auto_queue_due(db, older_than_days=days)
        run = research.process_next(db)
        # Only a minimal summary: the scheduled workflow's logs are public. The admin page
        # reads the full run (without the id map) from /research/runs.
        return jsonify({**research.public_summary(run), "autoQueued": queued}), 200
    except Exception as e:
        logger.error("predictor_research_process error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/predictor/research/runs", methods=["GET"])
def predictor_research_runs():
    _, err = _admin()
    if err:
        return err
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        return jsonify({"runs": research.list_runs(db)}), 200
    except Exception as e:
        logger.error("predictor_research_runs error: %s", e)
        return jsonify({"message": str(e)}), 500
