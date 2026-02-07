from flask import Blueprint, request, jsonify
from firebase_admin import firestore, auth
from extensions import db
from authz import require_admin, AuthzError
import uuid
import random
from datetime import datetime, timedelta

verification_bp = Blueprint('verification', __name__)

@verification_bp.route('/admin/verification/trigger', methods=['POST'])
def trigger_verification():
    """
    Admin endpoint to randomly select a percentage of riders for weight verification.
    Body: { "percentage": 5, "deadlineDays": 7 }
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json()
        percentage = data.get('percentage', 5)
        deadline_days = data.get('deadlineDays', 7)

        # 1. Get all eligible users (registered, not currently pending/submitted)
        users_ref = db.collection('users')
        # We can filters for users who are registered.
        # Note: Filtering by multiple fields might require index. 
        # For a small liga, fetching all and filtering in memory is acceptable and safer.
        docs = users_ref.where('registrationComplete', '==', True).stream()
        
        eligible_riders = []
        for doc in docs:
            u = doc.to_dict()
            uid = doc.id
            # Skip if already pending or submitted
            current_status = u.get('weightVerificationStatus', 'none')
            if current_status in ['pending', 'submitted']:
                continue
            eligible_riders.append(uid)

        # 2. Select Random Sample
        count_to_select = max(1, int(len(eligible_riders) * (percentage / 100)))
        selected_ids = random.sample(eligible_riders, min(len(eligible_riders), count_to_select))

        # 3. Update User Docs
        deadline = datetime.now() + timedelta(days=deadline_days)
        batch = db.batch()
        
        updated_count = 0
        now = datetime.now().isoformat()
        
        for uid in selected_ids:
            doc_ref = users_ref.document(uid)
            
            # Create new request object
            request_id = str(uuid.uuid4())
            new_request = {
                'requestId': request_id,
                'requestedAt': now,
                'type': 'weight',
                'status': 'pending',
                'deadline': deadline
            }
            
            updates = {
                'weightVerificationStatus': 'pending',
                'weightVerificationDeadline': deadline,
                'verificationRequests': firestore.ArrayUnion([new_request])
            }
            batch.update(doc_ref, updates)
            updated_count += 1
            
            # Commit batch every 400 updates (limit is 500)
            if updated_count % 400 == 0:
                batch.commit()
                batch = db.batch()

        if updated_count % 400 != 0:
            batch.commit()

        return jsonify({
            'message': f'Triggered verification for {len(selected_ids)} riders.',
            'selectedCount': len(selected_ids),
            'totalEligible': len(eligible_riders)
        }), 200

    except Exception as e:
        return jsonify({'message': str(e)}), 500


@verification_bp.route('/verification/submit', methods=['POST'])
def submit_verification():
    """
    User endpoint to submit a video link.
    Body: { "videoLink": "https://..." }
    """
    try:
        auth_header = request.headers.get('Authorization')
        if not auth_header or not auth_header.startswith('Bearer '):
            return jsonify({'message': 'Unauthorized'}), 401
        id_token = auth_header.split('Bearer ')[1]
        decoded = auth.verify_id_token(id_token)
        uid = decoded['uid']
    except Exception as e:
        return jsonify({'message': 'Unauthorized'}), 401

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json()
        video_link = data.get('videoLink')
        if not video_link:
            return jsonify({'message': 'Video link is required'}), 400

        # Resolve eLicense doc if needed (Auth Mapping)
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        if mapping_doc.exists:
            e_license = mapping_doc.to_dict().get('eLicense')
            doc_id = str(e_license)
        else:
            doc_id = uid

        user_ref = db.collection('users').document(doc_id)
        user_doc = user_ref.get()
        if not user_doc.exists:
             return jsonify({'message': 'User profile not found'}), 404
             
        user_data = user_doc.to_dict()
        
        # Check if they actually have a pending request
        if user_data.get('weightVerificationStatus') != 'pending':
             return jsonify({'message': 'No pending verification request found.'}), 400
             
        # Find the pending request in history to update it
        requests = user_data.get('verificationRequests', [])
        # We need to find the one with status 'pending' (or the latest one)
        # Since ArrayUnion/Remove is hard for modifying objects, we read, modify, write.
        
        updated_requests = []
        found = False
        for req in requests:
            if req.get('status') == 'pending' and req.get('type') == 'weight':
                req['status'] = 'submitted'
                req['videoLink'] = video_link
                req['submittedAt'] = datetime.now().isoformat()
                found = True
            updated_requests.append(req)
            
        if not found:
             # Should not happen if status was pending but safety check
             return jsonify({'message': 'Could not find the specific request object.'}), 500

        user_ref.update({
            'weightVerificationStatus': 'submitted',
            'weightVerificationVideoLink': video_link, # Quick access
            'weightVerificationDate': firestore.SERVER_TIMESTAMP,
            'verificationRequests': updated_requests
        })

        return jsonify({'message': 'Verification submitted successfully.'}), 200

    except Exception as e:
        return jsonify({'message': str(e)}), 500


@verification_bp.route('/admin/verification/review', methods=['POST'])
def review_verification():
    """
    Admin endpoint to approve/reject a submission.
    Body: { "userId": "...", "action": "approve" | "reject", "reason": "..." }
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
        
    try:
        data = request.get_json()
        target_user_id = data.get('userId') # This is likely eLicense or UID
        action = data.get('action')
        reason = data.get('reason', '')
        
        if action not in ['approve', 'reject']:
            return jsonify({'message': 'Invalid action'}), 400
            
        user_ref = db.collection('users').document(str(target_user_id))
        user_doc = user_ref.get()
        if not user_doc.exists:
            return jsonify({'message': 'User not found'}), 404
            
        user_data = user_doc.to_dict()
        requests = user_data.get('verificationRequests', [])
        
        # Find the submitted request
        updated_requests = []
        found = False
        reviewer_id = "Admin" # Could extract from token if we wanted specific admin ID
        
        new_status = 'approved' if action == 'approve' else 'rejected'
        
        for req in requests:
            if req.get('status') == 'submitted' and req.get('type') == 'weight':
                req['status'] = new_status
                req['reviewedAt'] = datetime.now().isoformat()
                req['reviewerId'] = reviewer_id
                if action == 'reject':
                    req['rejectionReason'] = reason
                found = True
            updated_requests.append(req)
            
        if not found:
            return jsonify({'message': 'No submitted verification found to review.'}), 400
            
        updates = {
            'weightVerificationStatus': new_status,
            'verificationRequests': updated_requests
        }
        
        if action == 'reject':
             # If rejected, they might need to resubmit? 
             # Or does it go back to 'none'?
             # Usually 'rejected' implies they failed. 
             # If we want them to retry, we might set status back to 'pending'?
             # For now, let's leave it as 'rejected' and Admin can trigger a new one if they want, 
             # OR we could have a 'retry' action.
             # Let's keep it simple: Rejected is rejected.
             pass
             
        user_ref.update(updates)
        
        return jsonify({'message': f'Verification {new_status}.'}), 200

    except Exception as e:
        return jsonify({'message': str(e)}), 500

