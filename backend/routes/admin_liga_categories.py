"""
Admin: Liga category management and nightly ZwiftRacing stats refresh.

Registered on admin_bp (defined in routes/admin.py).
"""
from flask import request, jsonify
from firebase_admin import firestore

from routes.admin import admin_bp
from authz import require_admin, require_scheduler, AuthzError
from extensions import db, zr_service
from extensions import get_zwift_service
from services.zwift_tokens import get_valid_access_token
from routes.integration import _competition_metrics_to_profile, _power_profile_to_firestore
from services.user_service import UserService
from services.category_engine import (
    build_liga_category,
    compute_category_status,
    reassign_to_next_category,
    serialize_liga_category,
    cats_from_defs,
)
from services.schema_validation import (
    log_schema_issues,
    validate_league_settings_doc,
    validate_user_doc,
    with_schema_version,
)

import logging

logger = logging.getLogger(__name__)

# Firestore batch write limit (hard limit is 500; we use 400 for safety).
_FIRESTORE_BATCH_SIZE = 400


# ---------------------------------------------------------------------------
# Shared helpers
# ---------------------------------------------------------------------------

def _load_liga_settings(db_client) -> dict:
    """Load league settings; return gracePeriod and categories."""
    try:
        doc = db_client.collection('league').document('settings').get()
        s = doc.to_dict() if doc.exists else {}
    except Exception:
        s = {}
    return {
        'gracePeriod': int(s.get('gracePeriod', 35)),
        'categories': s.get('ligaCategories'),
    }


def _resolve_categories(settings: dict):
    """Return a CategoryList from settings, or None to fall back to ZR_CATEGORIES default."""
    defs = settings.get('categories')
    if defs and isinstance(defs, list) and len(defs) >= 2:
        try:
            return cats_from_defs(defs)
        except Exception:
            pass
    return None


