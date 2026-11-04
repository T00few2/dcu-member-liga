"""Division proposals (`division_proposals/{id}`) and applying an admin's decision.

Approving writes exactly what the admin buttons write: predict-assign / manual-assign
for riders who have not raced yet, and the normal category transfer (pens, credited
races, standings; undoable) for riders locked after racing.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from services import liga_assignment
from services import velo_predictor as vp
from services.category_engine import effective_liga_category_name
from services.liga_categories_core import _load_liga_settings, _resolve_categories

logger = logging.getLogger(__name__)

COLLECTION = "division_proposals"
OPEN = ("pending",)
DECIDED = ("approved", "edited", "rejected")


class ProposalError(Exception):
    def __init__(self, message: str, status_code: int = 400):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def all_proposals(db: Any) -> list[dict]:
    return [snap.to_dict() or {} for snap in db.collection(COLLECTION).stream()]


def for_rider(proposals: list[dict], zwift_id: str) -> list[dict]:
    return sorted((p for p in proposals if str(p.get("zwiftId")) == str(zwift_id)),
                  key=lambda p: p.get("createdAt") or "", reverse=True)


def already_handled(proposals: list[dict], zwift_id: str, fingerprint: str) -> bool:
    """True when the rider has an open proposal, or a decided one for the same evidence."""
    for p in for_rider(proposals, zwift_id):
        if p.get("status") in OPEN:
            return True
        if p.get("status") in DECIDED and p.get("evidenceFingerprint") == fingerprint:
            return True
    return False


def create(db: Any, data: dict) -> dict:
    """Store a pending proposal; an older pending one for the same rider is superseded."""
    zwift_id = str(data["zwiftId"])
    for old in for_rider(all_proposals(db), zwift_id):
        if old.get("status") == "pending":
            db.collection(COLLECTION).document(old["id"]).set(
                {"status": "superseded", "decidedAt": _now()}, merge=True)
    proposal = {**data, "id": uuid.uuid4().hex, "status": "pending", "createdAt": _now()}
    db.collection(COLLECTION).document(proposal["id"]).set(proposal)
    return proposal


def list_proposals(db: Any, status: str = "pending", limit: int = 200) -> list[dict]:
    rows = all_proposals(db)
    if status == "pending":
        rows = [p for p in rows if p.get("status") == "pending"]
    else:
        rows = [p for p in rows if p.get("status") != "pending"]
    key = "createdAt" if status == "pending" else "decidedAt"
    return sorted(rows, key=lambda p: p.get(key) or "", reverse=True)[:limit]


def _load(db: Any, proposal_id: str) -> tuple[Any, dict]:
    ref = db.collection(COLLECTION).document(str(proposal_id))
    snap = ref.get()
    if not getattr(snap, "exists", False):
        raise ProposalError("Proposal not found", 404)
    return ref, snap.to_dict() or {}


def _user(db: Any, zwift_id: str) -> tuple[str, dict]:
    snap = db.collection("users").document(str(zwift_id)).get()
    if not getattr(snap, "exists", False):
        raise ProposalError("Rider not found", 404)
    return str(getattr(snap, "id", None) or zwift_id), snap.to_dict() or {}


def _apply(db: Any, proposal: dict, category: str, *, use_prediction: bool) -> dict:
    """Write the division. Returns `{category, transferId?}`."""
    user_doc_id, user_data = _user(db, proposal["zwiftId"])
    lc = user_data.get("ligaCategory") or {}
    categories = _resolve_categories(_load_liga_settings(db))
    current = effective_liga_category_name(lc, categories) or None
    if current != proposal.get("currentCategory"):
        raise ProposalError("stale", 409)
    if lc.get("locked"):
        from services import category_transfer

        try:
            result = category_transfer.apply_move(
                db, user_doc_id=user_doc_id, zwift_id=str(proposal["zwiftId"]),
                user_data=user_data, to_category=category,
            )
        except category_transfer.CategoryTransferError as exc:
            raise ProposalError(str(exc)) from exc
        return {"category": category, "transferId": result.get("transferId")}
    velo = proposal.get("predictedVelo")
    try:
        if use_prediction and velo and vp.category_for_velo(velo, categories) == category:
            liga_assignment.predict_assign(db, user_doc_id, user_data, float(velo))
        else:
            liga_assignment.manual_assign(db, user_doc_id, user_data, category)
    except liga_assignment.AssignmentError as exc:
        raise ProposalError(exc.message, exc.status_code) from exc
    return {"category": category}


def decide(db: Any, proposal_id: str, action: str, *, decided_by: str,
           category: str | None = None, note: str | None = None) -> dict:
    """approve | edit (with `category`) | reject. Returns the updated proposal."""
    ref, proposal = _load(db, proposal_id)
    if proposal.get("status") != "pending":
        raise ProposalError("This proposal has already been decided")
    note = (note or "").strip()[:1000] or None
    update: dict = {"decidedBy": decided_by, "decidedAt": _now(), "decisionNote": note}
    if action == "reject":
        update["status"] = "rejected"
    elif action in ("approve", "edit"):
        target = proposal.get("proposedCategory") if action == "approve" else (category or "").strip()
        if not target:
            raise ProposalError("Choose a division" if action == "edit" else
                                "This proposal has no division; use Edit to choose one")
        try:
            applied = _apply(db, proposal, target, use_prediction=action == "approve")
        except ProposalError as exc:
            if exc.message == "stale":
                ref.set({"status": "superseded", "decidedAt": _now(),
                         "decisionNote": "The rider's division changed since this proposal was made."}, merge=True)
                raise ProposalError("The rider's division changed since this proposal was made; "
                                    "it was marked superseded.", 409) from exc
            raise
        update.update({"status": "approved" if action == "approve" and target == proposal.get("proposedCategory")
                       else "edited", "appliedCategory": applied["category"]})
        if applied.get("transferId"):
            update["transferId"] = applied["transferId"]
    else:
        raise ProposalError("action must be approve, edit or reject")
    ref.set(update, merge=True)
    return {**proposal, **update}
