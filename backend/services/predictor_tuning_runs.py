"""Run predictor tuning against Firestore data and keep each run for review.

Runs are stored in `predictor_tuning_runs/{runId}`. A run that found better
settings stays `pending` until an admin applies or rejects it; applying saves
the new config (previous one goes to history, so it can be rolled back).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Any

from services import predictor_service as ps
from services import predictor_tuning as pt
from services import velo_predictor as vp
from services.strava_power_curve import read_cached_curve

COLLECTION = "predictor_tuning_runs"


class TuningRunError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_tuning(db: Any, *, started_by: str, save: bool = True, folds: int = pt.DEFAULT_FOLDS) -> dict:
    """Build the eval set from cached data, tune, and (optionally) store the run."""
    participants = ps.load_participants(db)
    categories = ps.load_categories(db)
    current = ps.load_config(db)
    min_rides = ps.division_agent_settings(db)["minZwiftRides"]

    def read_curve(user_doc_id: str, days: int) -> dict | None:
        try:
            return read_cached_curve(db, user_doc_id, days)
        except Exception:
            return None

    riders = pt.build_eval_set(participants, read_curve, min_rides=min_rides, categories=categories)
    result = pt.tune(participants, riders, current, categories=categories, folds=folds, min_rides=min_rides)
    run = {
        "runId": uuid.uuid4().hex,
        "createdAt": _now(),
        "startedBy": started_by,
        "status": "pending" if result.status == "improved" else "report",
        "result": result.to_dict(),
        "currentConfig": current.to_dict(),
        "minZwiftRides": min_rides,
    }
    if save:
        db.collection(COLLECTION).document(run["runId"]).set(run)
    return run


def list_runs(db: Any, limit: int = 10) -> list[dict]:
    query = db.collection(COLLECTION).order_by("createdAt", direction="DESCENDING").limit(limit)
    return [snap.to_dict() or {} for snap in query.stream()]


def _load_run(db: Any, run_id: str) -> tuple[Any, dict]:
    ref = db.collection(COLLECTION).document(str(run_id))
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise TuningRunError("Tuning run not found", 404)
    return ref, snap.to_dict() or {}


def apply_run(db: Any, run_id: str, *, decided_by: str) -> dict:
    ref, run = _load_run(db, run_id)
    if run.get("status") != "pending":
        raise TuningRunError("Only a pending tuning proposal can be applied")
    best = (run.get("result") or {}).get("best") or {}
    if not isinstance(best.get("config"), dict):
        raise TuningRunError("This run has no proposed settings")
    config = vp.PredictorConfig.from_dict(best["config"])
    metrics = {**(best.get("score") or {}), "runId": run_id, "measuredAt": run.get("createdAt")}
    ps.save_config(
        db,
        config,
        saved_by=decided_by,
        reason=f"Tuning run {run_id}: +{(run.get('result') or {}).get('improvementPP')} pp division accuracy",
        metrics=metrics,
    )
    ref.set({"status": "applied", "decidedBy": decided_by, "decidedAt": _now()}, merge=True)
    return {"config": config.to_dict(), "metrics": metrics}


def reject_run(db: Any, run_id: str, *, decided_by: str, note: str = "") -> None:
    ref, run = _load_run(db, run_id)
    if run.get("status") != "pending":
        raise TuningRunError("Only a pending tuning proposal can be rejected")
    ref.set({"status": "rejected", "decidedBy": decided_by, "decidedAt": _now(), "decisionNote": note[:500]},
            merge=True)
