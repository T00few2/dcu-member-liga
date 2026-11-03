"""Claude sandbox research for the vELO predictor.

The regular tuner (`predictor_tuning.py`) only searches settings the code already
supports. This module lets Claude try *new* ideas — extra features, other model
types, outlier handling — in Anthropic's code-execution sandbox, on an anonymized
copy of the tuning data, scored with exactly the same folds and the same
"right division" metric.

Nothing from the sandbox runs in production. A run ends with a written report
and, when an idea clearly beats today's settings, proposed code for
`velo_predictor.py` that an admin can copy into a GitHub issue / pull request.

Runs live in the admin-only `predictor_research_runs/{runId}` collection and go
through `queued -> running -> done | failed | timed_out`. They are processed by
`POST /admin/predictor/research/process` (scheduler or admin) so a long run
never blocks a page request.

Privacy: the uploaded CSVs hold power numbers, weight, ZRS, phenotype and ride
counts only. Riders are keyed by a salted hash; the hash -> Zwift ID map stays in
the run document and is never sent to Anthropic.
"""
from __future__ import annotations

import csv
import hashlib
import io
import logging
import os
import secrets
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Callable

from services import predictor_service as ps
from services import predictor_tuning as pt
from services import velo_predictor as vp
from services.category_engine import ZR_CATEGORIES
from services.strava_power_curve import read_cached_curve

logger = logging.getLogger(__name__)

COLLECTION = "predictor_research_runs"
DEFAULT_MODEL = "claude-opus-5-5"
MAX_TURNS = 24
MAX_TOKENS = 16000
# The Cloud Function times out after 900 s; stop well before that and keep what we have.
DEFAULT_DEADLINE_SECONDS = 780
STALE_RUNNING_MINUTES = 20
FILE_TTL_SECONDS = 24 * 3600
FALLBACK_BETA = "server-side-fallback-2026-07-01"
CURVE_KEYS = ("w5", "w15", "w30", "w60", "w120", "w300", "w1200")

SUBMIT_TOOL = {
    "name": "submit_findings",
    "description": (
        "Submit the result of the research. Call exactly once, at the end, after you have "
        "measured the baseline and your best idea with the given folds."
    ),
    "strict": True,
    "input_schema": {
        "type": "object",
        "additionalProperties": False,
        "required": [
            "baselineDivisionAccuracy", "bestDivisionAccuracy", "baselineMaeVelo", "bestMaeVelo",
            "improved", "summary", "method", "proposedCode", "caveats", "ridersChanged",
        ],
        "properties": {
            "baselineDivisionAccuracy": {
                "type": "number",
                "description": "Percent right division for the baselinePred columns in eval.csv (reproduce it).",
            },
            "bestDivisionAccuracy": {"type": "number", "description": "Percent right division for your best idea."},
            "baselineMaeVelo": {"type": "number"},
            "bestMaeVelo": {"type": "number"},
            "improved": {"type": "boolean", "description": "True only if your best idea beats the baseline."},
            "summary": {
                "type": "string",
                "description": "Plain-language report for the league admin: what you tried, what worked, "
                               "what did not, where the model still fails.",
            },
            "method": {"type": "string", "description": "Exact description of the best model and its features."},
            "proposedCode": {
                "type": "string",
                "description": "Python code for backend/services/velo_predictor.py implementing the best idea "
                               "(new feature definitions / fitting changes), pure Python, no numpy. "
                               "Empty string if nothing beat the baseline.",
            },
            "caveats": {"type": "string", "description": "Overfitting risk, small-sample warnings, data issues."},
            "ridersChanged": {
                "type": "integer",
                "description": "How many eval riders get a different predicted division with your best idea.",
            },
        },
    },
}

