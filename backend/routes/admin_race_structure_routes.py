"""Admin route to overlay season race-group template onto existing races."""

import logging

from flask import jsonify, request

from authz import AuthzError, require_admin
from extensions import db
from routes.admin import admin_bp
from services.race_structure import (
    overlay_race_groups,
    race_has_results,
    template_category_coverage,
)
from services.schema_validation import log_schema_issues, validate_race_doc, with_schema_version

logger = logging.getLogger(__name__)


@admin_bp.route("/admin/races/enforce-race-structure", methods=["POST"])
def enforce_race_structure():
    """Overlay league defaultRaceGroups onto existing grouped races."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        body = request.get_json(silent=True) or {}
        dry_run = bool(body.get("dryRun", True))
        race_id = str(body.get("raceId") or "").strip() or None
        confirm_results = bool(body.get("confirmResults"))

        settings_doc = db.collection("league").document("settings").get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}
        template = settings.get("defaultRaceGroups") or []
        if not template:
            return jsonify({"message": "No defaultRaceGroups template in league settings"}), 400

        liga_names = [
            str(c.get("name") or "").strip()
            for c in (settings.get("ligaCategories") or [])
            if isinstance(c, dict) and str(c.get("name") or "").strip()
        ]
        coverage = template_category_coverage(template, liga_names)

        races_query = db.collection("races")
        if race_id:
            doc = races_query.document(race_id).get()
            race_docs = [doc] if doc.exists else []
            if not race_docs:
                return jsonify({"message": "Race not found"}), 404
        else:
            race_docs = list(races_query.stream())

        previews = []
        writes = []
        skipped_results = []
        skipped_ungrouped = []

        for race_doc in race_docs:
            race = race_doc.to_dict() or {}
            mode = str(race.get("eventMode") or "").strip().lower()
            groups = race.get("raceGroups")
            if mode != "grouped" and not groups:
                skipped_ungrouped.append({"id": race_doc.id, "name": race.get("name")})
                continue
            if race_has_results(race) and not confirm_results:
                skipped_results.append({"id": race_doc.id, "name": race.get("name")})
                continue
            overlay = overlay_race_groups(template, groups or [])
            previews.append(
                {
                    "id": race_doc.id,
                    "name": race.get("name"),
                    "diff": overlay["diff"],
                    "next": overlay["next"],
                    "hasResults": race_has_results(race),
                    "hasEventId": any(str((g or {}).get("eventId") or "").strip() for g in overlay["next"] if isinstance(g, dict)),
                }
            )
            if overlay["next"] != (groups or []):
                update = with_schema_version({"raceGroups": overlay["next"]})
                log_schema_issues(
                    logger,
                    f"races/{race_doc.id} (enforce race structure)",
                    validate_race_doc(update, partial=True),
                )
                writes.append((race_doc.reference, update))

        payload = {
            "dryRun": dry_run,
            "coverage": coverage,
            "races": [
                {
                    "id": p["id"],
                    "name": p["name"],
                    "diff": p["diff"],
                    "hasResults": p["hasResults"],
                    "hasEventId": p["hasEventId"],
                    "wouldDropEventId": bool(p["diff"].get("droppedEventIds")),
                }
                for p in previews
            ],
            "skippedResults": skipped_results,
            "skippedUngrouped": skipped_ungrouped,
            "syncSignupsReminder": any(p["hasEventId"] for p in previews),
        }

        if not dry_run and coverage["ok"] is False:
            return jsonify({
                "message": "Every liga category must appear in exactly one default race group",
                **payload,
            }), 400

        if dry_run:
            payload["message"] = "Dry run — no writes"
            return jsonify(payload), 200

        batch = db.batch()
        count = 0
        for ref, update in writes:
            batch.set(ref, update, merge=True)
            count += 1
            if count >= 400:
                batch.commit()
                batch = db.batch()
                count = 0
        if count:
            batch.commit()

        payload["applied"] = True
        payload["updated"] = len(writes)
        payload["message"] = f"Race structure enforced on {len(writes)} race(s)"
        return jsonify(payload), 200
    except Exception as e:
        logger.error("Enforce race structure error: %s", e)
        return jsonify({"message": str(e)}), 500
