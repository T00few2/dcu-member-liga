"""Admin: activate/deactivate the public /live-race page."""

from __future__ import annotations

import logging

from flask import jsonify, request
from firebase_admin import firestore

from authz import AuthzError, require_admin
from extensions import db
from routes.admin import admin_bp

logger = logging.getLogger(__name__)


@admin_bp.route('/admin/live-race/activate', methods=['POST'])
def activate_live_race():
    """
    Set or clear liveRaceState/active (which race /live-race shows).

    Body: { "raceId": "<race doc id>" | null }
    """
    try:
        claims = require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    body = request.get_json(silent=True) or {}
    race_id_raw = body.get('raceId')
    race_id = str(race_id_raw).strip() if race_id_raw else None

    if race_id:
        race_doc = db.collection('races').document(race_id).get()
        if not race_doc.exists:
            return jsonify({'message': 'Race not found'}), 404

    uid = str(claims.get('uid') or claims.get('user_id') or '').strip()
    state_ref = db.collection('liveRaceState').document('active')
    state_ref.set(
        {
            'raceId': race_id,
            'activatedAt': firestore.SERVER_TIMESTAMP,
            'activatedBy': uid or None,
        },
        merge=False,
    )

    action = 'activated' if race_id else 'deactivated'
    logger.info('Live-race page %s (raceId=%s) by %s', action, race_id, uid)
    return jsonify({'raceId': race_id, 'message': f'Live-race page {action}'}), 200