SYSTEM_PROMPT = """You are a careful sports-data scientist helping a Danish Zwift racing league place riders in
divisions. Divisions come from ZwiftRacing vELO. Many riders barely race on Zwift, so the league predicts
their vELO from power data — mainly Strava (outdoor) power. Your job: find a better way to predict the
**division** from Strava power, using the data files in your sandbox, and report honestly.

Files (uploaded to your sandbox):
- training.csv — every league rider with a real vELO: Zwift power (watts), weight, ZRS, phenotype,
  realVelo. Column `fold` is set for riders that are also in eval.csv, empty otherwise.
- eval.csv — riders whose vELO is reliable AND who have a Strava power curve. Strava peak watts per window
  (strava{days}_w5 ... _w1200, strava{days}_activities), their `fold`, realVelo, realDivision, and the
  current production model's out-of-fold prediction (baselinePredVelo, baselinePredDivision).
- divisions.csv — division name and lower bound (inclusive) of the vELO range, top division first.

Evaluation protocol (must match production exactly):
1. For each fold k: train on training.csv rows whose fold != k (rows with empty fold are always training),
   then predict the eval.csv riders with fold == k from their Strava data (and weight / ZRS).
2. Division accuracy = percent of eval riders whose predicted vELO falls in the same division as realVelo.
   This is the main metric. MAE in vELO points is secondary.
3. First reproduce the baseline: accuracy of baselinePredDivision vs realDivision.

Ideas worth trying: feature combinations from the available durations (5s-20min), power ratios,
absolute vs per-kg power, outdoor->indoor scaling of Strava power, phenotype, ridge strength, robust
fitting / outlier handling, choice of Strava window. Prefer simple linear models: the production
predictor is pure Python (no numpy) and fits a linear regression on features computed from
weight, ZRS and 5s/1min/5min/20min power, so an improvement only helps if it can be written that way.
Guard against overfitting: with few riders, a tiny gain is noise — say so.

When done, call submit_findings once. Keep the summary short, concrete and in plain English."""


class ResearchError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(dt: datetime | None = None) -> str:
    return (dt or _now()).isoformat()


# ---------------------------------------------------------------------------
# Dataset
# ---------------------------------------------------------------------------


def _hash_id(salt: str, zwift_id: str) -> str:
    return hashlib.sha256(f"{salt}:{zwift_id}".encode()).hexdigest()[:12]


def _csv(rows: list[dict], columns: list[str]) -> bytes:
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore", lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({k: ("" if row.get(k) is None else row.get(k)) for k in columns})
    return buf.getvalue().encode("utf-8")


def build_dataset(
    participants: list[dict],
    riders: list[pt.EvalRider],
    baseline_per_rider: dict[str, dict],
    read_curve: Callable[[str, int], dict | None],
    *,
    folds: int = pt.DEFAULT_FOLDS,
    categories: Any = None,
    salt: str | None = None,
) -> dict:
    """Anonymized CSVs for the sandbox plus the private hash -> zwiftId map."""
    salt = salt or secrets.token_hex(8)
    fold_of: dict[str, int] = {}
    for k, ids in enumerate(pt.folds_for(riders, folds)):
        for zid in ids:
            fold_of[zid] = k
    id_map: dict[str, str] = {}

    def anon(zid: str) -> str:
        h = _hash_id(salt, zid)
        id_map[h] = zid
        return h

    training = []
    for p in participants:
        velo = vp.to_float(p.get("max30Rating"))
        kg = (vp.to_float(p.get("weightInGrams")) or 0) / 1000
        if not velo or velo <= 0 or kg <= 0:
            continue
        zid = str(p.get("zwiftId"))
        training.append({
            "rider": anon(zid),
            "fold": fold_of.get(zid, ""),
            "weightKg": round(kg, 2),
            "racingScore": vp.to_float(p.get("racingScore")) or "",
            "phenotype": p.get("phenotype") if p.get("phenotype") not in (None, "N/A") else "",
            "zwiftActivityCount": p.get("zwiftActivityCount") if p.get("zwiftActivityCount") is not None else "",
            "cp5s": p.get("cp5s") or "",
            "cp15s": p.get("cp15s") or "",
            "cp1min": p.get("cp1min") or "",
            "cp5min": p.get("cp5min") or "",
            "cp20min": p.get("cp20min") or "",
            "realVelo": velo,
        })
    training_cols = ["rider", "fold", "weightKg", "racingScore", "phenotype", "zwiftActivityCount",
                     "cp5s", "cp15s", "cp1min", "cp5min", "cp20min", "realVelo"]

    by_zid = {str(p.get("zwiftId")): p for p in participants}
    eval_rows = []
    strava_cols: list[str] = []
    for days in vp.STRAVA_WINDOWS:
        strava_cols += [f"strava{days}_{k}" for k in CURVE_KEYS] + [f"strava{days}_activities"]
    for r in riders:
        p = by_zid.get(r.zwiftId) or {}
        row = {
            "rider": anon(r.zwiftId),
            "fold": fold_of.get(r.zwiftId, ""),
            "weightKg": round(r.weightKg, 2),
            "racingScore": r.racingScore or "",
            "phenotype": p.get("phenotype") if p.get("phenotype") not in (None, "N/A") else "",
            "realVelo": r.realVelo,
            "realDivision": r.realCategory,
        }
        for days in vp.STRAVA_WINDOWS:
            entry = read_curve(str(p.get("userDocId") or ""), days) if p.get("userDocId") else None
            curve = (entry or {}).get("curve") or {}
            for k in CURVE_KEYS:
                row[f"strava{days}_{k}"] = curve.get(k, "")
            row[f"strava{days}_activities"] = (entry or {}).get("activityCount", "") if entry else ""
        base = baseline_per_rider.get(r.zwiftId) or {}
        row["baselinePredVelo"] = base.get("predictedVelo", "")
        row["baselinePredDivision"] = base.get("predictedCategory", "")
        eval_rows.append(row)
    eval_cols = ["rider", "fold", "weightKg", "racingScore", "phenotype"] + strava_cols + [
        "realVelo", "realDivision", "baselinePredVelo", "baselinePredDivision"]

    cats = categories or ZR_CATEGORIES
    division_rows = [{"division": name, "lowerVelo": lower} for name, lower, _upper in cats]

    return {
        "files": {
            "training.csv": _csv(training, training_cols),
            "eval.csv": _csv(eval_rows, eval_cols),
            "divisions.csv": _csv(division_rows, ["division", "lowerVelo"]),
        },
        "idMap": id_map,
        "counts": {"training": len(training), "eval": len(eval_rows)},
    }


