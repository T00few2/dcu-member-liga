"""
Admin: Season archive and reset routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from __future__ import annotations

import uuid
from typing import Any

from flask import request, jsonify
from firebase_admin import firestore

from routes.admin import admin_bp
from authz import require_admin, AuthzError
from extensions import db
from services.schema_validation import CURRENT_SCHEMA_VERSION, with_schema_version

import logging

logger = logging.getLogger(__name__)

# Firestore batch write limit (hard limit is 500; we use 400 for safety).
_FIRESTORE_BATCH_SIZE = 400


class _BatchedWriter:
    """Commit Firestore set/delete ops in chunks of _FIRESTORE_BATCH_SIZE."""

    def __init__(self, database: Any) -> None:
        self._db = database
        self._batch = database.batch()
        self._pending = 0

    def set(self, ref: Any, data: dict[str, Any]) -> None:
        self._batch.set(ref, data)
        self._pending += 1
        self._maybe_commit()

    def delete(self, ref: Any) -> None:
        self._batch.delete(ref)
        self._pending += 1
        self._maybe_commit()

    def _maybe_commit(self) -> None:
        if self._pending >= _FIRESTORE_BATCH_SIZE:
            self._batch.commit()
            self._batch = self._db.batch()
            self._pending = 0

    def flush(self) -> None:
        if self._pending:
            self._batch.commit()
            self._batch = self._db.batch()
            self._pending = 0


def _archive_race_tree(archive_races_col: Any, race_doc: Any, writer: _BatchedWriter) -> int:
    """
    Copy a race parent doc and all of its subcollections into the archive.
    Returns the number of nested subcollection documents copied.
    """
    race_ref = archive_races_col.document(race_doc.id)
    writer.set(race_ref, race_doc.to_dict() or {})

    nested_count = 0
    for subcol in race_doc.reference.collections():
        dest_subcol = race_ref.collection(subcol.id)
        for sub_doc in subcol.stream():
            writer.set(dest_subcol.document(sub_doc.id), sub_doc.to_dict() or {})
            nested_count += 1
    return nested_count


def _delete_race_tree(race_doc: Any, writer: _BatchedWriter) -> tuple[int, int]:
    """
    Delete all subcollection docs under a race, then the race parent.
    Returns (1, nested_deleted_count).
    """
    nested_deleted = 0
    for subcol in race_doc.reference.collections():
        for sub_doc in subcol.stream():
            writer.delete(sub_doc.reference)
            nested_deleted += 1
    writer.delete(race_doc.reference)
    return 1, nested_deleted


@admin_bp.route('/admin/archive-season', methods=['POST'])
def archive_season():
    """
    Snapshot the current season into the archives collection.

    Copies league settings, standings (inner map), each race parent doc, and all
    race subcollections (today: dr_verifications).

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
        archive_races_col = archive_ref.collection('races')

        # Parent first so the archive is listable even if a later copy fails mid-run.
        archive_ref.set({
            'name': name,
            'archivedAt': firestore.SERVER_TIMESTAMP,
            'settings': settings,
            'standings': standings.get('standings', {}),
            'raceCount': len(race_docs),
            'drVerificationCount': 0,
        })

        writer = _BatchedWriter(db)
        nested_doc_count = 0
        for race_doc in race_docs:
            nested_doc_count += _archive_race_tree(archive_races_col, race_doc, writer)
        writer.flush()

        if nested_doc_count:
            archive_ref.update({'drVerificationCount': nested_doc_count})

        logger.info(
            "Archived season '%s' as %s (%s races, %s nested race docs)",
            name,
            archive_id,
            len(race_docs),
            nested_doc_count,
        )
        return jsonify({
            'message': f"Season '{name}' archived",
            'archiveId': archive_id,
            'raceCount': len(race_docs),
            'drVerificationCount': nested_doc_count,
        }), 200

    except Exception as e:
        logger.error(f"Archive season error: {e}")
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/admin/reset-season', methods=['POST'])
def reset_season():
    """
    Delete all races (including subcollections) and clear current standings.
    Clears liveRaceState/active. League settings (scoring, categories) are preserved.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_docs = list(db.collection('races').stream())
        writer = _BatchedWriter(db)
        races_deleted = 0
        nested_deleted = 0
        for race_doc in race_docs:
            deleted_races, deleted_nested = _delete_race_tree(race_doc, writer)
            races_deleted += deleted_races
            nested_deleted += deleted_nested
        writer.flush()

        db.collection('league').document('standings').set(
            with_schema_version({
                'standings': {},
                'updatedAt': firestore.SERVER_TIMESTAMP,
            }),
            merge=False,
        )

        db.collection('liveRaceState').document('active').set(
            {
                'raceId': None,
                'manualDisabled': True,
                'activatedAt': firestore.SERVER_TIMESTAMP,
                'activatedBy': 'season_reset',
            },
            merge=False,
        )

        logger.info(
            "Season reset: %s races deleted, %s nested race docs deleted, standings cleared",
            races_deleted,
            nested_deleted,
        )
        return jsonify({
            'message': 'Season reset',
            'racesDeleted': races_deleted,
            'nestedDocsDeleted': nested_deleted,
            'schemaVersion': CURRENT_SCHEMA_VERSION,
        }), 200

    except Exception as e:
        logger.error(f"Reset season error: {e}")
        return jsonify({'message': str(e)}), 500
