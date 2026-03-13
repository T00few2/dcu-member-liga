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

        trainer_data = {
            'name': name,
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
            update_data['name'] = data['name']
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
        trainer_name = data.get('trainerName')
        if not trainer_name:
            return jsonify({'message': 'Trainer name is required'}), 400

        request_data = {
            'trainerName': trainer_name,
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

        trainer_name = request_doc.to_dict().get('trainerName')
        trainer_data = {
            'name': trainer_name,
            'status': 'approved',
            'dualRecordingRequired': data.get('dualRecordingRequired', False),
            'createdAt': firestore.SERVER_TIMESTAMP,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }
        db.collection('trainers').add(trainer_data)
        db.collection('trainer_requests').document(request_id).update({
            'status': 'approved',
            'approvedAt': firestore.SERVER_TIMESTAMP,
        })
        return jsonify({'message': 'Trainer approved and added'}), 200
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