# ---------------------------------------------------------------------------
# Claude loop
# ---------------------------------------------------------------------------


def _block_dicts(content: list) -> list:
    out = []
    for b in content:
        out.append(b.model_dump(exclude_none=True) if hasattr(b, "model_dump") else b)
    return out


def run_claude(
    client: Any,
    *,
    model: str,
    file_ids: list[str],
    baseline_note: str,
    deadline: float,
    clock: Callable[[], float] = time.monotonic,
) -> dict:
    """Drive the sandbox conversation until Claude submits findings, stops, or time runs out."""
    content: list[dict] = [{
        "type": "text",
        "text": (
            "The three data files are in your sandbox. " + baseline_note +
            " Reproduce the baseline first, then explore, then call submit_findings."
        ),
    }]
    content += [{"type": "container_upload", "file_id": fid} for fid in file_ids]
    messages: list[dict] = [{"role": "user", "content": content}]
    tools = [{"type": "code_execution_20260521", "name": "code_execution"}, SUBMIT_TOOL]
    usage = {"inputTokens": 0, "outputTokens": 0, "turns": 0}
    container_id = None
    last_text = ""
    nudged = False

    for _ in range(MAX_TURNS):
        if clock() > deadline:
            return {"status": "timed_out", "usage": usage, "lastText": last_text}
        kwargs = dict(
            model=model,
            max_tokens=MAX_TOKENS,
            system=SYSTEM_PROMPT,
            tools=tools,
            messages=messages,
            output_config={"effort": "high"},
            betas=[FALLBACK_BETA],
            fallbacks="default",
        )
        if container_id:
            kwargs["container"] = container_id
        resp = client.beta.messages.create(**kwargs)
        usage["turns"] += 1
        u = getattr(resp, "usage", None)
        usage["inputTokens"] += int(getattr(u, "input_tokens", 0) or 0)
        usage["outputTokens"] += int(getattr(u, "output_tokens", 0) or 0)
        cont = getattr(resp, "container", None)
        if cont is not None and getattr(cont, "id", None):
            container_id = cont.id
        if resp.stop_reason == "refusal":
            return {"status": "failed", "error": "The model declined this request.", "usage": usage}

        texts = [b.text for b in resp.content if getattr(b, "type", "") == "text" and getattr(b, "text", "")]
        if texts:
            last_text = texts[-1]
        submits = [b for b in resp.content if getattr(b, "type", "") == "tool_use"
                   and getattr(b, "name", "") == "submit_findings"]
        if submits:
            return {"status": "done", "findings": dict(submits[0].input), "usage": usage, "lastText": last_text}

        messages.append({"role": "assistant", "content": _block_dicts(resp.content)})
        if resp.stop_reason == "pause_turn":
            continue
        if resp.stop_reason == "tool_use":
            other = [b for b in resp.content if getattr(b, "type", "") == "tool_use"]
            messages.append({"role": "user", "content": [
                {"type": "tool_result", "tool_use_id": b.id, "is_error": True,
                 "content": "Unknown tool. Use code_execution, and submit_findings when done."}
                for b in other
            ]})
            continue
        if resp.stop_reason == "max_tokens" or not nudged:
            nudged = True
            messages.append({"role": "user", "content": "Please finish now and call submit_findings with your results."})
            continue
        break
    return {"status": "failed", "error": "The model stopped without submitting findings.", "usage": usage,
            "lastText": last_text}


