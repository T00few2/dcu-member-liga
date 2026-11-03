"""Run predictor tuning against Firestore data and keep each run for review.

Runs are stored in `predictor_tuning_runs/{runId}`. A run that found better
settings stays `pending` until an admin applies or rejects it; applying saves
the new config (previous one goes to history, so it can be rolled back).
"""
from __future__ import annotations

import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from services import predictor_service as ps
from services import predictor_tuning as pt
from services import velo_predictor as vp
from services.strava_power_curve import cached_reader

COLLECTION = "predictor_tuning_runs"


class TuningRunError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


STALE_RUNNING_MINUTES = 20


def _compute(db: Any, *, folds: int) -> dict:
    """The tuning itself: eval set from cached data, cross-validation and the search."""
    participants = ps.load_participants(db)
    categories = ps.load_categories(db)
    current = ps.load_config(db)
    min_rides = ps.division_agent_settings(db)["minZwiftRides"]
    read_curve = cached_reader(db)
    riders = pt.build_eval_set(participants, read_curve, min_rides=min_rides, categories=categories)
    result = pt.tune(participants, riders, current, categories=categories, folds=folds, min_rides=min_rides)
    return {
        "status": "pending" if result.status == "improved" else "report",
        "result": result.to_dict(),
        "currentConfig": current.to_dict(),
        "minZwiftRides": min_rides,
    }


def run_tuning(db: Any, *, started_by: str, save: bool = True, folds: int = pt.DEFAULT_FOLDS) -> dict:
    """Tune in one go (used by scripts/predictor_tune.py) and optionally store the run."""
    run = {"runId": uuid.uuid4().hex, "createdAt": _now(), "startedBy": started_by,
           **_compute(db, folds=folds)}
    if save:
        db.collection(COLLECTION).document(run["runId"]).set(run)
    return run


def _parse(iso: Any) -> datetime | None:
    if not isinstance(iso, str):
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _expire_stale(db: Any, runs: list[dict]) -> None:
    """A run still `running` after STALE_RUNNING_MINUTES was killed with its request."""
    limit = datetime.now(timezone.utc) - timedelta(minutes=STALE_RUNNING_MINUTES)
    for run in runs:
        created = _parse(run.get("createdAt"))
        if run.get("status") == "running" and created and created < limit:
            db.collection(COLLECTION).document(run["runId"]).set(
                {"status": "failed", "error": "Run stopped (server time limit).", "finishedAt": _now()}, merge=True)
            run["status"] = "failed"


def start_run(db: Any, *, started_by: str) -> dict:
    """Create a `running` run and return at once; `process_run` does the work.

    The admin page starts processing without waiting for it, so a slow tuning never
    leaves the browser request hanging.
    """
    runs = list_runs(db, 5)
    if any(r.get("status") == "running" for r in runs):
        raise TuningRunError("A tuning run is already running")
    run = {"runId": uuid.uuid4().hex, "createdAt": _now(), "startedBy": started_by, "status": "running"}
    db.collection(COLLECTION).document(run["runId"]).set(run)
    return run


def process_run(db: Any, run_id: str, *, folds: int = pt.DEFAULT_FOLDS) -> dict:
    ref, run = _load_run(db, run_id)
    if run.get("status") != "running":
        raise TuningRunError("This run is not waiting to be processed")
    try:
        result = _compute(db, folds=folds)
    except Exception as exc:
        result = {"status": "failed", "error": f"{type(exc).__name__}: {exc}"}
    result["finishedAt"] = _now()
    ref.set(result, merge=True)
    return {**run, **result}


def list_runs(db: Any, limit: int = 10) -> list[dict]:
    query = db.collection(COLLECTION).order_by("createdAt", direction="DESCENDING").limit(limit)
    runs = [snap.to_dict() or {} for snap in query.stream()]
    _expire_stale(db, runs)
    return runs


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
