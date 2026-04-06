"""
Admin: Users overview.

Returns a flat list of all registered users with key fields for the
admin users table.  Registered on admin_bp (defined in routes/admin.py).
"""
from flask import request, jsonify

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db

import logging

logger = logging.getLogger(__name__)


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
