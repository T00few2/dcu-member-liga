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
        deadline_days = data.get('deadlineDays', 2)

        # 1. Get all eligible users (registered, not currently pending/submitted)
        users_ref = db.collection('users')
        # We filter for users who are registered.
        # Prefer new schema 'registration.status' = 'complete'
        # But also support old field 'registrationComplete' = True for legacy
        # Firestore OR queries are restricted, so we might need two queries or one big fetch.
        # Given small user base (~1000), streaming all and filtering in memory is safest/easiest.
        docs = users_ref.stream()
        
        eligible_riders = []
        for doc in docs:
            u = doc.to_dict()
            uid = doc.id
            
            # Check registration status (support both schemas)
            is_registered = False
            reg = u.get('registration', {})
            if reg.get('status') == 'complete':
                is_registered = True
            elif u.get('registrationComplete') is True:
                is_registered = True
            elif u.get('verified') is True: # ultra-legacy
                is_registered = True
                
            if not is_registered:
                continue

            # Skip if already pending or submitted
            current_status = u.get('verification', {}).get('status', 'none')
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
                'verification.status': 'pending',
                'verification.currentRequest': new_request,
                'verification.history': firestore.ArrayUnion([new_request]),
                # Clean up legacy fields if they exist? Maybe separate script is safer.
                # But let's stop writing them.
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

        # Resolve user doc via Auth Mapping
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        doc_id = uid  # Default if no mapping

        if mapping_doc.exists:
            m_data = mapping_doc.to_dict()
            zwift_id = m_data.get('zwiftId')
            e_license = m_data.get('eLicense')
            
            if zwift_id:
                doc_id = str(zwift_id)
            elif e_license:
                doc_id = str(e_license)

        user_ref = db.collection('users').document(doc_id)
        user_doc = user_ref.get()
        if not user_doc.exists:
             return jsonify({'message': 'User profile not found'}), 404
             
        user_data = user_doc.to_dict()
        
        # Check if they actually have a pending request
        verification = user_data.get('verification', {})
        if verification.get('status') != 'pending':
             return jsonify({'message': 'No pending verification request found.'}), 400
             
        # Find the pending request in history to update it
        requests = verification.get('history', [])
        # We need to find the one with status 'pending' (or the latest one)
        # Since ArrayUnion/Remove is hard for modifying objects, we read, modify, write.
        
        updated_requests = []
        found = False
        current_req = verification.get('currentRequest', {})
        
        # Update current request object as well if it matches
        if current_req.get('status') == 'pending':
            current_req['status'] = 'submitted'
            current_req['videoLink'] = video_link
            current_req['submittedAt'] = datetime.now().isoformat()
            found = True
            
        # Also update history entry
        for req in requests:
            if req.get('status') == 'pending' and req.get('type') == 'weight':
                req['status'] = 'submitted'
                req['videoLink'] = video_link
                req['submittedAt'] = datetime.now().isoformat()
            updated_requests.append(req)

        user_ref.update({
            'verification.status': 'submitted',
            'verification.currentRequest': current_req,
            'verification.history': updated_requests
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
        target_user_id = data.get('userId') # This is likely ZwiftID or eLicense or UID
        action = data.get('action')
        reason = data.get('reason', '')
        
        if action not in ['approve', 'reject']:
            return jsonify({'message': 'Invalid action'}), 400
            
        user_ref = db.collection('users').document(str(target_user_id))
        user_doc = user_ref.get()
        if not user_doc.exists:
            return jsonify({'message': 'User not found'}), 404
            
        user_data = user_doc.to_dict()
        requests = user_data.get('verification', {}).get('history', [])
        
        # Find the submitted request
        updated_requests = []
        found = False
        reviewer_id = "Admin"
        try:
            auth_header = request.headers.get('Authorization')
            if auth_header:
                id_token = auth_header.split('Bearer ')[1]
                decoded = auth.verify_id_token(id_token)
                admin_uid = decoded['uid']
                
                # Try to get admin's name
                mapping_doc = db.collection('auth_mappings').document(admin_uid).get()
                admin_doc = None
                
                if mapping_doc.exists:
                    m_data = mapping_doc.to_dict()
                    zwift_id = m_data.get('zwiftId')
                    e_license = m_data.get('eLicense')
                    
                    if zwift_id:
                        admin_doc = db.collection('users').document(str(zwift_id)).get()
                    elif e_license:
                        admin_doc = db.collection('users').document(str(e_license)).get()
                else:
                    admin_doc = db.collection('users').document(admin_uid).get()
                
                if admin_doc and admin_doc.exists:
                    reviewer_id = admin_doc.to_dict().get('name', 'Admin')
                else:
                    # Fallback check users/admin_uid just in case
                    admin_doc = db.collection('users').document(admin_uid).get()
                    if admin_doc.exists:
                         reviewer_id = admin_doc.to_dict().get('name', 'Admin')

        except Exception as e:
            print(f"Could not resolve admin name: {e}")
            pass
        
        new_status = 'approved' if action == 'approve' else 'rejected'
        
        for req in requests:
            if req.get('status') == 'submitted' and req.get('type') == 'weight':
        now_iso = datetime.now().isoformat()
        current_req = user_data.get('verification', {}).get('currentRequest', {})
        if current_req.get('status') == 'submitted':
             current_req['status'] = new_status
             current_req['reviewedAt'] = now_iso
             current_req['reviewerId'] = reviewer_id
             if action == 'reject': current_req['rejectionReason'] = reason
             found = True

        for req in requests:
            if req.get('status') == 'submitted' and req.get('type') == 'weight':
                req['status'] = new_status
                req['reviewedAt'] = now_iso
                req['reviewerId'] = reviewer_id
                if action == 'reject':
                    req['rejectionReason'] = reason
                found = True
            updated_requests.append(req)
            
        if not found:
            return jsonify({'message': 'No submitted verification found to review.'}), 400
            
        updates = {
            'verification.status': new_status,
            'verification.history': updated_requests,
            'verification.currentRequest': current_req
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

@verification_bp.route('/admin/verification/approved', methods=['GET'])
def get_approved_verifications():
    """
    Get list of users with 'approved' status.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500
        
    try:
        users_ref = db.collection('users')
        docs = users_ref.where('weightVerificationStatus', '==', 'approved').limit(50).stream()
        
        approved = []
        for doc in docs:
            data = doc.to_dict()
            requests = data.get('verificationRequests', [])
            # Find the approved request (most recent one preferably)
            # Sort requests by reviewedAt descending if possible, or just find the one with status approved
            # For simplicity, we look for the last one with status == 'approved'
            approved_req = next((r for r in reversed(requests) if r.get('status') == 'approved'), {})
            
            approved.append({
                'id': doc.id,
                'name': data.get('name', 'Unknown'),
                'eLicense': data.get('eLicense', ''),
                'club': data.get('club', ''),
                'approvedAt': approved_req.get('reviewedAt'),
                'approvedBy': approved_req.get('reviewerId', 'Admin')
            })
            
        return jsonify({'approved': approved}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