@verification_bp.route('/admin/verification/pending', methods=['GET'])
def get_pending_verifications():
    """
    Get list of users with 'submitted' status.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
        
    try:
        # Fetch users where status is 'submitted'
        users_ref = db.collection('users')
        docs = users_ref.where('weightVerificationStatus', '==', 'submitted').stream()
        
        pending = []
        for doc in docs:
            data = doc.to_dict()
            # Find the submitted request details
            requests = data.get('verificationRequests', [])
            active_req = next((r for r in requests if r.get('status') == 'submitted'), {})
            
            pending.append({
                'id': doc.id,
                'name': data.get('name', 'Unknown'),
                'eLicense': data.get('eLicense', ''),
                'club': data.get('club', ''),
                'videoLink': data.get('weightVerificationVideoLink') or active_req.get('videoLink'),
                'submittedAt': active_req.get('submittedAt') or data.get('weightVerificationDate')
            })
            
        return jsonify({'pending': pending}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@verification_bp.route('/admin/verification/requests', methods=['GET'])
def get_active_requests():
    """
    Get list of users with 'pending' status (awaiting submission).
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
        
    try:
        users_ref = db.collection('users')
        docs = users_ref.where('weightVerificationStatus', '==', 'pending').stream()
        
        active = []
        for doc in docs:
            data = doc.to_dict()
            active.append({
                'id': doc.id,
                'name': data.get('name', 'Unknown'),
                'eLicense': data.get('eLicense', ''),
                'club': data.get('club', ''),
                'deadline': data.get('weightVerificationDeadline')
            })
            
        return jsonify({'requests': active}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
