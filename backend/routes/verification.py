from flask import Blueprint, request, jsonify
from firebase_admin import firestore, auth
from extensions import db
from authz import require_admin, AuthzError
import uuid
import random
from datetime import datetime, timedelta, timezone
from typing import Any
from services.user_service import UserService

import logging

logger = logging.getLogger(__name__)

verification_bp = Blueprint('verification', __name__)


def _parse_race_datetime(value: Any) -> datetime | None:
    if isinstance(value, datetime):
        return value if value.tzinfo else value.replace(tzinfo=timezone.utc)
    raw = str(value or '').strip()
    if not raw:
        return None
    try:
        if raw.endswith('Z'):
            return datetime.fromisoformat(raw.replace('Z', '+00:00'))
        parsed = datetime.fromisoformat(raw)
        return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)
    except Exception:
        pass
    for fmt in ('%Y-%m-%dT%H:%M', '%Y-%m-%d'):
        try:
            parsed = datetime.strptime(raw, fmt)
            return parsed.replace(tzinfo=timezone.utc)
        except Exception:
            continue
    return None


def _collect_finisher_ids_from_results(results: dict[str, Any] | None) -> set[str]:
    finishers: set[str] = set()
    if not isinstance(results, dict):
        return finishers

    for riders in results.values():
        if not isinstance(riders, list):
            continue
        for rider in riders:
            if not isinstance(rider, dict):
                continue
            zid = str(rider.get('zwiftId') or '').strip()
            finish_time = int(rider.get('finishTime') or 0)
            if zid and finish_time > 0:
                finishers.add(zid)
    return finishers


def _resolve_target_race(race_id: str | None) -> tuple[str | None, dict[str, Any], set[str]]:
    if not db:
        return None, {}, set()

    if race_id:
        race_doc = db.collection('races').document(str(race_id)).get()
        if not race_doc.exists:
            return None, {}, set()
        race_data = race_doc.to_dict() or {}
        finishers = _collect_finisher_ids_from_results(race_data.get('results'))
        return race_doc.id, race_data, finishers

    now_utc = datetime.now(timezone.utc)
    best_id = None
    best_data: dict[str, Any] = {}
    best_finishers: set[str] = set()
    best_dt: datetime | None = None

    for race_doc in db.collection('races').stream():
        race_data = race_doc.to_dict() or {}
        finishers = _collect_finisher_ids_from_results(race_data.get('results'))
        if not finishers:
            continue
        race_dt = _parse_race_datetime(race_data.get('date')) or _parse_race_datetime(race_data.get('resultsUpdatedAt'))
        if race_dt and race_dt > now_utc + timedelta(hours=6):
            continue
        if not best_id:
            best_id = race_doc.id
            best_data = race_data
            best_finishers = finishers
            best_dt = race_dt
            continue
        if best_dt is None and race_dt is None:
            continue
        if best_dt is None and race_dt is not None:
            best_id = race_doc.id
            best_data = race_data
            best_finishers = finishers
            best_dt = race_dt
            continue
        if best_dt is not None and race_dt is not None and race_dt > best_dt:
            best_id = race_doc.id
            best_data = race_data
            best_finishers = finishers
            best_dt = race_dt

    return best_id, best_data, best_finishers


def _extract_weight_kg_from_row(row: Any) -> float | None:
    if not isinstance(row, dict):
        return None
    for key in ("weightKg", "weight", "profileWeight", "zwiftWeight"):
        raw = row.get(key)
        if raw is None:
            continue
        try:
            val = float(raw)
        except (TypeError, ValueError):
            continue
        # Heuristic: values above ~1000 are likely grams.
        if val > 1000:
            val = val / 1000.0
        if val > 0:
            return round(val, 1)
    return None


def _extract_weight_kg_from_user(user_dict: dict[str, Any]) -> float | None:
    profile = user_dict.get("zwiftProfile") if isinstance(user_dict, dict) else {}
    if not isinstance(profile, dict):
        return None
    # Prefer top-level profile weight from Zwift; fall back to competition snapshot.
    raw = profile.get("weight")
    if raw is None:
        raw = profile.get("weightInGrams")
    if raw is None:
        return None
    try:
        val = float(raw)
    except (TypeError, ValueError):
        return None
    if val > 1000:
        val = val / 1000.0
    return round(val, 1) if val > 0 else None


