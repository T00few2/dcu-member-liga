"""
Admin routes for scheduled/manual ZwiftRacing and Zwift profile refresh tasks.
"""

from typing import Any
import logging
import time

from flask import jsonify, request
from firebase_admin import firestore

from authz import AuthzError, require_admin, require_scheduler
from extensions import db, get_zwift_service, zr_service
from routes.admin import admin_bp
from routes.integration import _competition_metrics_to_profile, _power_profile_to_firestore
from services.category_engine import effective_rating
from services.liga_categories_core import (
    _compute_liga_update,
    _load_liga_settings,
    _resolve_categories,
)
from services.schema_validation import (
    log_schema_issues,
    validate_user_doc,
    with_schema_version,
)
from services.zwift_tokens import (
    get_token_doc,
    get_valid_access_token,
    resolve_canonical_user_doc_id,
)
from services.zwiftracing import RateLimitError

logger = logging.getLogger(__name__)

# Firestore batch write limit (hard limit is 500; we use 400 for safety).
_FIRESTORE_BATCH_SIZE = 400


@admin_bp.route("/admin/refresh-zr-stats", methods=["POST"])
def refresh_zr_stats():
    """Refresh ZwiftRacing stats for every fully registered rider."""
    scheduler_ok = False
    try:
        require_scheduler(request)
        scheduler_ok = True
    except AuthzError:
        pass

    if not scheduler_ok:
        try:
            require_admin(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        docs = db.collection("users").where("registration.status", "==", "complete").stream()

        riders: dict[str, firestore.DocumentReference] = {}
        rider_labels: dict[str, str] = {}
        for doc in docs:
            data = doc.to_dict() or {}
            zwift_id = str(data.get("zwiftId", "")).strip()
            if zwift_id:
                riders[zwift_id] = doc.reference
                rider_labels[zwift_id] = zwift_id

        if not riders:
            return jsonify({"message": "No registered riders found", "updated": 0}), 200

        zwift_ids: list[int] = []
        for zid in riders.keys():
            try:
                zwift_ids.append(int(zid))
            except (ValueError, TypeError):
                logger.warning("ZR nightly refresh: skipping non-integer zwiftId %r", zid)

        if not zwift_ids:
            return jsonify({"message": "No valid numeric zwiftIds found", "updated": 0}), 200

        logger.info(
            "ZR nightly refresh: fetching stats for %s riders (%s skipped non-numeric)",
            len(zwift_ids),
            len(riders) - len(zwift_ids),
        )

        _ZR_BATCH_LIMIT = 1000
        zr_by_id: dict[str, Any] = {}
        for chunk_start in range(0, len(zwift_ids), _ZR_BATCH_LIMIT):
            chunk = zwift_ids[chunk_start: chunk_start + _ZR_BATCH_LIMIT]
            try:
                batch_response = zr_service.get_riders_batch(chunk)
            except RateLimitError as exc:
                logger.error("ZR API rate limit hit during batch call: %s", exc)
                return jsonify({"message": "ZR API rate limit exceeded - retry later", "updated": 0}), 503

            if not batch_response:
                logger.error(
                    "ZR batch call returned no data for chunk [%s:%s]",
                    chunk_start,
                    chunk_start + len(chunk),
                )
                return jsonify({"message": "ZR batch call returned no data", "updated": 0}), 502

            if isinstance(batch_response, list):
                for r in batch_response:
                    if not isinstance(r, dict):
                        continue
                    key = str(r.get("riderId", r.get("zwiftId", "")))
                    if key:
                        zr_by_id[key] = r
            elif isinstance(batch_response, dict):
                inner = batch_response.get("data", batch_response)
                if isinstance(inner, list):
                    for r in inner:
                        if not isinstance(r, dict):
                            continue
                        key = str(r.get("riderId", r.get("zwiftId", "")))
                        if key:
                            zr_by_id[key] = r
                else:
                    for k, v in inner.items():
                        zr_by_id[str(k)] = v
            else:
                logger.error("Unexpected ZR batch response type: %s", type(batch_response))
                return jsonify({"message": "Unexpected ZR response format", "updated": 0}), 502

        liga_settings = _load_liga_settings(db)
        nightly_grace = liga_settings["gracePeriod"]
        nightly_categories = _resolve_categories(liga_settings)

        liga_by_doc_id: dict[str, dict] = {}
        for doc in db.collection("users").where("registration.status", "==", "complete").stream():
            d = doc.to_dict() or {}
            lc = d.get("ligaCategory")
            if lc:
                liga_by_doc_id[doc.id] = lc

        updated = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0
        skipped_ids: list[str] = []

        for zwift_id, user_ref in riders.items():
            rider_label = rider_labels.get(zwift_id, user_ref.id)
            rider_data = zr_by_id.get(zwift_id)
            if not rider_data:
                skipped += 1
                skipped_ids.append(zwift_id)
                continue

            data = rider_data if "race" in rider_data else (rider_data.get("data") or {})
            race = data.get("race") or {}
            new_current = (race.get("current") or {}).get("rating", "N/A")
            new_max30 = (race.get("max30") or {}).get("rating", "N/A")
            new_max90 = (race.get("max90") or {}).get("rating", "N/A")
            eff_rating = effective_rating(new_current, new_max30, new_max90)

            zr_update = {
                "zwiftRacing": {
                    "currentRating": new_current,
                    "max30Rating": new_max30,
                    "max90Rating": new_max90,
                    "phenotype": (data.get("phenotype") or {}).get("value", "N/A"),
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }
            }

            liga_update: dict = {}
            if eff_rating is not None:
                try:
                    liga_update = _compute_liga_update(
                        eff_rating,
                        liga_by_doc_id.get(user_ref.id),
                        nightly_grace,
                        nightly_categories,
                    )
                except Exception:
                    logger.warning("Could not update category metadata for %s", rider_label, exc_info=True)

            user_update = with_schema_version({**zr_update, **liga_update})
            log_schema_issues(
                logger,
                f"users/{user_ref.id} (zr nightly)",
                validate_user_doc(user_update, partial=True),
            )
            batch.update(user_ref, user_update)
            updated += 1
            batch_count += 1

            if batch_count >= _FIRESTORE_BATCH_SIZE:
                batch.commit()
                batch = db.batch()
                batch_count = 0

        if batch_count > 0:
            batch.commit()

        if skipped_ids:
            logger.info("ZR nightly refresh: %s rider(s) skipped (no ZR data): %s", skipped, skipped_ids)
        logger.info("ZR nightly refresh complete: %s updated, %s skipped", updated, skipped)
        return (
            jsonify(
                {
                    "message": "ZR stats refresh complete",
                    "total": len(riders),
                    "updated": updated,
                    "skipped": skipped,
                    "skippedIds": skipped_ids,
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("ZR nightly refresh error: %s", e, exc_info=True)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/refresh-zwift-profile", methods=["POST"])
def refresh_zwift_profile():
    """Backfill competition metrics and webhook subscriptions for users with Zwift token."""
    scheduler_ok = False
    try:
        require_scheduler(request)
        scheduler_ok = True
    except AuthzError:
        pass

    if not scheduler_ok:
        try:
            require_admin(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    try:
        body = request.get_json(silent=True) or {}
        raw_chunk_size = body.get("chunkSize", request.args.get("chunkSize", 25))
        raw_cursor = body.get("cursor", request.args.get("cursor"))

        try:
            chunk_size = int(raw_chunk_size)
        except (TypeError, ValueError):
            chunk_size = 25
        chunk_size = max(1, min(chunk_size, 200))
        cursor = str(raw_cursor).strip() if raw_cursor is not None else ""
        raw_max_seconds = body.get("maxSeconds", request.args.get("maxSeconds", 45))
        try:
            max_seconds = int(raw_max_seconds)
        except (TypeError, ValueError):
            max_seconds = 45
        max_seconds = max(10, min(max_seconds, 240))
        subscribe = bool(
            body.get("subscribe", request.args.get("subscribe", "false")).__str__().lower()
            in ("1", "true", "yes", "on")
        )

        zwift_service = get_zwift_service()
        token_query = db.collection("zwift_tokens").order_by("__name__")
        if cursor:
            cursor_ref = db.collection("zwift_tokens").document(cursor)
            token_query = token_query.where("__name__", ">", cursor_ref)
        token_docs = list(token_query.limit(chunk_size + 1).stream())

        if not token_docs:
            return (
                jsonify(
                    {
                        "message": "No Zwift token documents found",
                        "updated": 0,
                        "skipped": 0,
                        "errors": 0,
                        "processed": 0,
                        "chunkSize": chunk_size,
                        "nextCursor": None,
                        "done": True,
                    }
                ),
                200,
            )
        chunk_docs = token_docs[:chunk_size]

        updated = 0
        skipped = 0
        errors = 0
        processed = 0
        timed_out = False
        last_processed_id = None
        started_at = time.monotonic()

        for token_doc in chunk_docs:
            elapsed = time.monotonic() - started_at
            if elapsed >= max_seconds:
                timed_out = True
                break

            token_owner_id = token_doc.id
            user_doc_id = resolve_canonical_user_doc_id(token_owner_id) or token_owner_id
            try:
                access_token = get_valid_access_token(token_owner_id, zwift_service)
                if not access_token:
                    skipped += 1
                    processed += 1
                    last_processed_id = token_doc.id
                    continue

                user_ref = db.collection("users").document(user_doc_id)
                if not user_ref.get().exists:
                    logger.warning(
                        "Skipping token %s: could not resolve user doc %s",
                        token_owner_id,
                        user_doc_id,
                    )
                    skipped += 1
                    processed += 1
                    last_processed_id = token_doc.id
                    continue

                profile = zwift_service.get_profile(
                    user_access_token=access_token, include_competition_metrics=True
                )
                if not profile:
                    skipped += 1
                    processed += 1
                    last_processed_id = token_doc.id
                    continue

                competition = profile.get("competitionMetrics") or {}
                update: dict = {
                    "zwiftProfile": _competition_metrics_to_profile(competition, profile),
                    "updatedAt": firestore.SERVER_TIMESTAMP,
                }

                power_profile = zwift_service.get_power_profile(access_token)
                if power_profile:
                    update["zwiftPowerCurve"] = _power_profile_to_firestore(power_profile)

                if token_owner_id != user_doc_id:
                    logger.info(
                        "Resolved token owner %s to user doc %s for profile backfill",
                        token_owner_id,
                        user_doc_id,
                    )
                user_ref.set(with_schema_version(update), merge=True)

                if subscribe:
                    try:
                        zwift_service.subscribe_activity(access_token)
                        zwift_service.subscribe_racing_score(access_token)
                        zwift_service.subscribe_power_curve(access_token)
                    except Exception as sub_exc:
                        logger.warning("Subscription failed for %s: %s", user_doc_id, sub_exc)

                updated += 1
                processed += 1
                last_processed_id = token_doc.id
            except Exception as exc:
                logger.error("refresh-zwift-profile failed for %s: %s", user_doc_id, exc)
                errors += 1
                processed += 1
                last_processed_id = token_doc.id

        has_more_docs = len(token_docs) > chunk_size
        if processed == 0:
            next_cursor = cursor or None
            done = False
        else:
            next_cursor = last_processed_id
            done = (not has_more_docs) and (not timed_out)
            if done:
                next_cursor = None

        logger.info(
            "refresh-zwift-profile chunk complete: updated=%s, skipped=%s, errors=%s, "
            "processed=%s, timedOut=%s, done=%s, nextCursor=%s, subscribe=%s",
            updated,
            skipped,
            errors,
            processed,
            timed_out,
            done,
            next_cursor,
            subscribe,
        )
        return (
            jsonify(
                {
                    "message": "Zwift profile refresh chunk complete",
                    "updated": updated,
                    "skipped": skipped,
                    "errors": errors,
                    "processed": processed,
                    "chunkSize": chunk_size,
                    "maxSeconds": max_seconds,
                    "timedOut": timed_out,
                    "subscribe": subscribe,
                    "cursor": cursor or None,
                    "nextCursor": next_cursor,
                    "done": done,
                }
            ),
            200,
        )
    except Exception as e:
        logger.error("refresh-zwift-profile error: %s", e)
        return jsonify({"message": str(e)}), 500


@admin_bp.route("/admin/debug-power-profile/<zwift_id>", methods=["GET"])
def debug_power_profile(zwift_id):
    """Return raw Zwift power-profile API response (admin or scheduler debug)."""
    scheduler_ok = False
    try:
        require_scheduler(request)
        scheduler_ok = True
    except AuthzError:
        pass

    if not scheduler_ok:
        try:
            require_admin(request)
        except AuthzError as e:
            return jsonify({"message": e.message}), e.status_code

    if not db:
        return jsonify({"error": "DB not available"}), 500

    zwift_service = get_zwift_service()
    token_doc = get_token_doc(zwift_id) or {}
    access_token = get_valid_access_token(zwift_id, zwift_service)
    if not access_token:
        return (
            jsonify(
                {
                    "error": "No valid token for this user",
                    "token_doc": {
                        "exists": bool(token_doc),
                        "scope": token_doc.get("scope"),
                        "zwiftUserId": token_doc.get("zwiftUserId"),
                        "expires_at": token_doc.get("expires_at"),
                    },
                }
            ),
            404,
        )

    response = zwift_service._api_get("/api/link/power-curve/power-profile", token=access_token)
    return (
        jsonify(
            {
                "status_code": response.status_code,
                "body": response.text[:4000],
                "token_doc": {
                    "scope": token_doc.get("scope"),
                    "zwiftUserId": token_doc.get("zwiftUserId"),
                    "expires_at": token_doc.get("expires_at"),
                },
            }
        ),
        200,
    )