# ---------------------------------------------------------------------------
# Nightly ZwiftRacing stats refresh
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/refresh-zr-stats', methods=['POST'])
def refresh_zr_stats():
    """
    Refresh ZwiftRacing stats for every fully registered rider.

    Accepts either a valid scheduler secret (X-Scheduler-Token) or an admin
    Firebase token — whichever the caller provides.
    """
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
            return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        # Build zwiftId → user document reference map.
        riders: dict[str, firestore.DocumentReference] = {}
        rider_labels: dict[str, str] = {}
        for doc in docs:
            data = doc.to_dict() or {}
            zwift_id = str(data.get('zwiftId', '')).strip()
            if zwift_id:
                riders[zwift_id] = doc.reference
                rider_labels[zwift_id] = zwift_id

        if not riders:
            return jsonify({'message': 'No registered riders found', 'updated': 0}), 200

        logger.info(f"ZR nightly refresh: fetching stats for {len(riders)} riders")

        zwift_ids = [int(zid) for zid in riders.keys()]
        batch_response = zr_service.get_riders_batch(zwift_ids)

        if not batch_response:
            return jsonify({'message': 'ZR batch call returned no data', 'updated': 0}), 502

        # Normalise the ZR response to { zwiftId_str: rider_data }.
        if isinstance(batch_response, list):
            zr_by_id = {
                str(r.get('riderId', r.get('zwiftId', ''))): r
                for r in batch_response
            }
        elif isinstance(batch_response, dict):
            inner = batch_response.get('data', batch_response)
            if isinstance(inner, list):
                zr_by_id = {str(r.get('riderId', r.get('zwiftId', ''))): r for r in inner}
            else:
                zr_by_id = {str(k): v for k, v in inner.items()}
        else:
            logger.error(f"Unexpected ZR batch response type: {type(batch_response)}")
            return jsonify({'message': 'Unexpected ZR response format', 'updated': 0}), 502

        # Load league settings once for all updates.
        liga_settings = _load_liga_settings(db)
        nightly_grace = liga_settings['gracePeriod']
        nightly_categories = _resolve_categories(liga_settings)

        # Pre-fetch ligaCategory for all registered riders.
        liga_by_doc_id: dict[str, dict] = {}
        for doc in (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        ):
            d = doc.to_dict() or {}
            lc = d.get('ligaCategory')
            if lc:
                liga_by_doc_id[doc.id] = lc

        updated = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0

        for zwift_id, user_ref in riders.items():
            rider_label = rider_labels.get(zwift_id, user_ref.id)
            rider_data = zr_by_id.get(zwift_id)
            if not rider_data:
                skipped += 1
                continue

            data = rider_data if 'race' in rider_data else rider_data.get('data', {})
            race = data.get('race', {})
            new_max30 = race.get('max30', {}).get('rating', 'N/A')

            zr_update = {
                'zwiftRacing': {
                    'currentRating': race.get('current', {}).get('rating', 'N/A'),
                    'max30Rating':   new_max30,
                    'max90Rating':   race.get('max90', {}).get('rating', 'N/A'),
                    'phenotype':     data.get('phenotype', {}).get('value', 'N/A'),
                    'updatedAt':     firestore.SERVER_TIMESTAMP,
                }
            }

            liga_update: dict = {}
            if new_max30 != 'N/A':
                try:
                    lc = liga_by_doc_id.get(user_ref.id)
                    if lc:
                        auto = lc.get('autoAssigned') or {}
                        if lc.get('locked'):
                            new_status = compute_category_status(
                                int(new_max30),
                                auto.get('upperBoundary'),
                                auto.get('graceLimit'),
                            )
                            liga_update = {
                                'ligaCategory.autoAssigned.status': new_status,
                                'ligaCategory.autoAssigned.lastCheckedRating': int(new_max30),
                                'ligaCategory.autoAssigned.lastCheckedAt': firestore.SERVER_TIMESTAMP,
                            }
                        else:
                            new_auto = build_liga_category(
                                int(new_max30), nightly_grace, nightly_categories
                            )
                            new_auto['assignedRating'] = auto.get('assignedRating', int(new_max30))
                            new_auto['assignedAt'] = auto.get('assignedAt')
                            new_auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP
                            liga_update = {'ligaCategory.autoAssigned': new_auto}
                    else:
                        new_auto = build_liga_category(
                            int(new_max30), nightly_grace, nightly_categories
                        )
                        new_auto['assignedAt'] = firestore.SERVER_TIMESTAMP
                        new_auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP
                        liga_update = {
                            'ligaCategory': {
                                'autoAssigned': new_auto,
                                'locked': False,
                            }
                        }
                except Exception:
                    logger.warning(f"Could not update category metadata for {rider_label}", exc_info=True)
                    pass

            user_update = with_schema_version({**zr_update, **liga_update})
            log_schema_issues(logger, f"users/{user_ref.id} (zr nightly)", validate_user_doc(user_update, partial=True))
            batch.update(user_ref, user_update)
            updated += 1
            batch_count += 1

            if batch_count >= _FIRESTORE_BATCH_SIZE:
                batch.commit()
                batch = db.batch()
                batch_count = 0

        if batch_count > 0:
            batch.commit()

        logger.info(
            f"ZR nightly refresh complete: {updated} updated, {skipped} skipped (no ZR data)"
        )
        return jsonify({
            'message': 'ZR stats refresh complete',
            'total': len(riders),
            'updated': updated,
            'skipped': skipped,
        }), 200

    except Exception as e:
        logger.error(f"ZR nightly refresh error: {e}")
        return jsonify({'message': str(e)}), 500


