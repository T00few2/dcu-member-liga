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
from services.zwift_tokens import get_valid_access_token, get_token_doc
from routes.integration import _competition_metrics_to_profile, _power_profile_to_firestore
from services.user_service import UserService
from services.category_engine import (
    build_liga_category,
    reassign_to_next_category,
    serialize_liga_category,
    cats_from_defs,
    _effective_cat_name,
    effective_rating,
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


def _resolve_user_doc_id_for_token(token_doc_id: str) -> str:
    """
    Resolve the canonical users/{docId} for a zwift_tokens document ID.

    Historically some token docs were keyed by auth UID while user docs are keyed
    by Zwift ID. This helper maps token-owner IDs to the canonical user doc.
    """
    # 1) auth_mappings/{uid}.zwiftId -> users/{zwiftId} (preferred canonical mapping)
    mapping = db.collection('auth_mappings').document(token_doc_id).get()
    if mapping.exists:
        mapped_zwift_id = str((mapping.to_dict() or {}).get('zwiftId', '')).strip()
        if mapped_zwift_id:
            return mapped_zwift_id

    # 2) Fallback lookup by users.authUid.
    docs = (
        db.collection('users')
        .where('authUid', '==', token_doc_id)
        .limit(1)
        .stream()
    )
    for doc in docs:
        return doc.id

    # 3) Direct users/{id} key if nothing else resolved.
    if db.collection('users').document(token_doc_id).get().exists:
        return token_doc_id

    # No mapping found; caller can decide whether to skip or log.
    return token_doc_id



def _compute_liga_update(eff_rating: int, existing_lc: dict | None, grace_period: int, categories) -> dict:
    """Return the Firestore update dict for ligaCategory fields.

    Single source of truth for all automatic category assignment paths
    (nightly refresh and bulk assign). The individual manual reassign
    uses reassign_to_next_category() and stays separate.
    """
    if existing_lc:
        auto = existing_lc.get('autoAssigned') or {}
        if existing_lc.get('locked'):
            # Locked riders cannot self-select anymore, but their auto-assigned
            # category should still track stronger ratings so obvious under-placement
            # (e.g. Copper while riding Diamond numbers) is corrected automatically.
            new_auto = build_liga_category(eff_rating, grace_period, categories)
            new_auto['assignedRating'] = auto.get('assignedRating', eff_rating)
            new_auto['assignedAt'] = auto.get('assignedAt')
            new_auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP

            locked_effective = _effective_cat_name(
                new_auto.get('category'),
                existing_lc.get('category') or auto.get('category'),
                categories,
            )
            return {
                'ligaCategory.autoAssigned': new_auto,
                'ligaCategory.category': locked_effective,
            }
        else:
            new_auto = build_liga_category(eff_rating, grace_period, categories)
            new_auto['assignedRating'] = auto.get('assignedRating', eff_rating)
            new_auto['assignedAt'] = auto.get('assignedAt')
            new_auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP
            return {'ligaCategory.autoAssigned': new_auto}
    else:
        new_auto = build_liga_category(eff_rating, grace_period, categories)
        new_auto['assignedAt'] = firestore.SERVER_TIMESTAMP
        new_auto['lastCheckedAt'] = firestore.SERVER_TIMESTAMP
        return {'ligaCategory': {'autoAssigned': new_auto, 'locked': False}}


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
            new_current = (race.get('current') or {}).get('rating', 'N/A')
            new_max30 = (race.get('max30') or {}).get('rating', 'N/A')
            new_max90 = (race.get('max90') or {}).get('rating', 'N/A')
            eff_rating = effective_rating(new_current, new_max30, new_max90)

            zr_update = {
                'zwiftRacing': {
                    'currentRating': new_current,
                    'max30Rating':   new_max30,
                    'max90Rating':   new_max90,
                    'phenotype':     (data.get('phenotype') or {}).get('value', 'N/A'),
                    'updatedAt':     firestore.SERVER_TIMESTAMP,
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
                    logger.warning(f"Could not update category metadata for {rider_label}", exc_info=True)

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
            token_owner_id = token_doc.id
            user_doc_id = _resolve_user_doc_id_for_token(token_owner_id)
            try:
                access_token = get_valid_access_token(token_owner_id, zwift_service)
                if not access_token:
                    skipped += 1
                    continue

                user_ref = db.collection('users').document(user_doc_id)
                if not user_ref.get().exists:
                    logger.warning(
                        f"Skipping token {token_owner_id}: could not resolve user doc {user_doc_id}"
                    )
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

                if token_owner_id != user_doc_id:
                    logger.info(
                        f"Resolved token owner {token_owner_id} to user doc {user_doc_id} for profile backfill"
                    )
                user_ref.set(with_schema_version(update), merge=True)

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
            zr = data.get('zwiftRacing', {})
            eff_rating = effective_rating(
                zr.get('currentRating', 'N/A'),
                zr.get('max30Rating', 'N/A'),
                zr.get('max90Rating', 'N/A'),
            )

            if eff_rating is None:
                skipped += 1
                continue

            try:
                # Pass existing_lc=None so bulk assign always resets to unlocked.
                liga_update = _compute_liga_update(eff_rating, None, grace_period, categories)
                user_update = with_schema_version(liga_update)
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

        zr = data.get('zwiftRacing', {})
        eff_rating = effective_rating(
            zr.get('currentRating', 'N/A'),
            zr.get('max30Rating', 'N/A'),
            zr.get('max90Rating', 'N/A'),
        )
        if eff_rating is None:
            return jsonify({'message': 'Rider has no vELO rating'}), 400

        auto = lc.get('autoAssigned') or {}
        current_cat = auto.get('category')

        # Jump directly to the category matching eff_rating (rather than one tier up)
        # so admins can fix badly-assigned riders in a single action.
        # Never downgrade: if eff_rating's category is the same or lower than the
        # current category, fall back to the one-tier-up behaviour.
        target = build_liga_category(eff_rating, grace_period, categories)
        target_cat = target['category']
        effective_new_cat = _effective_cat_name(target_cat, current_cat, categories)

        if effective_new_cat != current_cat:
            # eff_rating puts the rider in a strictly higher category — jump there.
            update_fields = target
            update_fields.pop('assignedRating', None)  # preserve historical assignedRating
        else:
            # eff_rating is at or below current category — bump up one tier as before.
            update_fields = reassign_to_next_category(current_cat, eff_rating, grace_period, categories)

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


@admin_bp.route('/admin/debug-power-profile/<zwift_id>', methods=['GET'])
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
            return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    zwift_service = get_zwift_service()
    token_doc = get_token_doc(zwift_id) or {}
    access_token = get_valid_access_token(zwift_id, zwift_service)
    if not access_token:
        return jsonify({
            'error': 'No valid token for this user',
            'token_doc': {
                'exists': bool(token_doc),
                'scope': token_doc.get('scope'),
                'zwiftUserId': token_doc.get('zwiftUserId'),
                'expires_at': token_doc.get('expires_at'),
            }
        }), 404

    response = zwift_service._api_get("/api/link/power-curve/power-profile", token=access_token)
    return jsonify({
        'status_code': response.status_code,
        'body': response.text[:4000],
        'token_doc': {
            'scope': token_doc.get('scope'),
            'zwiftUserId': token_doc.get('zwiftUserId'),
            'expires_at': token_doc.get('expires_at'),
        }
    }), 200
