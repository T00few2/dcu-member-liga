"""
Admin: Users overview.

Returns a flat list of all registered users with key fields for the
admin users table.  Registered on admin_bp (defined in routes/admin.py).
"""
from flask import request, jsonify
import re

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db
from services.request_models import SendEmailRequest, parse_body
from utils.email_sender import send_html_email, send_html_emails_individually, _strip_html, EmailConfigError, EmailSendError

import logging

logger = logging.getLogger(__name__)
EMAIL_PATTERN = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
MAX_EMAIL_RECIPIENTS = 200


def _is_valid_email(email: str) -> bool:
    return bool(EMAIL_PATTERN.match((email or '').strip()))


def _parse_manual_emails(raw: str) -> tuple[list[str], list[str]]:
    if not raw.strip():
        return [], []
    candidates = [a.strip() for a in raw.split(',') if a.strip()]
    return (
        [e for e in candidates if _is_valid_email(e)],
        [e for e in candidates if not _is_valid_email(e)],
    )


def _chunks(values: list[str], size: int) -> list[list[str]]:
    return [values[i:i + size] for i in range(0, len(values), size)]


@admin_bp.route('/admin/users', methods=['GET'])
def get_users_overview():
    """Return all registered users with key fields for the admin table."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    try:
        # Build trainer -> dualRecordingRequired lookup (normalised name as key)
        trainer_dr: dict[str, bool] = {}
        for tdoc in db.collection('trainers').stream():
            td = tdoc.to_dict() or {}
            norm = td.get('normalizedName') or ' '.join((td.get('name') or '').strip().lower().split())
            if norm:
                trainer_dr[norm] = bool(td.get('dualRecordingRequired'))

        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .stream()
        )

        users = []
        for doc in docs:
            data = doc.to_dict() or {}

            if data.get('isTestData'):
                continue

            connections = data.get('connections') or {}
            zwift_conn = connections.get('zwift') or {}
            strava_conn = connections.get('strava') or {}
            strava_connected = bool(strava_conn.get('athlete_id') or strava_conn.get('athleteId'))

            equipment = data.get('equipment') or {}
            zr = data.get('zwiftRacing') or {}
            verification = data.get('verification') or {}
            liga = data.get('ligaCategory') or {}

            # Effective category
            if liga.get('locked') and liga.get('category'):
                category = liga['category']
            else:
                auto = liga.get('autoAssigned') or {}
                self_sel = liga.get('selfSelected') or {}
                category = (
                    self_sel.get('category')
                    or auto.get('category')
                    or ''
                )

            # Flag: trainer requires dual recording but Strava is not linked
            trainer_name = equipment.get('trainer', '')
            trainer_norm = ' '.join(trainer_name.strip().lower().split()) if trainer_name else ''
            needs_strava_for_dr = (
                bool(trainer_dr.get(trainer_norm))
                and not strava_connected
            )

            # Signed-up timestamp
            accepted_at = (data.get('registration') or {}).get('dataPolicy', {}).get('acceptedAt')
            signed_up_ms = None
            if accepted_at is not None:
                try:
                    if hasattr(accepted_at, 'timestamp'):
                        signed_up_ms = int(accepted_at.timestamp() * 1000)
                    else:
                        signed_up_ms = int(accepted_at) * 1000
                except Exception:
                    pass

            users.append({
                'userId': doc.id,
                'zwiftId': data.get('zwiftId', ''),
                'name': data.get('name', ''),
                'email': data.get('email', ''),
                'club': data.get('club', ''),
                'trainer': equipment.get('trainer', ''),
                'category': category,
                'categoryLocked': bool(liga.get('locked')),
                'zwiftConnected': bool(zwift_conn.get('profileId') or data.get('zwiftId')),
                'stravaConnected': strava_connected,
                'needsStravaForDR': needs_strava_for_dr,
                'verificationStatus': verification.get('status', 'none'),
                'currentRating': zr.get('currentRating', ''),
                'max30Rating': zr.get('max30Rating', ''),
                'phenotype': zr.get('phenotype', ''),
                'signedUpAt': signed_up_ms,
            })

        users.sort(key=lambda u: (u.get('club') or '', u.get('name') or ''))
        return jsonify({'users': users}), 200

    except Exception as e:
        logger.exception('Error fetching users overview')
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/admin/users/<user_id>', methods=['GET'])
def get_user_details(user_id):
    """Return full profile data for a single user (admin-only)."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    try:
        from services.user_service import UserService
        user = UserService.get_user_by_id(user_id)
        if user is None:
            return jsonify({'error': 'User not found'}), 404

        data = user.to_dict()

        def _ts_ms(val):
            if val is None:
                return None
            try:
                if hasattr(val, 'timestamp'):
                    return int(val.timestamp() * 1000)
                return int(val) * 1000
            except Exception:
                return None

        connections = data.get('connections') or {}
        zwift_conn = connections.get('zwift') or {}
        strava_conn = connections.get('strava') or {}
        equipment = data.get('equipment') or {}
        zp = data.get('zwiftProfile') or {}
        zpc = data.get('zwiftPowerCurve') or {}
        zr = data.get('zwiftRacing') or {}
        liga = data.get('ligaCategory') or {}
        verification = data.get('verification') or {}
        registration = data.get('registration') or {}
        auto_assigned = liga.get('autoAssigned') or {}
        self_selected = liga.get('selfSelected') or {}

        def _serialize_verification_request(req):
            if not req:
                return None
            return {
                'requestId': req.get('requestId'),
                'type': req.get('type'),
                'status': req.get('status'),
                'requestedAt': _ts_ms(req.get('requestedAt')),
                'deadline': _ts_ms(req.get('deadline')),
                'videoLink': req.get('videoLink'),
                'submittedAt': _ts_ms(req.get('submittedAt')),
                'reviewedAt': _ts_ms(req.get('reviewedAt')),
                'reviewerId': req.get('reviewerId'),
                'rejectionReason': req.get('rejectionReason'),
            }

        result = {
            'userId': user.id,
            'basic': {
                'name': data.get('name', ''),
                'email': data.get('email', ''),
                'zwiftId': data.get('zwiftId', ''),
                'club': data.get('club', ''),
                'trainer': equipment.get('trainer', ''),
                'createdAt': _ts_ms(data.get('createdAt')),
                'updatedAt': _ts_ms(data.get('updatedAt')),
            },
            'zwiftProfile': {
                'ftp': zp.get('ftp'),
                'zftp': zp.get('zftp'),
                'zmap': zp.get('zmap'),
                'weight': zp.get('weight'),
                'weightInGrams': zp.get('weightInGrams'),
                'height': zp.get('height'),
                'racingScore': zp.get('racingScore'),
                'powerCompoundScore': zp.get('powerCompoundScore'),
                'vo2max': zp.get('vo2max'),
                'category': zp.get('category'),
                'updatedAt': _ts_ms(zp.get('updatedAt')),
            } if zp else None,
            'zwiftPowerCurve': {
                'zftp': zpc.get('zftp'),
                'zmap': zpc.get('zmap'),
                'vo2max': zpc.get('vo2max'),
                'validPowerProfile': zpc.get('validPowerProfile'),
                'cpBestEfforts': zpc.get('cpBestEfforts') or [],
                'relevantCpEfforts': zpc.get('relevantCpEfforts') or [],
                'updatedAt': _ts_ms(zpc.get('updatedAt')),
            } if zpc else None,
            'zwiftRacing': {
                'currentRating': zr.get('currentRating'),
                'max30Rating': zr.get('max30Rating'),
                'max90Rating': zr.get('max90Rating'),
                'phenotype': zr.get('phenotype'),
                'updatedAt': _ts_ms(zr.get('updatedAt')),
            } if zr else None,
            'connections': {
                'zwift': {
                    'connected': bool(zwift_conn.get('profileId') or data.get('zwiftId')),
                    'connectedAt': _ts_ms(zwift_conn.get('connectedAt')),
                    'profileId': zwift_conn.get('profileId'),
                    'userId': zwift_conn.get('userId'),
                },
                'strava': {
                    'connected': bool(strava_conn.get('athlete_id') or strava_conn.get('athleteId')),
                    'athleteId': strava_conn.get('athlete_id') or strava_conn.get('athleteId'),
                },
            },
            'ligaCategory': {
                'category': liga.get('category'),
                'locked': bool(liga.get('locked')),
                'lockedAt': _ts_ms(liga.get('lockedAt')),
                'autoAssigned': {
                    'season': auto_assigned.get('season'),
                    'category': auto_assigned.get('category'),
                    'upperBoundary': auto_assigned.get('upperBoundary'),
                    'graceLimit': auto_assigned.get('graceLimit'),
                    'status': auto_assigned.get('status'),
                    'assignedRating': auto_assigned.get('assignedRating'),
                    'assignedAt': _ts_ms(auto_assigned.get('assignedAt')),
                    'lastCheckedRating': auto_assigned.get('lastCheckedRating'),
                    'lastCheckedAt': _ts_ms(auto_assigned.get('lastCheckedAt')),
                } if auto_assigned else None,
                'selfSelected': {
                    'category': self_selected.get('category'),
                    'selfSelectedAt': _ts_ms(self_selected.get('selfSelectedAt')),
                } if self_selected else None,
            },
            'verification': {
                'status': verification.get('status', 'none'),
                'currentRequest': _serialize_verification_request(verification.get('currentRequest')),
                'history': [
                    _serialize_verification_request(r)
                    for r in (verification.get('history') or [])
                ],
            },
            'registration': {
                'status': registration.get('status'),
                'cocAccepted': bool(registration.get('cocAccepted')),
                'dataPolicy': {
                    'version': (registration.get('dataPolicy') or {}).get('version'),
                    'acceptedAt': _ts_ms((registration.get('dataPolicy') or {}).get('acceptedAt')),
                } if registration.get('dataPolicy') else None,
                'publicResultsConsent': {
                    'version': (registration.get('publicResultsConsent') or {}).get('version'),
                    'acceptedAt': _ts_ms((registration.get('publicResultsConsent') or {}).get('acceptedAt')),
                } if registration.get('publicResultsConsent') else None,
            },
        }

        return jsonify({'user': result}), 200

    except Exception as e:
        logger.exception('Error fetching user details for %s', user_id)
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/admin/users/<user_id>/races', methods=['GET'])
def get_user_races(user_id):
    """Return all races where the user participated (admin-only)."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    try:
        from services.user_service import UserService
        user = UserService.get_user_by_id(user_id)
        if user is None:
            return jsonify({'error': 'User not found'}), 404

        # Race results are keyed by zwiftId field, not the Firestore document ID
        # (document ID may be a Firebase auth UID for older accounts)
        zwift_id = str(user.zwift_id or '').strip()

        user_races = []
        race_index: dict[str, dict] = {}
        event_to_race_ids: dict[str, list[str]] = {}

        def _register_race(race_doc, race_data, archive_name=None):
            race_id = race_doc.id
            race_entry = race_index.get(race_id)
            if not race_entry:
                race_entry = {
                    'raceId': race_id,
                    'name': race_data.get('name', ''),
                    'date': race_data.get('date', ''),
                    'map': race_data.get('map', ''),
                    'archive': archive_name,
                    'eventCategories': {},  # eventId -> [category names]
                }
                race_index[race_id] = race_entry

            def _add_event(event_id, categories=None):
                eid = str(event_id or '').strip()
                if not eid:
                    return
                if race_id not in event_to_race_ids.get(eid, []):
                    event_to_race_ids.setdefault(eid, []).append(race_id)
                if categories:
                    current = race_entry['eventCategories'].setdefault(eid, [])
                    for cat in categories:
                        c = str(cat or '').strip()
                        if c and c not in current:
                            current.append(c)

            _add_event(race_data.get('eventId'))
            for linked in race_data.get('linkedEventIds') or []:
                _add_event(linked)

            for cfg in race_data.get('eventConfiguration') or []:
                if not isinstance(cfg, dict):
                    continue
                category_name = str(cfg.get('customCategory') or cfg.get('category') or '').strip()
                cats = [category_name] if category_name else []
                _add_event(cfg.get('eventId'), cats)

            for group in race_data.get('raceGroups') or []:
                if not isinstance(group, dict):
                    continue
                cats = []
                for cat_cfg in group.get('categories') or []:
                    if not isinstance(cat_cfg, dict):
                        continue
                    cat_name = str(cat_cfg.get('category') or '').strip()
                    if cat_name:
                        cats.append(cat_name)
                _add_event(group.get('eventId'), cats)

        def _collect_from_race(race_doc, race_data, archive_name=None):
            _register_race(race_doc, race_data, archive_name=archive_name)
            results = race_data.get('results') or {}
            for category, category_results in results.items():
                if not isinstance(category_results, list):
                    continue
                for rider in category_results:
                    if not isinstance(rider, dict):
                        continue
                    if str(rider.get('zwiftId') or '').strip() == zwift_id:
                        user_races.append({
                            'raceId': race_doc.id,
                            'name': race_data.get('name', ''),
                            'date': race_data.get('date', ''),
                            'map': race_data.get('map', ''),
                            'category': category,
                            'archive': archive_name,
                            'finishTime': rider.get('finishTime'),
                            'finishRank': rider.get('finishRank'),
                            'finishPoints': rider.get('finishPoints'),
                            'sprintPoints': rider.get('sprintPoints'),
                            'totalPoints': rider.get('totalPoints'),
                            'raceStatus': rider.get('raceStatus', ''),
                            'disqualified': bool(rider.get('disqualified')),
                            'declassified': bool(rider.get('declassified')),
                            'flaggedSandbagging': bool(rider.get('flaggedSandbagging')),
                            'flaggedCheating': bool(rider.get('flaggedCheating')),
                            'activityId': rider.get('activityId'),
                            'sprintData': rider.get('sprintData') or {},
                            'sprintDetails': rider.get('sprintDetails') or {},
                            'criticalP': rider.get('criticalP') or {},
                        })
                        break

        # Current season races
        for race_doc in db.collection('races').stream():
            _collect_from_race(race_doc, race_doc.to_dict() or {})

        # Archived season races
        for archive_doc in db.collection('archives').stream():
            archive_data = archive_doc.to_dict() or {}
            archive_name = archive_data.get('name') or archive_doc.id
            for race_doc in archive_doc.reference.collection('races').stream():
                _collect_from_race(race_doc, race_doc.to_dict() or {}, archive_name=archive_name)

        # Fallback: include race participations inferred from stored Zwift activities.
        # This catches riders who have webhook activities linked by event ID but were not
        # written into race.results (for example category mismatch or missing ingest).
        existing_race_ids = {str(r.get('raceId') or '') for r in user_races}
        existing_activity_ids = {str(r.get('activityId') or '') for r in user_races if r.get('activityId')}

        user_data = user.to_dict() if hasattr(user, 'to_dict') else {}
        connections = (user_data or {}).get('connections') or {}
        zwift_conn = connections.get('zwift') or {}

        candidate_activity_user_ids: list[str] = []
        for candidate in (
            zwift_conn.get('userId'),
            user_data.get('zwiftUserId'),
            zwift_conn.get('profileId'),
            user_data.get('zwiftId'),
            zwift_id,
        ):
            candidate_id = str(candidate or '').strip()
            if candidate_id and candidate_id not in candidate_activity_user_ids:
                candidate_activity_user_ids.append(candidate_id)

        candidate_activity_docs = []
        seen_activity_doc_ids = set()
        for candidate in candidate_activity_user_ids:
            query_values = [candidate]
            if candidate.isdigit():
                query_values.append(int(candidate))
            for qv in query_values:
                for act_doc in db.collection('zwift_activities').where('userId', '==', qv).limit(250).stream():
                    if act_doc.id in seen_activity_doc_ids:
                        continue
                    seen_activity_doc_ids.add(act_doc.id)
                    candidate_activity_docs.append(act_doc)

        for act_doc in candidate_activity_docs:
            act = act_doc.to_dict() or {}
            raw = act.get('data') or {}

            activity_id = str(act.get('activityId') or act_doc.id or '').strip()
            if not activity_id or activity_id in existing_activity_ids:
                continue

            event_id = str(raw.get('eventId') or '').strip()
            if not event_id:
                continue

            matched_race_ids = event_to_race_ids.get(event_id) or []
            if not matched_race_ids:
                continue

            # Prefer current season race if both current and archive contain matching event IDs.
            matched_race_id = sorted(
                matched_race_ids,
                key=lambda rid: 1 if race_index.get(rid, {}).get('archive') else 0,
            )[0]
            if matched_race_id in existing_race_ids:
                continue

            race_meta = race_index.get(matched_race_id) or {}
            categories = (race_meta.get('eventCategories') or {}).get(event_id) or []
            activity_name = str(raw.get('activityName') or '').strip()
            activity_name_l = activity_name.lower()
            category = ''
            if len(categories) == 1:
                category = categories[0]
            elif len(categories) > 1:
                for cat in categories:
                    if str(cat).lower() in activity_name_l:
                        category = cat
                        break

            if not category and activity_name:
                m = re.search(r'race:\s*([A-Za-z]+)', activity_name, re.IGNORECASE)
                if m:
                    parsed_cat = m.group(1).strip().title()
                    if not categories or parsed_cat in categories:
                        category = parsed_cat

            user_races.append({
                'raceId': matched_race_id,
                'name': race_meta.get('name', ''),
                'date': race_meta.get('date', ''),
                'map': race_meta.get('map', ''),
                'category': category,
                'archive': race_meta.get('archive'),
                'finishTime': raw.get('totalDurationInMilliSec') or raw.get('movingTimeInMs'),
                'finishRank': None,
                'finishPoints': None,
                'sprintPoints': None,
                'totalPoints': None,
                'raceStatus': 'ACT',
                'disqualified': False,
                'declassified': False,
                'flaggedSandbagging': False,
                'flaggedCheating': False,
                'activityId': activity_id,
                'sprintData': {},
                'sprintDetails': {},
                'criticalP': {},
            })
            existing_race_ids.add(matched_race_id)
            existing_activity_ids.add(activity_id)

        user_races.sort(key=lambda r: r.get('date') or '', reverse=True)
        return jsonify({'races': user_races}), 200

    except Exception as e:
        logger.exception('Error fetching races for user %s', user_id)
        return jsonify({'error': str(e)}), 500


@admin_bp.route('/admin/users/send-email', methods=['POST'])
def send_email_to_selected_users():
    """Send email to admin-selected users (admin-only).

    sendMode='individual': one personal To:<addr> email per recipient — better
    inbox delivery, no visible recipient list.
    sendMode='group': one email to all recipients; recipientMode controls
    whether user addresses appear in To, Cc, or Bcc.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    body, err = parse_body(SendEmailRequest, request.get_json(silent=True) or {})
    if err:
        return err

    subject        = body.subject
    message        = body.message
    send_mode      = body.sendMode
    recipient_mode = body.recipientMode

    if not _strip_html(message).strip():
        return jsonify({'error': 'message is required.'}), 400

    manual_to_valid,  manual_to_invalid  = _parse_manual_emails(body.manualTo)
    manual_cc_valid,  manual_cc_invalid  = _parse_manual_emails(body.manualCc)
    manual_bcc_valid, manual_bcc_invalid = _parse_manual_emails(body.manualBcc)
    invalid_manual = manual_to_invalid + manual_cc_invalid + manual_bcc_invalid
    if invalid_manual:
        return jsonify({'error': f"Invalid email address(es) in To/CC/BCC: {', '.join(invalid_manual)}"}), 400

    unique_user_ids = []
    seen_ids = set()
    for raw_id in body.userIds:
        if not isinstance(raw_id, str):
            continue
        cleaned = raw_id.strip()
        if not cleaned or cleaned in seen_ids:
            continue
        seen_ids.add(cleaned)
        unique_user_ids.append(cleaned)

    unique_zwift_ids = []
    seen_zwift_ids = set()
    for raw_zwift_id in body.zwiftIds:
        cleaned = str(raw_zwift_id or '').strip()
        if not cleaned or cleaned in seen_zwift_ids:
            continue
        seen_zwift_ids.add(cleaned)
        unique_zwift_ids.append(cleaned)

    total_manual = len(manual_to_valid) + len(manual_cc_valid) + len(manual_bcc_valid)
    requested_count = len(unique_user_ids) + len(unique_zwift_ids)
    if requested_count == 0 and total_manual == 0:
        return jsonify({'error': 'No valid recipients provided.'}), 400
    if requested_count + total_manual > MAX_EMAIL_RECIPIENTS:
        return jsonify({'error': f'Maximum recipients per request is {MAX_EMAIL_RECIPIENTS}.'}), 400

    user_emails: list[str] = []
    skipped = 0
    results = []

    try:
        resolved_user_ids = list(unique_user_ids)
        if unique_zwift_ids:
            seen_resolved = set(resolved_user_ids)
            matched_zwift_ids = set()
            for chunk in _chunks(unique_zwift_ids, 10):
                docs = db.collection('users').where('zwiftId', 'in', chunk).stream()
                for user_doc in docs:
                    user_data = user_doc.to_dict() or {}
                    zwift_id = str(user_data.get('zwiftId') or '').strip()
                    if zwift_id:
                        matched_zwift_ids.add(zwift_id)
                    if user_doc.id in seen_resolved:
                        continue
                    seen_resolved.add(user_doc.id)
                    resolved_user_ids.append(user_doc.id)

            for zwift_id in unique_zwift_ids:
                if zwift_id in matched_zwift_ids:
                    continue
                skipped += 1
                results.append({
                    'zwiftId': zwift_id,
                    'status': 'skipped',
                    'reason': 'user_not_found',
                })

        for user_id in resolved_user_ids:
            user_doc = db.collection('users').document(user_id).get()
            if not user_doc.exists:
                skipped += 1
                results.append({'userId': user_id, 'status': 'skipped', 'reason': 'user_not_found'})
                continue

            user_data = user_doc.to_dict() or {}
            email = str(user_data.get('email') or '').strip()
            name = str(user_data.get('name') or '')
            zwift_id = str(user_data.get('zwiftId') or '')

            if not _is_valid_email(email):
                skipped += 1
                results.append({
                    'userId': user_id,
                    'name': name,
                    'zwiftId': zwift_id,
                    'status': 'skipped',
                    'reason': 'invalid_or_missing_email',
                })
                continue

            user_emails.append(email)
            results.append({
                'userId': user_id,
                'name': name,
                'zwiftId': zwift_id,
                'email': email,
                'status': 'resolved',
            })

        total_valid = len(user_emails) + len(manual_to_valid) + len(manual_cc_valid) + len(manual_bcc_valid)
        if total_valid == 0:
            summary = {
                'requested': requested_count,
                'skipped': skipped,
                'sent': 0,
                'failed': 0,
                'sendMode': send_mode,
            }
            return jsonify({
                'summary': summary,
                'results': results,
                'error': 'All selected users were skipped (no valid email addresses).',
            }), 200

        sent = 0
        failed = 0

        if send_mode == 'individual':
            try:
                seen: set[str] = set()
                deduped: list[str] = []
                for addr in user_emails + manual_to_valid + manual_cc_valid + manual_bcc_valid:
                    if addr not in seen:
                        seen.add(addr)
                        deduped.append(addr)

                outcomes = send_html_emails_individually(
                    addresses=deduped,
                    subject=subject,
                    html_body=message,
                )
                outcome_map = {addr: err for addr, err in outcomes}

                for r in results:
                    if r['status'] == 'resolved':
                        err = outcome_map.get(r['email'])
                        if err is None:
                            r['status'] = 'sent'
                            sent += 1
                        else:
                            r['status'] = 'failed'
                            r['reason'] = err
                            failed += 1
                            logger.warning(
                                'Individual send failed: userId=%s email=%s reason=%s',
                                r.get('userId'), r.get('email'), err,
                            )

                for addr in manual_to_valid + manual_cc_valid + manual_bcc_valid:
                    err = outcome_map.get(addr)
                    if err is None:
                        sent += 1
                    else:
                        failed += 1
                        logger.warning('Individual send failed: email=%s reason=%s', addr, err)

                logger.info(
                    'Individual email send complete: sent=%d failed=%d subject=%r',
                    sent, failed, subject,
                )

            except EmailConfigError as exc:
                logger.error('Email config error: %s', exc)
                return jsonify({'error': str(exc)}), 503
            except EmailSendError as exc:
                failed = total_valid
                logger.warning('Failed individual email send: %s', exc)
                for r in results:
                    if r['status'] == 'resolved':
                        r['status'] = 'failed'
                        r['reason'] = str(exc)

        else:  # group
            if recipient_mode == 'to':
                all_to, all_cc, all_bcc = user_emails + manual_to_valid, manual_cc_valid, manual_bcc_valid
            elif recipient_mode == 'cc':
                all_to, all_cc, all_bcc = manual_to_valid, user_emails + manual_cc_valid, manual_bcc_valid
            else:  # bcc
                all_to, all_cc, all_bcc = manual_to_valid, manual_cc_valid, user_emails + manual_bcc_valid

            try:
                send_html_email(
                    to_emails=all_to,
                    cc_emails=all_cc,
                    bcc_emails=all_bcc,
                    subject=subject,
                    html_body=message,
                )
                sent = total_valid
                for r in results:
                    if r['status'] == 'resolved':
                        r['status'] = 'sent'
            except EmailConfigError as exc:
                logger.error('Email config error: %s', exc)
                return jsonify({'error': str(exc)}), 503
            except EmailSendError as exc:
                failed = total_valid
                logger.warning('Failed group email send: %s', exc)
                for r in results:
                    if r['status'] == 'resolved':
                        r['status'] = 'failed'
                        r['reason'] = str(exc)

        summary = {
            'requested': requested_count,
            'skipped': skipped,
            'sent': sent,
            'failed': failed,
            'sendMode': send_mode,
        }
        return jsonify({'summary': summary, 'results': results}), 200

    except Exception as e:
        logger.exception('Error sending admin emails')
        return jsonify({'error': str(e)}), 500
