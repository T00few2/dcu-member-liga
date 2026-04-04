"""
Admin: Trainer CRUD and trainer-request workflow routes.

Registered on admin_bp (defined in routes/admin.py).
"""
from flask import request, jsonify
from firebase_admin import firestore

from routes.admin import admin_bp
from authz import require_admin, verify_user_token, AuthzError
from extensions import db

import logging

logger = logging.getLogger(__name__)


def _normalize_trainer_name(name: str) -> str:
    """Normalize trainer names for duplicate detection across requests."""
    return ' '.join((name or '').strip().lower().split())


def _find_trainer_by_normalized_name(normalized_name: str):
    """Return first trainer doc matching normalized name (or legacy raw name)."""
    if not normalized_name:
        return None

    for doc in db.collection('trainers').stream():
        td = doc.to_dict() or {}
        current_normalized = td.get('normalizedName') or _normalize_trainer_name(td.get('name', ''))
        if current_normalized == normalized_name:
            return doc
    return None


# ---------------------------------------------------------------------------
# Trainer management (admin-only)
# ---------------------------------------------------------------------------

@admin_bp.route('/trainers', methods=['GET'])
def get_trainers():
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        docs = db.collection('trainers').order_by('name').stream()
        trainers = []
        for doc in docs:
            t = doc.to_dict()
            t['id'] = doc.id
            trainers.append(t)
        return jsonify({'trainers': trainers}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/trainers', methods=['POST'])
def create_trainer():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json()
        name = data.get('name')
        if not name:
            return jsonify({'message': 'Trainer name is required'}), 400
        name = name.strip()

        trainer_data = {
            'name': name,
            'normalizedName': _normalize_trainer_name(name),
            'status': data.get('status', 'approved'),
            'dualRecordingRequired': data.get('dualRecordingRequired', False),
            'createdAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }
        _, doc_ref = db.collection('trainers').add(trainer_data)
        return jsonify({'message': 'Trainer created', 'id': doc_ref.id}), 201
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/trainers/<trainer_id>', methods=['PUT'])
def update_trainer(trainer_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json()
        update_data = {'updatedAt': firestore.SERVER_TIMESTAMP}
        if 'name' in data:
            cleaned_name = (data['name'] or '').strip()
            update_data['name'] = cleaned_name
            update_data['normalizedName'] = _normalize_trainer_name(cleaned_name)
        if 'status' in data:
            update_data['status'] = data['status']
        if 'dualRecordingRequired' in data:
            update_data['dualRecordingRequired'] = data['dualRecordingRequired']

        db.collection('trainers').document(trainer_id).update(update_data)
        return jsonify({'message': 'Trainer updated'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/trainers/<trainer_id>', methods=['DELETE'])
def delete_trainer(trainer_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        db.collection('trainers').document(trainer_id).delete()
        return jsonify({'message': 'Trainer deleted'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


# ---------------------------------------------------------------------------
# Trainer requests (user-facing + admin review)
# ---------------------------------------------------------------------------

@admin_bp.route('/trainers/request', methods=['POST'])
def request_trainer():
    try:
        decoded = verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    uid = decoded['uid']

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json()
        trainer_name = (data.get('trainerName') or '').strip()
        if not trainer_name:
            return jsonify({'message': 'Trainer name is required'}), 400

        normalized_name = _normalize_trainer_name(trainer_name)

        # If trainer already exists, no request is needed.
        existing_trainer_doc = _find_trainer_by_normalized_name(normalized_name)
        if existing_trainer_doc:
            return jsonify({'message': 'Trainer already exists and does not need approval'}), 200

        # Prevent duplicate pending requests for the same trainer.
        pending_docs = (
            db.collection('trainer_requests')
            .where('status', '==', 'pending')
            .stream()
        )
        for pending_doc in pending_docs:
            pending_data = pending_doc.to_dict() or {}
            pending_normalized = pending_data.get('normalizedTrainerName') or _normalize_trainer_name(
                pending_data.get('trainerName', '')
            )
            if pending_normalized == normalized_name:
                return jsonify({
                    'message': 'Trainer approval request already pending',
                    'id': pending_doc.id
                }), 200

        request_data = {
            'trainerName': trainer_name,
            'normalizedTrainerName': normalized_name,
            'requesterName': data.get('requesterName', ''),
            'requesterUid': uid,
            'status': 'pending',
            'createdAt': firestore.SERVER_TIMESTAMP,
        }
        _, doc_ref = db.collection('trainer_requests').add(request_data)
        return jsonify({'message': 'Trainer approval request submitted', 'id': doc_ref.id}), 201
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/trainers/requests', methods=['GET'])
def get_trainer_requests():
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        docs = (
            db.collection('trainer_requests')
            .order_by('createdAt', direction=firestore.Query.DESCENDING)
            .stream()
        )
        requests_list = []
        for doc in docs:
            rd = doc.to_dict()
            rd['id'] = doc.id
            if 'createdAt' in rd and rd['createdAt']:
                rd['createdAt'] = int(rd['createdAt'].timestamp() * 1000)
            requests_list.append(rd)
        return jsonify({'requests': requests_list}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/trainers/requests/<request_id>/approve', methods=['POST'])
def approve_trainer_request(request_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json()
        request_doc = db.collection('trainer_requests').document(request_id).get()
        if not request_doc.exists:
            return jsonify({'message': 'Request not found'}), 404

        request_data = request_doc.to_dict() or {}
        trainer_name = (request_data.get('trainerName') or '').strip()
        normalized_name = request_data.get('normalizedTrainerName') or _normalize_trainer_name(trainer_name)
        require_dual_recording = data.get('dualRecordingRequired', False)

        existing_trainer_doc = _find_trainer_by_normalized_name(normalized_name)
        if existing_trainer_doc:
            db.collection('trainers').document(existing_trainer_doc.id).update({
                'status': 'approved',
                'dualRecordingRequired': require_dual_recording,
                'normalizedName': normalized_name,
                'updatedAt': firestore.SERVER_TIMESTAMP,
            })
        else:
            trainer_data = {
                'name': trainer_name,
                'normalizedName': normalized_name,
                'status': 'approved',
                'dualRecordingRequired': require_dual_recording,
                'createdAt': firestore.SERVER_TIMESTAMP,
                'updatedAt': firestore.SERVER_TIMESTAMP,
            }
            db.collection('trainers').add(trainer_data)

        # Mark all matching pending requests as approved in one operation.
        pending_docs = (
            db.collection('trainer_requests')
            .where('status', '==', 'pending')
            .stream()
        )
        matching_pending = []
        for pending_doc in pending_docs:
            pending_data = pending_doc.to_dict() or {}
            pending_normalized = pending_data.get('normalizedTrainerName') or _normalize_trainer_name(
                pending_data.get('trainerName', '')
            )
            if pending_normalized == normalized_name:
                matching_pending.append(pending_doc)

        batch = db.batch()
        for pending_doc in matching_pending:
            batch.update(pending_doc.reference, {
                'status': 'approved',
                'approvedAt': firestore.SERVER_TIMESTAMP,
                'normalizedTrainerName': normalized_name,
            })
        batch.commit()

        approved_count = max(1, len(matching_pending))
        return jsonify({
            'message': 'Trainer approved and matching requests resolved',
            'resolvedRequests': approved_count
        }), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@admin_bp.route('/trainers/requests/<request_id>/reject', methods=['POST'])
def reject_trainer_request(request_id):
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        db.collection('trainer_requests').document(request_id).update({
            'status': 'rejected',
            'rejectedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'message': 'Trainer request rejected'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
