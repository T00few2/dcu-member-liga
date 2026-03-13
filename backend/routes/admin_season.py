"""
Admin: Season archive and reset routes.

Registered on admin_bp (defined in routes/admin.py).
"""
import uuid

from flask import request, jsonify
from firebase_admin import firestore

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db

import logging

logger = logging.getLogger(__name__)

# Firestore batch write limit (hard limit is 500; we use 400 for safety).
_FIRESTORE_BATCH_SIZE = 400


@admin_bp.route('/admin/archive-season', methods=['POST'])
def archive_season():
    """
    Snapshot the current season into the archives collection.

    Body: { "name": "Forårsliga 2025" }
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        body = request.get_json(silent=True) or {}
        name = (body.get('name') or '').strip()
        if not name:
            return jsonify({'message': 'name is required'}), 400

        settings_doc = db.collection('league').document('settings').get()
        settings = settings_doc.to_dict() if settings_doc.exists else {}

        standings_doc = db.collection('league').document('standings').get()
        standings = standings_doc.to_dict() if standings_doc.exists else {}

        race_docs = list(db.collection('races').stream())

        archive_id = str(uuid.uuid4())
        archive_ref = db.collection('archives').document(archive_id)

        archive_ref.set({
            'name': name,
            'archivedAt': firestore.SERVER_TIMESTAMP,
            'settings': settings,
            'standings': standings.get('standings', {}),
            'raceCount': len(race_docs),
        })

        for race_doc in race_docs:
            archive_ref.collection('races').document(race_doc.id).set(
                race_doc.to_dict() or {}
            )

        logger.info(f"Archived season '{name}' as {archive_id} ({len(race_docs)} races)")
        return jsonify({
            'message': f"Season '{name}' archived",
            'archiveId': archive_id,
            'raceCount': len(race_docs),
        }), 200

    except Exception as e:
        logger.error(f"Archive season error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/reset-season', methods=['POST'])
def reset_season():
    """
    Delete all races and clear current standings.
    League settings (scoring, categories) are preserved.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_docs = list(db.collection('races').stream())
        batch = db.batch()
        count = 0
        for doc in race_docs:
            batch.delete(doc.reference)
            count += 1
            if count % _FIRESTORE_BATCH_SIZE == 0:
                batch.commit()
                batch = db.batch()
        if count % _FIRESTORE_BATCH_SIZE != 0:
            batch.commit()

        db.collection('league').document('standings').set(
            {'standings': {}, 'updatedAt': firestore.SERVER_TIMESTAMP},
            merge=False,
        )

        logger.info(f"Season reset: {count} races deleted, standings cleared")
        return jsonify({'message': 'Season reset', 'racesDeleted': count}), 200

    except Exception as e:
        logger.error(f"Reset season error: {e}")
        return jsonify({'message': str(e)}), 500