# ---------------------------------------------------------------------------
# Runs
# ---------------------------------------------------------------------------


def _research_model(db: Any) -> str:
    raw = ps.league_settings(db).get("divisionAgent")
    model = (raw or {}).get("tuneModel") if isinstance(raw, dict) else None
    return model if isinstance(model, str) and model.startswith("claude-") else DEFAULT_MODEL


def _runs(db: Any, limit: int = 10) -> list[dict]:
    query = db.collection(COLLECTION).order_by("createdAt", direction="DESCENDING").limit(limit)
    return [snap.to_dict() or {} for snap in query.stream()]


def list_runs(db: Any, limit: int = 10) -> list[dict]:
    """Runs for the admin page (without the private id map)."""
    out = []
    for run in _runs(db, limit):
        run = dict(run)
        run.pop("idMap", None)
        out.append(run)
    return out


def _parse(iso: str | None) -> datetime | None:
    if not isinstance(iso, str):
        return None
    try:
        dt = datetime.fromisoformat(iso.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


def _expire_stale(db: Any, runs: list[dict]) -> None:
    limit = _now() - timedelta(minutes=STALE_RUNNING_MINUTES)
    for run in runs:
        started = _parse(run.get("startedAt"))
        if run.get("status") == "running" and started and started < limit:
            db.collection(COLLECTION).document(run["runId"]).set(
                {"status": "failed", "error": "Run stopped (server time limit).", "finishedAt": _iso()}, merge=True)
            run["status"] = "failed"


def queue_run(db: Any, *, started_by: str) -> dict:
    runs = _runs(db, 5)
    _expire_stale(db, runs)
    if any(r.get("status") in ("queued", "running") for r in runs):
        raise ResearchError("A research run is already queued or running")
    run = {
        "runId": uuid.uuid4().hex,
        "createdAt": _iso(),
        "startedBy": started_by,
        "status": "queued",
    }
    db.collection(COLLECTION).document(run["runId"]).set(run)
    return run


def auto_queue_due(db: Any, *, older_than_days: int) -> bool:
    """Queue a run if none was created in the last `older_than_days` days."""
    runs = _runs(db, 1)
    last = _parse(runs[0].get("createdAt")) if runs else None
    if last and last > _now() - timedelta(days=older_than_days):
        return False
    try:
        queue_run(db, started_by="schedule")
        return True
    except ResearchError:
        return False


def _client_from_env() -> Any:
    if not os.getenv("ANTHROPIC_API_KEY"):
        raise ResearchError("ANTHROPIC_API_KEY is not configured on the backend", 500)
    import anthropic
    return anthropic.Anthropic(max_retries=2, timeout=600)


def process_next(
    db: Any,
    *,
    client_factory: Callable[[], Any] = _client_from_env,
    deadline_seconds: float = DEFAULT_DEADLINE_SECONDS,
    clock: Callable[[], float] = time.monotonic,
) -> dict | None:
    """Run the oldest queued research run. Returns the finished run, or None when idle."""
    runs = _runs(db, 10)
    _expire_stale(db, runs)
    queued = sorted((r for r in runs if r.get("status") == "queued"), key=lambda r: r.get("createdAt") or "")
    if not queued or any(r.get("status") == "running" for r in runs):
        return None
    run = queued[0]
    ref = db.collection(COLLECTION).document(run["runId"])
    ref.set({"status": "running", "startedAt": _iso()}, merge=True)
    deadline = clock() + deadline_seconds

    try:
        result = _execute(db, client_factory=client_factory, deadline=deadline, clock=clock)
    except ResearchError as e:
        result = {"status": "failed", "error": e.message}
    except Exception as e:  # keep the run record honest whatever happens
        logger.error("predictor research failed: %s", e)
        result = {"status": "failed", "error": f"{type(e).__name__}: {e}"}
    result["finishedAt"] = _iso()
    ref.set(result, merge=True)
    return {**run, **result}


def _execute(db: Any, *, client_factory, deadline: float, clock) -> dict:
    participants = ps.load_participants(db)
    categories = ps.load_categories(db)
    config = ps.load_config(db)
    min_rides = ps.division_agent_settings(db)["minZwiftRides"]

    def read_curve(doc_id: str, days: int) -> dict | None:
        try:
            return read_cached_curve(db, doc_id, days)
        except Exception:
            return None

    riders = pt.build_eval_set(participants, read_curve, min_rides=min_rides, categories=categories)
    if len(riders) < pt.MIN_EVAL_RIDERS:
        return {"status": "failed", "error": (
            f"Only {len(riders)} riders have a reliable vELO and a cached Strava curve "
            f"(need {pt.MIN_EVAL_RIDERS}). Let the Strava cache fill first.")}
    baseline, per_rider = pt.cross_validate(participants, riders, config, categories=categories)
    if baseline is None:
        return {"status": "failed", "error": "Could not measure the current settings (no model)."}

    dataset = build_dataset(participants, riders, per_rider, read_curve, categories=categories)
    model = _research_model(db)
    client = client_factory()
    file_ids = []
    try:
        for name, data in dataset["files"].items():
            meta = client.files.upload(file=(name, data, "text/csv"), expires_in_seconds=FILE_TTL_SECONDS)
            file_ids.append(meta.id)
        note = (f"Our own measurement of the baseline: {baseline.divisionAccuracy}% right division, "
                f"MAE {baseline.maeVelo} vELO points, over {baseline.n} eval riders.")
        outcome = run_claude(client, model=model, file_ids=file_ids, baseline_note=note,
                             deadline=deadline, clock=clock)
    finally:
        for fid in file_ids:
            try:
                client.files.delete(fid)
            except Exception:
                pass

    result: dict = {
        "status": outcome["status"],
        "model": model,
        "usage": outcome.get("usage"),
        "evalRiders": dataset["counts"]["eval"],
        "trainingRiders": dataset["counts"]["training"],
        "baseline": baseline.to_dict(),
        "config": config.to_dict(),
        "idMap": dataset["idMap"],
    }
    if outcome.get("error"):
        result["error"] = outcome["error"]
    if outcome.get("lastText"):
        result["lastText"] = outcome["lastText"][:4000]
    findings = outcome.get("findings")
    if findings:
        result["findings"] = findings
        result.update(assess_findings(findings, baseline))
    return result


def assess_findings(findings: dict, baseline: pt.Score) -> dict:
    """Server-side check of Claude's numbers before anything is called a proposal."""
    claimed_base = vp.to_float(findings.get("baselineDivisionAccuracy"))
    best = vp.to_float(findings.get("bestDivisionAccuracy"))
    reproduced = claimed_base is not None and abs(claimed_base - baseline.divisionAccuracy) <= 1.0
    improvement = round((best or 0) - baseline.divisionAccuracy, 1) if best is not None else 0.0
    is_proposal = bool(
        findings.get("improved") and reproduced and improvement >= pt.MIN_IMPROVEMENT_PP
        and str(findings.get("proposedCode") or "").strip()
    )
    return {
        "baselineReproduced": reproduced,
        "improvementPP": improvement,
        "outcome": "proposal" if is_proposal else "report",
    }