def _resolve_latest_race_weight_for_rider(zwift_id: str, user_dict: dict[str, Any]) -> tuple[float | None, str | None, str | None]:
    if not db:
        return _extract_weight_kg_from_user(user_dict), None, None

    best_weight: float | None = None
    best_name: str | None = None
    best_date_raw: str | None = None
    best_ts = float("-inf")
    target_id = str(zwift_id or "").strip()
    if not target_id:
        return _extract_weight_kg_from_user(user_dict), None, None

    for race_doc in db.collection("races").stream():
        race = race_doc.to_dict() or {}
        race_date_raw = str(race.get("date") or "")
        race_dt = _parse_race_datetime(race.get("date")) or _parse_race_datetime(race.get("resultsUpdatedAt"))
        race_ts = race_dt.timestamp() if race_dt else float("-inf")
        results = race.get("results") or {}
        if not isinstance(results, dict):
            continue
        for riders in results.values():
            if not isinstance(riders, list):
                continue
            for row in riders:
                if str((row or {}).get("zwiftId") or "").strip() != target_id:
                    continue
                weight = _extract_weight_kg_from_row(row)
                # Keep latest race match; prefer rows that actually include a weight.
                if (weight is not None and race_ts >= best_ts) or (best_weight is None and race_ts > best_ts):
                    best_weight = weight
                    best_name = str(race.get("name") or "")
                    best_date_raw = race_date_raw or (race_dt.isoformat() if race_dt else None)
                    best_ts = race_ts
                break

    if best_weight is None:
        best_weight = _extract_weight_kg_from_user(user_dict)
    return best_weight, best_name, best_date_raw

