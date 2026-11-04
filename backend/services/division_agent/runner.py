"""Scan riders, and process the queue (called by the predictor worker)."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any, Callable

from services import predictor_service as ps
from services.division_agent import assess as assess_mod
from services.division_agent import decide, evidence, proposals, queue, triage

logger = logging.getLogger(__name__)

STATUS_COLLECTION = "division_agent_status"
STATUS_DOC = "last"
WAIT_FOR_STRAVA_MINUTES = 15
MAX_ATTEMPTS = 20


def scan(db: Any, *, participants: list[dict] | None = None) -> int:
    """Queue every rider who needs a look and has no open or already-decided proposal."""
    settings = ps.division_agent_settings(db)
    if not settings["enabled"]:
        return 0
    rows = participants if participants is not None else ps.load_participants(db)
    existing = proposals.all_proposals(db)
    queued_ids = {str(e.get("zwiftId")) for e in queue.entries(db)}
    count = 0
    for row in rows:
        zid = str(row.get("zwiftId") or "")
        if not zid or zid in queued_ids:
            continue
        reasons = triage.needs_review(row, settings)
        if not reasons:
            continue
        if any(p.get("status") == "pending" for p in proposals.for_rider(existing, zid)):
            continue
        queue.enqueue(db, zid, "scan")
        count += 1
    return count


def process_rider(
    db: Any,
    row: dict,
    *,
    settings: dict,
    model_bundle: tuple,
    strava_service: Any,
    compute_curve: Callable[[str, list], dict],
    client_factory: Callable[[], Any] = assess_mod.client_from_env,
    dry_run: bool = False,
    existing: list[dict] | None = None,
) -> dict:
    """Review one rider. Returns `{outcome, proposal?, evidence?}` (outcome: proposed |
    no_change | not_needed | handled). Raises `evidence.WaitingForStrava`."""
    model, _rows, categories = model_bundle
    reasons = triage.needs_review(row, settings)
    if not reasons:
        return {"outcome": "not_needed"}
    snap = db.collection("users").document(str(row.get("userDocId") or row.get("zwiftId"))).get()
    user_data = (snap.to_dict() or {}) if getattr(snap, "exists", False) else {}
    days = model.config.stravaWindowDays if model is not None else 90
    curve = evidence.strava_curve(db, row, days, strava_service=strava_service, compute_curve=compute_curve)
    ev = evidence.gather(row, user_data, model=model, categories=categories, curve_entry=curve, reasons=reasons)
    fp = evidence.fingerprint(ev)
    known = existing if existing is not None else proposals.all_proposals(db)
    if not dry_run and proposals.already_handled(known, str(row["zwiftId"]), fp):
        return {"outcome": "handled", "evidence": ev}
    suggestion = decide.suggest(ev, categories)
    if not decide.needs_proposal(ev, suggestion):
        return {"outcome": "no_change", "evidence": ev, "suggestion": suggestion}
    result = assess_mod.assess(ev, suggestion, model=settings["assessModel"], client_factory=client_factory)
    flags = list(ev["flags"])
    gap = evidence.division_distance(result["proposedCategory"], suggestion.get("category"), categories)
    if gap is not None and gap > 1:
        flags.append("assessment_disagrees")
    data = {
        "zwiftId": str(row["zwiftId"]),
        "name": row.get("name") or "",
        "reasons": reasons,
        "currentCategory": ev["currentCategory"],
        "proposedCategory": result["proposedCategory"],
        "suggestedCategory": suggestion.get("category"),
        "predictedVelo": suggestion.get("velo"),
        "source": suggestion.get("source"),
        "confidence": result["confidence"],
        "flags": flags,
        "evidence": ev,
        "adminRationale": result["adminRationale"],
        "riderExplanation": result["riderExplanation"],
        "author": result["author"],
        "model": result["model"],
        "usage": result["usage"],
        "locked": ev["locked"],
        "movePreview": None,
        "evidenceFingerprint": fp,
    }
    if ev["locked"] and result["proposedCategory"] and result["proposedCategory"] != ev["currentCategory"]:
        data["movePreview"] = _move_preview(db, row, user_data, result["proposedCategory"])
    if dry_run:
        return {"outcome": "proposed", "proposal": data}
    return {"outcome": "proposed", "proposal": proposals.create(db, data)}


def _move_preview(db: Any, row: dict, user_data: dict, to_category: str) -> dict | None:
    try:
        from services import category_transfer

        preview = category_transfer.build_move_preview(
            db, zwift_id=str(row["zwiftId"]), user_data=user_data, to_category=to_category)
        return {k: preview.get(k) for k in ("fromCategory", "toCategory", "races", "skipped",
                                            "standings", "signups", "message")}
    except Exception as exc:
        logger.warning("division agent: move preview failed for %s: %s", row.get("zwiftId"), exc)
        return {"error": str(exc)}


def process_batch(
    db: Any,
    *,
    strava_service: Any,
    compute_curve: Callable[[str, list], dict],
    deadline_seconds: float = 600,
    clock: Callable[[], float] = time.monotonic,
    client_factory: Callable[[], Any] = assess_mod.client_from_env,
) -> dict | None:
    """Work through ready queue entries. None when the agent is off or nothing is ready."""
    settings = ps.division_agent_settings(db)
    if not settings["enabled"]:
        return None
    ready = queue.ready(db)
    if not ready:
        return None
    deadline = clock() + deadline_seconds
    model_bundle = ps.get_model(db)
    by_id = {str(r.get("zwiftId")): r for r in model_bundle[1]}
    counts = {"proposed": 0, "noChange": 0, "waitingForStrava": 0, "failed": 0, "processed": 0}
    existing = proposals.all_proposals(db)  # read once per batch, not once per rider
    for entry in ready[: settings["maxPerRun"]]:
        if clock() >= deadline:
            break
        zid = str(entry.get("zwiftId"))
        if queue.claim(db, zid) is None:
            continue
        row = by_id.get(zid)
        if row is None:  # rider unregistered or deleted
            queue.done(db, zid)
            continue
        try:
            outcome = process_rider(db, row, settings=settings, model_bundle=model_bundle,
                                    strava_service=strava_service, compute_curve=compute_curve,
                                    client_factory=client_factory, existing=existing)
            queue.done(db, zid)
            counts["processed"] += 1
            counts["proposed" if outcome["outcome"] == "proposed" else "noChange"] += 1
        except evidence.WaitingForStrava:
            counts["waitingForStrava"] += 1
            queue.retry_later(db, zid, WAIT_FOR_STRAVA_MINUTES)
        except Exception as exc:
            logger.error("division agent failed for %s: %s", zid, exc)
            counts["failed"] += 1
            if int(entry.get("attempts") or 0) + 1 >= MAX_ATTEMPTS:
                queue.done(db, zid)
            else:
                queue.retry_later(db, zid, 60)
    try:
        db.collection(STATUS_COLLECTION).document(STATUS_DOC).set(
            {**counts, "at": datetime.now(timezone.utc).isoformat()})
    except Exception as exc:
        logger.warning("division agent: could not store run summary: %s", exc)
    return counts


def status(db: Any) -> dict:
    entries = queue.entries(db)
    now = datetime.now(timezone.utc)
    waiting = sum(1 for e in entries if (queue._parse(e.get("notBefore")) or now) > now)
    snap = db.collection(STATUS_COLLECTION).document(STATUS_DOC).get()
    pending = sum(1 for p in proposals.all_proposals(db) if p.get("status") == "pending")
    return {
        "enabled": ps.division_agent_settings(db)["enabled"],
        "queued": len(entries),
        "waiting": waiting,
        "pending": pending,
        "lastRun": (snap.to_dict() or None) if getattr(snap, "exists", False) else None,
    }
