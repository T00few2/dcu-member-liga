"""Season event (stageRaces) CRUD, stage attach/order, and event finalize APIs."""
from __future__ import annotations

import logging
from typing import Any

from flask import Blueprint, jsonify, request
from firebase_admin import firestore

from authz import AuthzError, require_admin
from extensions import db
from services.request_models import (
    StageRaceCreateRequest,
    StageRaceStagesRequest,
    StageRaceUpdateRequest,
    parse_body,
)
from services.results.constants import RESULTS_PHASE_PROVISIONAL
from services.results_processor import ResultsProcessor
from services.results.stage_race_ops import (
    finalize_event,
    load_races_by_id,
    recompute_and_save_event_gc,
    stages_for_event,
    unfinalize_event,
)
from services.schema_validation import with_schema_version

logger = logging.getLogger(__name__)

stage_races_bp = Blueprint("stage_races", __name__)


def _require_admin():
    require_admin(request)


def _event_payload(event_id: str, data: dict[str, Any], stages: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    out = {**data, "id": event_id}
    if stages is not None:
        out["stages"] = [
            {
                "id": s.get("id"),
                "name": s.get("name"),
                "date": s.get("date"),
                "stageIndex": s.get("stageIndex"),
                "resultsPhase": s.get("resultsPhase"),
                "type": s.get("type"),
            }
            for s in stages
        ]
    return out


@stage_races_bp.route("/stage-races", methods=["GET"])
def list_stage_races():
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        races_by_id = load_races_by_id(db)
        events = []
        for doc in db.collection("stageRaces").stream():
            data = doc.to_dict() or {}
            stages = stages_for_event(races_by_id, doc.id)
            events.append(_event_payload(doc.id, data, stages))
        events.sort(key=lambda e: (str(e.get("name") or ""), str(e.get("id") or "")))
        return jsonify({"stageRaces": events}), 200
    except Exception as e:
        logger.error("List stage races error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races/<event_id>", methods=["GET"])
def get_stage_race(event_id: str):
    if not db:
        return jsonify({"error": "DB not available"}), 500
    try:
        doc = db.collection("stageRaces").document(event_id).get()
        if not doc.exists:
            return jsonify({"message": "Stage race not found"}), 404
        races_by_id = load_races_by_id(db)
        stages = stages_for_event(races_by_id, event_id)
        return jsonify({"stageRace": _event_payload(event_id, doc.to_dict() or {}, stages)}), 200
    except Exception as e:
        logger.error("Get stage race error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races", methods=["POST"])
def create_stage_race():
    try:
        _require_admin()
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    body, err = parse_body(StageRaceCreateRequest, request.get_json(silent=True) or {})
    if err:
        return err

    try:
        payload = with_schema_version({
            "name": body.name,
            "seasonClass": body.seasonClass,
            "bestRacesCount": body.bestRacesCount,
            "resultsPhase": RESULTS_PHASE_PROVISIONAL,
            "standings": {},
            "updatedAt": firestore.SERVER_TIMESTAMP,
        })
        _, ref = db.collection("stageRaces").add(payload)
        # Do not echo SERVER_TIMESTAMP sentinels in the JSON response.
        return jsonify({
            "message": "Stage race created",
            "id": ref.id,
            "stageRace": {
                "id": ref.id,
                "name": body.name,
                "seasonClass": body.seasonClass,
                "bestRacesCount": body.bestRacesCount,
                "resultsPhase": RESULTS_PHASE_PROVISIONAL,
                "standings": {},
                "stages": [],
            },
        }), 201
    except Exception as e:
        logger.error("Create stage race error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races/<event_id>", methods=["PUT"])
def update_stage_race(event_id: str):
    try:
        _require_admin()
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    body, err = parse_body(StageRaceUpdateRequest, request.get_json(silent=True) or {})
    if err:
        return err

    try:
        ref = db.collection("stageRaces").document(event_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({"message": "Stage race not found"}), 404

        update: dict[str, Any] = {"updatedAt": firestore.SERVER_TIMESTAMP}
        if body.name is not None:
            update["name"] = body.name.strip()
        if body.seasonClass is not None:
            update["seasonClass"] = body.seasonClass
        if body.bestRacesCount is not None:
            update["bestRacesCount"] = body.bestRacesCount

        ref.set(with_schema_version(update), merge=True)

        if body.bestRacesCount is not None:
            settings = (db.collection("league").document("settings").get().to_dict() or {})
            races_by_id = load_races_by_id(db)
            event = {**(doc.to_dict() or {}), **update, "id": event_id}
            recompute_and_save_event_gc(db, event, races_by_id, settings)
            ResultsProcessor(db, None, None).recalculate_season_standings()

        races_by_id = load_races_by_id(db)
        fresh = ref.get().to_dict() or {}
        return jsonify({
            "message": "Stage race updated",
            "stageRace": _event_payload(event_id, fresh, stages_for_event(races_by_id, event_id)),
        }), 200
    except Exception as e:
        logger.error("Update stage race error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races/<event_id>", methods=["DELETE"])
def delete_stage_race(event_id: str):
    try:
        _require_admin()
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        ref = db.collection("stageRaces").document(event_id)
        if not ref.get().exists:
            return jsonify({"message": "Stage race not found"}), 404

        races_by_id = load_races_by_id(db)
        for stage in stages_for_event(races_by_id, event_id):
            rid = str(stage.get("id") or "")
            if rid:
                db.collection("races").document(rid).set(
                    {"stageRaceId": firestore.DELETE_FIELD, "stageIndex": firestore.DELETE_FIELD},
                    merge=True,
                )

        ref.delete()
        ResultsProcessor(db, None, None).recalculate_season_standings()
        return jsonify({"message": "Stage race deleted"}), 200
    except Exception as e:
        logger.error("Delete stage race error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races/<event_id>/stages", methods=["PUT"])
def set_stage_race_stages(event_id: str):
    """
    Replace stage attachment/order.
    Body: { "stages": [ {"raceId": "...", "stageIndex": 1}, ... ] }
    """
    try:
        _require_admin()
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    body, err = parse_body(StageRaceStagesRequest, request.get_json(silent=True) or {})
    if err:
        return err

    try:
        ref = db.collection("stageRaces").document(event_id)
        event_doc = ref.get()
        if not event_doc.exists:
            return jsonify({"message": "Stage race not found"}), 404

        if str((event_doc.to_dict() or {}).get("resultsPhase") or "").lower() == "finalized":
            return jsonify({
                "message": "Un-finalize the event before changing stages",
            }), 409

        desired: list[tuple[str, int]] = []
        for i, item in enumerate(body.stages or []):
            if not isinstance(item, dict):
                return jsonify({"message": "each stage must be an object"}), 400
            race_id = str(item.get("raceId") or "").strip()
            if not race_id:
                return jsonify({"message": "raceId is required for each stage"}), 400
            try:
                idx = int(item.get("stageIndex") if item.get("stageIndex") is not None else i + 1)
            except (TypeError, ValueError):
                return jsonify({"message": "stageIndex must be an integer"}), 400
            desired.append((race_id, idx))

        races_by_id = load_races_by_id(db)
        desired_ids = {rid for rid, _ in desired}

        # Detach races no longer in the list
        for stage in stages_for_event(races_by_id, event_id):
            rid = str(stage.get("id") or "")
            if rid and rid not in desired_ids:
                db.collection("races").document(rid).set(
                    {"stageRaceId": firestore.DELETE_FIELD, "stageIndex": firestore.DELETE_FIELD},
                    merge=True,
                )

        for race_id, idx in desired:
            race_ref = db.collection("races").document(race_id)
            race_doc = race_ref.get()
            if not race_doc.exists:
                return jsonify({"message": f"Race {race_id} not found"}), 404
            existing_parent = str((race_doc.to_dict() or {}).get("stageRaceId") or "")
            if existing_parent and existing_parent != event_id:
                return jsonify({
                    "message": f"Race {race_id} is already attached to another event",
                }), 409
            race_ref.set(
                {"stageRaceId": event_id, "stageIndex": idx, "updatedAt": firestore.SERVER_TIMESTAMP},
                merge=True,
            )

        settings = (db.collection("league").document("settings").get().to_dict() or {})
        races_by_id = load_races_by_id(db)
        event = {**(event_doc.to_dict() or {}), "id": event_id}
        recompute_and_save_event_gc(db, event, races_by_id, settings)
        ResultsProcessor(db, None, None).recalculate_season_standings()

        fresh = ref.get().to_dict() or {}
        return jsonify({
            "message": "Stages updated",
            "stageRace": _event_payload(event_id, fresh, stages_for_event(races_by_id, event_id)),
        }), 200
    except Exception as e:
        logger.error("Set stages error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races/<event_id>/finalize", methods=["POST"])
def finalize_stage_race(event_id: str):
    try:
        _require_admin()
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        ref = db.collection("stageRaces").document(event_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({"message": "Stage race not found"}), 404

        settings = (db.collection("league").document("settings").get().to_dict() or {})
        races_by_id = load_races_by_id(db)
        event = {**(doc.to_dict() or {}), "id": event_id}
        event = finalize_event(db, event, races_by_id, settings)
        standings = ResultsProcessor(db, None, None).recalculate_season_standings()

        return jsonify({
            "message": "Event finalized",
            "stageRace": _event_payload(event_id, event, stages_for_event(races_by_id, event_id)),
            "standings": standings,
        }), 200
    except ValueError as e:
        return jsonify({"message": str(e)}), 409
    except Exception as e:
        logger.error("Finalize event error: %s", e)
        return jsonify({"message": str(e)}), 500


@stage_races_bp.route("/stage-races/<event_id>/unfinalize", methods=["POST"])
def unfinalize_stage_race(event_id: str):
    try:
        _require_admin()
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        ref = db.collection("stageRaces").document(event_id)
        doc = ref.get()
        if not doc.exists:
            return jsonify({"message": "Stage race not found"}), 404

        event = unfinalize_event(db, {**(doc.to_dict() or {}), "id": event_id})
        standings = ResultsProcessor(db, None, None).recalculate_season_standings()
        races_by_id = load_races_by_id(db)
        return jsonify({
            "message": "Event un-finalized",
            "stageRace": _event_payload(event_id, event, stages_for_event(races_by_id, event_id)),
            "standings": standings,
        }), 200
    except Exception as e:
        logger.error("Unfinalize event error: %s", e)
        return jsonify({"message": str(e)}), 500
