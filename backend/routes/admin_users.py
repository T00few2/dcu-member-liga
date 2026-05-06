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

    payload = request.get_json(silent=True) or {}
    user_ids_raw   = payload.get('userIds')
    subject        = str(payload.get('subject') or '').strip()
    message        = str(payload.get('message') or '')
    send_mode      = str(payload.get('sendMode') or 'individual').strip().lower()
    recipient_mode = str(payload.get('recipientMode') or 'bcc').strip().lower()
    manual_cc_raw  = str(payload.get('manualCc') or '')
    manual_bcc_raw = str(payload.get('manualBcc') or '')

    if not isinstance(user_ids_raw, list):
        return jsonify({'error': 'userIds must be an array of user document IDs.'}), 400
    if send_mode not in ('individual', 'group'):
        return jsonify({'error': "sendMode must be 'individual' or 'group'."}), 400
    if send_mode == 'group' and recipient_mode not in ('to', 'cc', 'bcc'):
        return jsonify({'error': "recipientMode must be one of: 'to', 'cc', 'bcc'."}), 400
    if not subject:
        return jsonify({'error': 'subject is required.'}), 400
    if not _strip_html(message).strip():
        return jsonify({'error': 'message is required.'}), 400
    if '\r' in subject or '\n' in subject:
        return jsonify({'error': 'subject must be a single line.'}), 400

    manual_cc_valid, manual_cc_invalid   = _parse_manual_emails(manual_cc_raw)
    manual_bcc_valid, manual_bcc_invalid = _parse_manual_emails(manual_bcc_raw)
    invalid_manual = manual_cc_invalid + manual_bcc_invalid
    if invalid_manual:
        return jsonify({'error': f"Invalid email address(es) in CC/BCC: {', '.join(invalid_manual)}"}), 400

    unique_user_ids = []
    seen_ids = set()
    for raw_id in user_ids_raw:
        if not isinstance(raw_id, str):
            continue
        cleaned = raw_id.strip()
        if not cleaned or cleaned in seen_ids:
            continue
        seen_ids.add(cleaned)
        unique_user_ids.append(cleaned)

    total_manual = len(manual_cc_valid) + len(manual_bcc_valid)
    if not unique_user_ids and total_manual == 0:
        return jsonify({'error': 'No valid recipients provided.'}), 400
    if len(unique_user_ids) + total_manual > MAX_EMAIL_RECIPIENTS:
        return jsonify({'error': f'Maximum recipients per request is {MAX_EMAIL_RECIPIENTS}.'}), 400

    user_emails: list[str] = []
    skipped = 0
    results = []

    try:
        for user_id in unique_user_ids:
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

        total_valid = len(user_emails) + len(manual_cc_valid) + len(manual_bcc_valid)
        if total_valid == 0:
            summary = {
                'requested': len(unique_user_ids),
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
                for addr in user_emails + manual_cc_valid + manual_bcc_valid:
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

                for addr in manual_cc_valid + manual_bcc_valid:
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
                all_to, all_cc, all_bcc = user_emails, manual_cc_valid, manual_bcc_valid
            elif recipient_mode == 'cc':
                all_to, all_cc, all_bcc = [], user_emails + manual_cc_valid, manual_bcc_valid
            else:  # bcc
                all_to, all_cc, all_bcc = [], manual_cc_valid, user_emails + manual_bcc_valid

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
            'requested': len(unique_user_ids),
            'skipped': skipped,
            'sent': sent,
            'failed': failed,
            'sendMode': send_mode,
        }
        return jsonify({'summary': summary, 'results': results}), 200

    except Exception as e:
        logger.exception('Error sending admin emails')
        return jsonify({'error': str(e)}), 500