# ---------------------------------------------------------------------------
# Backfill Zwift profile (competition metrics + subscriptions)
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/refresh-zwift-profile', methods=['POST'])
def refresh_zwift_profile():
    """
    Backfill competition metrics and webhook subscriptions for all users
    that have a stored Zwift token.

    For each user:
    - Re-fetches GET /api/link/racing-profile?includeCompetitionMetrics=true
    - Updates zwiftProfile with all CompetitionMetrics fields
    - Subscribes to activity and racing-score webhooks

    Safe to run multiple times (idempotent).
    Accepts scheduler token or admin Firebase token.
    """
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
            return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        zwift_service = get_zwift_service()
        token_docs = list(db.collection('zwift_tokens').stream())

        if not token_docs:
            return jsonify({'message': 'No Zwift token documents found', 'updated': 0}), 200

        updated = 0
        skipped = 0
        errors = 0

        for token_doc in token_docs:
            user_doc_id = token_doc.id
            try:
                access_token = get_valid_access_token(user_doc_id, zwift_service)
                if not access_token:
                    skipped += 1
                    continue

                profile = zwift_service.get_profile(user_access_token=access_token, include_competition_metrics=True)
                if not profile:
                    skipped += 1
                    continue

                competition = profile.get('competitionMetrics') or {}
                update: dict = {
                    'zwiftProfile': _competition_metrics_to_profile(competition, profile),
                    'updatedAt': firestore.SERVER_TIMESTAMP,
                }

                power_profile = zwift_service.get_power_profile(access_token)
                if power_profile:
                    update['zwiftPowerCurve'] = _power_profile_to_firestore(power_profile)

                db.collection('users').document(user_doc_id).set(with_schema_version(update), merge=True)

                try:
                    zwift_service.subscribe_activity(access_token)
                    zwift_service.subscribe_racing_score(access_token)
                    zwift_service.subscribe_power_curve(access_token)
                except Exception as sub_exc:
                    logger.warning(f"Subscription failed for {user_doc_id}: {sub_exc}")

                updated += 1

            except Exception as exc:
                logger.error(f"refresh-zwift-profile failed for {user_doc_id}: {exc}")
                errors += 1

        logger.info(f"refresh-zwift-profile complete: updated={updated}, skipped={skipped}, errors={errors}")
        return jsonify({'message': 'Zwift profile refresh complete', 'updated': updated, 'skipped': skipped, 'errors': errors}), 200

    except Exception as e:
        logger.error(f"refresh-zwift-profile error: {e}")
        return jsonify({'message': str(e)}), 500


# ---------------------------------------------------------------------------
# Liga category configuration
# ---------------------------------------------------------------------------