@verification_bp.route('/admin/verification/trigger', methods=['POST'])
def trigger_verification():
    """
    Admin endpoint to randomly select a percentage of riders for weight verification.
    Body: { "percentage": 5, "deadlineDays": 7, "raceId": "optional-race-id" }
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        data = request.get_json() or {}
        percentage = data.get('percentage', 5)
        deadline_days = data.get('deadlineDays', 2)
        requested_race_id = data.get('raceId')

        target_race_id, target_race, finisher_ids = _resolve_target_race(requested_race_id)
        if not target_race_id:
            return jsonify({
                'message': 'No finished race with results found.',
                'selectedCount': 0,
                'totalEligible': 0
            }), 400
        if not finisher_ids:
            return jsonify({
                'message': f'Race {target_race_id} has no finishers in stored results.',
                'selectedCount': 0,
                'totalEligible': 0,
                'raceId': target_race_id
            }), 400

        # 1. Get all eligible users from selected race finishers (registered, not pending/submitted)
        all_users = UserService.get_all_participants(limit=2000) # Fetch all active
        
        eligible_riders = []
        for user in all_users:
            if not user.is_registered:
                continue
            user_id = str(user.id or '').strip()
            user_zwift_id = str(user.zwift_id or '').strip()
            if user_id not in finisher_ids and user_zwift_id not in finisher_ids:
                continue

            # Skip if already pending or submitted
            if user.verification_status in ['pending', 'submitted']:
                continue
            eligible_riders.append(user.id)

        if not eligible_riders:
            race_name = target_race.get('name') or target_race_id
            return jsonify({
                'message': f'No eligible finishers found for race "{race_name}".',
                'selectedCount': 0,
                'totalEligible': 0,
                'raceId': target_race_id,
                'raceName': target_race.get('name', ''),
                'totalFinishers': len(finisher_ids),
            }), 200

        # 2. Select Random Sample
        count_to_select = max(1, int(len(eligible_riders) * (percentage / 100)))
        selected_ids = random.sample(eligible_riders, min(len(eligible_riders), count_to_select))

        # 3. Update User Docs
        deadline = datetime.now(timezone.utc) + timedelta(days=deadline_days)
        batch = db.batch()
        
        updated_count = 0
        now = datetime.now(timezone.utc).isoformat()
        
        for uid in selected_ids:
            doc_ref = db.collection('users').document(uid)
            
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
            'totalEligible': len(eligible_riders),
            'raceId': target_race_id,
            'raceName': target_race.get('name', ''),
            'totalFinishers': len(finisher_ids),
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

        # Resolve user
        user = UserService.get_user_by_auth_uid(uid)
        if not user:
             return jsonify({'message': 'User profile not found'}), 404
             
        # Check if they actually have a pending request
        if user.verification_status != 'pending':
             return jsonify({'message': 'No pending verification request found.'}), 400
             
        # Find the pending request in history to update it
        requests = user.verification_history
        
        updated_requests = []
        found = False
        current_req = user.current_verification_request
        
        # Update current request object as well if it matches
        if current_req.get('status') == 'pending':
            current_req['status'] = 'submitted'
            current_req['videoLink'] = video_link
            current_req['submittedAt'] = datetime.now(timezone.utc).isoformat()
            found = True
            
        # Also update history entry
        for req in requests:
            if req.get('status') == 'pending' and req.get('type') == 'weight':
                req['status'] = 'submitted'
                req['videoLink'] = video_link
                req['submittedAt'] = datetime.now(timezone.utc).isoformat()
            updated_requests.append(req)

        user.update({
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
    Also supports amending a previous approved/rejected decision.
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
        target_user_id = data.get('userId') # This is likely ZwiftID or UID
        action = data.get('action')
        reason = data.get('reason', '')
        
        if action not in ['approve', 'reject']:
            return jsonify({'message': 'Invalid action'}), 400
            
        
        user = UserService.get_user_by_id(target_user_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404
            
        requests = user.verification_history
        
        # Find the reviewable request (submitted, approved, or rejected)
        updated_requests = []
        found = False
        reviewer_id = "Admin"
        try:
            auth_header = request.headers.get('Authorization')
            if auth_header:
                id_token = auth_header.split('Bearer ')[1]
                decoded = auth.verify_id_token(id_token)
                admin_uid = decoded['uid']
                
                reviewer_id = "Admin"
                if admin_uid:
                     admin_user = UserService.get_user_by_auth_uid(admin_uid)
                     if admin_user:
                         reviewer_id = admin_user.name or 'Admin'

        except Exception as e:
            logger.error(f"Could not resolve admin name: {e}")
            pass
        
        new_status = 'approved' if action == 'approve' else 'rejected'

        now_iso = datetime.now(timezone.utc).isoformat()
        current_req = user.current_verification_request if isinstance(user.current_verification_request, dict) else {}
        reviewable_statuses = {'submitted', 'approved', 'rejected'}

        target_request_id = str(current_req.get('requestId') or '').strip()
        if target_request_id:
            for req in reversed(requests):
                if req.get('type') != 'weight':
                    continue
                if str(req.get('requestId') or '').strip() == target_request_id:
                    found = True
                    break

        if not found:
            for req in reversed(requests):
                if req.get('type') == 'weight' and req.get('status') in reviewable_statuses:
                    target_request_id = str(req.get('requestId') or '').strip()
                    found = True
                    break

        if not found and current_req.get('type') == 'weight' and current_req.get('status') in reviewable_statuses:
            found = True
            target_request_id = str(current_req.get('requestId') or '').strip()

        if not found:
            return jsonify({'message': 'No reviewable verification found to update.'}), 400

        if current_req.get('type') == 'weight' and (
            (target_request_id and str(current_req.get('requestId') or '').strip() == target_request_id)
            or (not target_request_id and current_req.get('status') in reviewable_statuses)
        ):
            current_req['status'] = new_status
            current_req['reviewedAt'] = now_iso
            current_req['reviewerId'] = reviewer_id
            if action == 'reject':
                current_req['rejectionReason'] = reason
            else:
                current_req.pop('rejectionReason', None)

        for req in requests:
            matches_target = False
            if req.get('type') == 'weight':
                if target_request_id and str(req.get('requestId') or '').strip() == target_request_id:
                    matches_target = True
                elif not target_request_id and req.get('status') in reviewable_statuses:
                    matches_target = True

            if matches_target:
                req['status'] = new_status
                req['reviewedAt'] = now_iso
                req['reviewerId'] = reviewer_id
                if action == 'reject':
                    req['rejectionReason'] = reason
                else:
                    req.pop('rejectionReason', None)
                # Only update the first matching history item when requestId is absent.
                if not target_request_id:
                    target_request_id = str(req.get('requestId') or '__updated_once__')
            updated_requests.append(req)
            
        user.update({
            'verification.status': new_status,
            'verification.history': updated_requests,
            'verification.currentRequest': current_req
        })

        
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
        users = UserService.get_pending_verifications()
        
        pending = []
        for user in users:
            user_dict = user.to_dict() if hasattr(user, "to_dict") else {}
            rider_zwift_id = str((user_dict or {}).get("zwiftId") or user.id or "").strip()
            last_weight_kg, last_race_name, last_race_date = _resolve_latest_race_weight_for_rider(
                rider_zwift_id,
                user_dict or {},
            )
            latest_profile_updated_at = ((user_dict or {}).get('zwiftProfile') or {}).get('updatedAt')

            # Find the submitted request details
            requests = user.verification_history
            current = user.current_verification_request
            
            # Prefer current request if it matches
            active_req = current if current.get('status') == 'submitted' else next((r for r in requests if r.get('status') == 'submitted'), {})
            
            pending.append({
                'id': user.id,
                'name': user.name,
                'email': str((user_dict or {}).get('email') or ''),
                'club': user.club,
                'videoLink': active_req.get('videoLink'),
                'submittedAt': active_req.get('submittedAt'),
                'lastRaceWeightKg': last_weight_kg,
                'lastRaceName': last_race_name,
                'lastRaceDate': last_race_date,
                'latestProfileUpdatedAt': latest_profile_updated_at,
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
        users = UserService.get_active_verification_requests()
        
        active = []
        for user in users:
            current = user.current_verification_request
            user_dict = user.to_dict() if hasattr(user, "to_dict") else {}
            
            active.append({
                'id': user.id,
                'name': user.name,
                'email': str((user_dict or {}).get('email') or ''),
                'club': user.club,
                'deadline': current.get('deadline')
            })
            
        return jsonify({'requests': active}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@verification_bp.route('/admin/verification/revoke/<user_id>', methods=['POST'])
def revoke_verification(user_id):
    """
    Admin endpoint to revoke a pending verification request for a specific user.
    Resets their verification status back to 'none' and clears the current request.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        user = UserService.get_user_by_id(user_id)
        if not user:
            return jsonify({'message': 'User not found'}), 404

        if user.verification_status != 'pending':
            return jsonify({'message': 'User does not have a pending verification request'}), 400

        # Mark the current request as revoked in history
        requests = user.verification_history
        now_iso = datetime.now(timezone.utc).isoformat()
        updated_requests = []
        for req in requests:
            if req.get('status') == 'pending' and req.get('type') == 'weight':
                req['status'] = 'revoked'
                req['revokedAt'] = now_iso
            updated_requests.append(req)

        user.update({
            'verification.status': 'none',
            'verification.currentRequest': {},
            'verification.history': updated_requests
        })

        return jsonify({'message': 'Verification request revoked.'}), 200

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
        users = UserService.get_approved_verifications(limit=50)
        
        approved = []
        for user in users:
            requests = user.verification_history
            current = user.current_verification_request
            user_dict = user.to_dict() if hasattr(user, "to_dict") else {}
            rider_zwift_id = str((user_dict or {}).get("zwiftId") or user.id or "").strip()
            last_weight_kg, last_race_name, last_race_date = _resolve_latest_race_weight_for_rider(
                rider_zwift_id,
                user_dict or {},
            )
            latest_profile_updated_at = ((user_dict or {}).get('zwiftProfile') or {}).get('updatedAt')
            
            # Find the approved request (most recent one preferably)
            approved_req = current if current.get('status') == 'approved' else next((r for r in reversed(requests) if r.get('status') == 'approved'), {})
            
            approved.append({
                'id': user.id,
                'name': user.name,
                'club': user.club,
                'approvedAt': approved_req.get('reviewedAt'),
                'approvedBy': approved_req.get('reviewerId', 'Admin'),
                'videoLink': approved_req.get('videoLink'),
                'lastRaceWeightKg': last_weight_kg,
                'lastRaceName': last_race_name,
                'lastRaceDate': last_race_date,
                'latestProfileUpdatedAt': latest_profile_updated_at,
            })
            
        return jsonify({'approved': approved}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500


@verification_bp.route('/admin/verification/rejected', methods=['GET'])
def get_rejected_verifications():
    """
    Get list of users with 'rejected' status.
    """
    try:
        require_admin(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        users = UserService.get_rejected_verifications(limit=50)

        rejected = []
        for user in users:
            requests = user.verification_history
            current = user.current_verification_request
            user_dict = user.to_dict() if hasattr(user, "to_dict") else {}
            rider_zwift_id = str((user_dict or {}).get("zwiftId") or user.id or "").strip()
            last_weight_kg, last_race_name, last_race_date = _resolve_latest_race_weight_for_rider(
                rider_zwift_id,
                user_dict or {},
            )
            latest_profile_updated_at = ((user_dict or {}).get('zwiftProfile') or {}).get('updatedAt')

            rejected_req = current if current.get('status') == 'rejected' else next((r for r in reversed(requests) if r.get('status') == 'rejected'), {})

            rejected.append({
                'id': user.id,
                'name': user.name,
                'club': user.club,
                'rejectedAt': rejected_req.get('reviewedAt'),
                'rejectedBy': rejected_req.get('reviewerId', 'Admin'),
                'rejectionReason': rejected_req.get('rejectionReason', ''),
                'videoLink': rejected_req.get('videoLink'),
                'lastRaceWeightKg': last_weight_kg,
                'lastRaceName': last_race_name,
                'lastRaceDate': last_race_date,
                'latestProfileUpdatedAt': latest_profile_updated_at,
            })

        return jsonify({'rejected': rejected}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
