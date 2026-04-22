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
from utils.email_sender import send_html_email, _strip_html, EmailConfigError, EmailSendError

import logging

logger = logging.getLogger(__name__)
EMAIL_PATTERN = re.compile(r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
MAX_EMAIL_RECIPIENTS = 200


def _is_valid_email(email: str) -> bool:
    return bool(EMAIL_PATTERN.match((email or '').strip()))


@admin_bp.route('/admin/users', methods=['GET'])
def get_users_overview():
    """Return all registered users with key fields for the admin table."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    try:
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
                'stravaConnected': bool(strava_conn.get('athlete_id') or strava_conn.get('athleteId')),
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
    """Send one email to each selected user (admin-only)."""
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'error': e.message}), e.status_code

    payload = request.get_json(silent=True) or {}
    user_ids_raw = payload.get('userIds')
    subject = str(payload.get('subject') or '').strip()
    message = str(payload.get('message') or '')

    if not isinstance(user_ids_raw, list):
        return jsonify({'error': 'userIds must be an array of user document IDs.'}), 400
    if not subject:
        return jsonify({'error': 'subject is required.'}), 400
    if not _strip_html(message).strip():
        return jsonify({'error': 'message is required.'}), 400
    if '\r' in subject or '\n' in subject:
        return jsonify({'error': 'subject must be a single line.'}), 400

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

    if not unique_user_ids:
        return jsonify({'error': 'No valid user IDs provided.'}), 400
    if len(unique_user_ids) > MAX_EMAIL_RECIPIENTS:
        return jsonify({'error': f'Maximum recipients per request is {MAX_EMAIL_RECIPIENTS}.'}), 400

    sent = 0
    failed = 0
    skipped = 0
    results = []

    try:
        for user_id in unique_user_ids:
            user_doc = db.collection('users').document(user_id).get()
            if not user_doc.exists:
                skipped += 1
                results.append({
                    'userId': user_id,
                    'status': 'skipped',
                    'reason': 'user_not_found',
                })
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

            try:
                send_html_email(to_email=email, subject=subject, html_body=message)
                sent += 1
                results.append({
                    'userId': user_id,
                    'name': name,
                    'zwiftId': zwift_id,
                    'email': email,
                    'status': 'sent',
                })
            except EmailConfigError as exc:
                logger.error('Email config error: %s', exc)
                return jsonify({'error': str(exc)}), 503
            except EmailSendError as exc:
                failed += 1
                logger.warning('Failed email send for user %s: %s', user_id, exc)
                results.append({
                    'userId': user_id,
                    'name': name,
                    'zwiftId': zwift_id,
                    'email': email,
                    'status': 'failed',
                    'reason': str(exc),
                })

        summary = {
            'requested': len(unique_user_ids),
            'sent': sent,
            'failed': failed,
            'skipped': skipped,
        }
        return jsonify({'summary': summary, 'results': results}), 200
    except Exception as e:
        logger.exception('Error sending admin emails')
        return jsonify({'error': str(e)}), 500