@admin_bp.route('/admin/liga-categories/config', methods=['POST'])
def save_liga_categories_config():
    """Save a custom set of liga category definitions to league settings."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        body = request.get_json(silent=True) or {}
        categories = body.get('categories')

        if not categories or not isinstance(categories, list):
            return jsonify({'message': "'categories' must be a non-empty list"}), 400
        if len(categories) < 2:
            return jsonify({'message': 'At least 2 categories are required'}), 400

        for cat in categories:
            name = cat.get('name', '')
            if not isinstance(name, str) or not name.strip():
                return jsonify({'message': 'Each category must have a non-empty name'}), 400
            upper = cat.get('upper')
            if upper is not None and not isinstance(upper, (int, float)):
                return jsonify({'message': 'upper must be a number or null'}), 400

        null_upper_count = sum(1 for c in categories if c.get('upper') is None)
        if null_upper_count != 1:
            return jsonify({'message': 'Exactly one category must have upper=null (the top)'}), 400
        if categories[0].get('upper') is not None:
            return jsonify({'message': 'The category with upper=null must be first'}), 400

        uppers = [c['upper'] for c in categories[1:]]
        for i in range(len(uppers) - 1):
            if uppers[i] is not None and uppers[i + 1] is not None and uppers[i] <= uppers[i + 1]:
                return jsonify({'message': 'Upper boundaries must be strictly decreasing'}), 400

        normalised = [
            {
                'name': c['name'].strip(),
                'upper': int(c['upper']) if c.get('upper') is not None else None,
            }
            for c in categories
        ]

        settings_update = with_schema_version({'ligaCategories': normalised})
        log_schema_issues(
            logger,
            "league/settings (liga categories config)",
            validate_league_settings_doc(settings_update, partial=True),
        )
        db.collection('league').document('settings').set(settings_update, merge=True)
        return jsonify({'message': 'Category configuration saved', 'count': len(normalised)}), 200

    except Exception as e:
        logger.error(f"Save liga categories config error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/assign-liga-categories', methods=['POST'])
def assign_liga_categories():
    """Bulk-assign liga categories to all registered riders from their max30 vELO."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        body = request.get_json(silent=True) or {}

        settings_doc = db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}

        grace_period = int(body.get('gracePeriod', settings.get('gracePeriod', 35)))
        cat_defs = body.get('categories') or settings.get('ligaCategories')
        categories = cats_from_defs(cat_defs) if cat_defs else None

        settings_update = with_schema_version({'gracePeriod': grace_period})
        log_schema_issues(
            logger,
            "league/settings (gracePeriod)",
            validate_league_settings_doc(settings_update, partial=True),
        )
        db.collection('league').document('settings').set(settings_update, merge=True)

        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        assigned = 0
        skipped = 0
        batch = db.batch()
        batch_count = 0

        for doc in docs:
            data = doc.to_dict() or {}
            max30 = data.get('zwiftRacing', {}).get('max30Rating', 'N/A')

            if max30 == 'N/A' or max30 is None:
                skipped += 1
                continue

            try:
                auto = build_liga_category(int(max30), grace_period, categories)
                auto['assignedAt'] = firestore.SERVER_TIMESTAMP
                auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP

                user_update = with_schema_version({'ligaCategory': {'autoAssigned': auto, 'locked': False}})
                log_schema_issues(logger, f"users/{doc.id} (bulk assign liga)", validate_user_doc(user_update, partial=True))
                batch.set(doc.reference, user_update, merge=True)
                assigned += 1
                batch_count += 1

                if batch_count >= _FIRESTORE_BATCH_SIZE:
                    batch.commit()
                    batch = db.batch()
                    batch_count = 0
            except Exception as ex:
                logger.warning(f"Could not assign category for {doc.id}: {ex}")
                skipped += 1

        if batch_count > 0:
            batch.commit()

        logger.info(f"Liga category assignment: {assigned} assigned, {skipped} skipped")
        return jsonify({
            'message': 'Liga categories assigned',
            'gracePeriod': grace_period,
            'assigned': assigned,
            'skipped': skipped,
        }), 200

    except Exception as e:
        logger.error(f"Liga category assignment error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/liga-categories', methods=['GET'])
def get_liga_categories():
    """Return all registered riders with their ligaCategory data."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        riders = []
        for doc in docs:
            data = doc.to_dict() or {}
            lc = serialize_liga_category(data.get('ligaCategory'))
            zr = data.get('zwiftRacing', {})
            riders.append({
                'zwiftId': data.get('zwiftId', ''),
                'name': data.get('name', ''),
                'club': data.get('club', ''),
                'max30Rating': zr.get('max30Rating', 'N/A'),
                'ligaCategory': lc,
            })

        status_order = {'over': 0, 'grace': 1, 'ok': 2}
        riders.sort(
            key=lambda r: status_order.get(
                (r.get('ligaCategory') or {}).get('status', ''), 3
            )
        )
        return jsonify({'riders': riders}), 200

    except Exception as e:
        logger.error(f"Get liga categories error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/liga-categories/<zwift_id>/reassign', methods=['POST'])
def reassign_liga_category(zwift_id):
    """Manually move a rider up to the next category tier."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        user = UserService.get_user_by_id(zwift_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        data = user._data
        lc = data.get('ligaCategory')
        if not lc:
            return jsonify({'message': 'Rider has no assigned liga category'}), 400

        liga_settings = _load_liga_settings(db)
        grace_period = liga_settings['gracePeriod']
        categories = _resolve_categories(liga_settings)

        max30 = data.get('zwiftRacing', {}).get('max30Rating', 'N/A')
        if max30 == 'N/A':
            return jsonify({'message': 'Rider has no max30Rating'}), 400

        auto = lc.get('autoAssigned') or {}
        current_cat = auto.get('category')

        update_fields = reassign_to_next_category(current_cat, int(max30), grace_period, categories)
        update_fields['lastCheckedAt'] = firestore.SERVER_TIMESTAMP

        new_auto = {**auto, **update_fields}
        doc_update = {'ligaCategory.autoAssigned': new_auto}
        if lc.get('locked'):
            doc_update['ligaCategory.category'] = update_fields['category']

        user_update = with_schema_version(doc_update)
        log_schema_issues(logger, f"users/{user.id} (manual reassign)", validate_user_doc(user_update, partial=True))
        db.collection('users').document(str(user.id)).update(user_update)

        return jsonify({
            'message': f"Rider moved to {update_fields['category']}",
            'category': update_fields['category'],
            'status': update_fields['status'],
        }), 200

    except Exception as e:
        logger.error(f"Reassign liga category error: {e}")
        return jsonify({'message': str(e)}), 500
