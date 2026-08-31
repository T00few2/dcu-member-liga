import logging

from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db
from services.results_processor import ResultsProcessor
from services.schema_validation import (
    log_schema_issues,
    validate_league_settings_doc,
    validate_league_standings_doc,
    with_schema_version,
)
from services.request_models import LeagueSettingsRequest, parse_body
from authz import require_admin, verify_user_token, AuthzError
from routes.verification import _build_race_weight_verifications
from routes.races import _strip_hr_from_dr_result
from services.dual_recording.scope import public_dr_row_visible
from services.dual_recording_admin_core import DualRecordingError, get_dual_recording_result
from services.dual_recording_core import _load_dr_stream_blob_result

logger = logging.getLogger(__name__)

league_bp = Blueprint('league', __name__)

def verify_admin_auth():
    return require_admin(request)

@league_bp.route('/league/settings', methods=['GET'])
def get_settings():
    if not db:
            return jsonify({'error': 'DB not available'}), 500
    try:
        doc = db.collection('league').document('settings').get()
        settings = doc.to_dict() if doc.exists else {}
        return jsonify({'settings': settings}), 200
    except Exception as e:
        logger.error(f"Get settings error: {e}")
        return jsonify({'message': str(e)}), 500

@league_bp.route('/league/settings', methods=['POST'])
def save_settings():
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
            return jsonify({'error': 'DB not available'}), 500
    
    try:
        body, err = parse_body(LeagueSettingsRequest, request.get_json(silent=True) or {})
        if err:
            return err

        update_data: dict = {
            'finishPoints': body.finishPoints,
            'sprintPoints': body.sprintPoints,
            'leagueRankPoints': body.leagueRankPoints,
            'bestRacesCount': body.bestRacesCount,
            'updatedAt': firestore.SERVER_TIMESTAMP,
        }
        if body.name is not None:
            update_data['name'] = body.name
        if body.gracePeriod is not None:
            update_data['gracePeriod'] = body.gracePeriod
        if body.seasonStart is not None:
            update_data['seasonStart'] = body.seasonStart
        if body.seasonRankPoints is not None:
            update_data['seasonRankPoints'] = body.seasonRankPoints.model_dump(exclude_none=True)
        if body.seasonBestResultsCount is not None:
            update_data['seasonBestResultsCount'] = body.seasonBestResultsCount
        if body.weightVerificationValidDays is not None:
            update_data['weightVerificationValidDays'] = body.weightVerificationValidDays
        if body.defaultEventMode is not None:
            update_data['defaultEventMode'] = body.defaultEventMode
        if body.defaultSingleCategories is not None:
            update_data['defaultSingleCategories'] = [
                row.model_dump(exclude_none=True) for row in body.defaultSingleCategories
            ]
        if body.defaultEventConfiguration is not None:
            update_data['defaultEventConfiguration'] = [
                row.model_dump(exclude_none=True) for row in body.defaultEventConfiguration
            ]
        if body.defaultRaceGroups is not None:
            update_data['defaultRaceGroups'] = [
                row.model_dump(exclude_none=True) for row in body.defaultRaceGroups
            ]

        update_data = with_schema_version(update_data)
        log_schema_issues(logger, "league/settings (save)", validate_league_settings_doc(update_data, partial=True))
        db.collection('league').document('settings').set(update_data, merge=True)

        # Season tables / best-X affect season standings immediately.
        try:
            ResultsProcessor(db, None, None).recalculate_season_standings()
        except Exception as recalc_err:
            logger.error(f"Standings recalc after settings save failed: {recalc_err}")

        return jsonify({'message': 'Settings saved'}), 200
    except Exception as e:
        logger.error(f"Save settings error: {e}")
        return jsonify({'message': str(e)}), 500

@league_bp.route('/league/standings', methods=['GET'])
def get_standings():
    if not db:
            return jsonify({'error': 'DB not available'}), 500
    try:
        doc = db.collection('league').document('standings').get()
        if doc.exists:
            data = doc.to_dict()
            standings = data.get('standings')
            if standings:
                return jsonify({'standings': standings}), 200

        # Fallback: Calculate
        processor = ResultsProcessor(db, None, None) 
        standings = processor.calculate_league_standings()
        
        standings_payload = with_schema_version({
            'standings': standings,
            'updatedAt': firestore.SERVER_TIMESTAMP
        })
        log_schema_issues(logger, "league/standings (fallback calc)", validate_league_standings_doc(standings_payload))
        db.collection('league').document('standings').set(standings_payload)
        
        return jsonify({'standings': standings}), 200
    except Exception as e:
        logger.error(f"Get standings error: {e}")
        return jsonify({'message': str(e)}), 500


@league_bp.route('/archives', methods=['GET'])
def list_archives():
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        docs = db.collection('archives').stream()
        archives = []
        for doc in docs:
            d = doc.to_dict() or {}
            archived_at = d.get('archivedAt')
            archives.append({
                'id': doc.id,
                'name': d.get('name', ''),
                'archivedAt': archived_at.timestamp() * 1000 if hasattr(archived_at, 'timestamp') else None,
                'raceCount': d.get('raceCount', 0),
            })
        archives.sort(key=lambda x: x['archivedAt'] or 0, reverse=True)
        return jsonify({'archives': archives}), 200
    except Exception as e:
        logger.error(f"List archives error: {e}")
        return jsonify({'message': str(e)}), 500


@league_bp.route('/archives/<archive_id>', methods=['GET'])
def get_archive(archive_id):
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        doc = db.collection('archives').document(archive_id).get()
        if not doc.exists:
            return jsonify({'message': 'Archive not found'}), 404
        d = doc.to_dict() or {}
        archived_at = d.get('archivedAt')

        # List races (summary only)
        race_docs = db.collection('archives').document(archive_id).collection('races').stream()
        races = []
        for race_doc in race_docs:
            rd = race_doc.to_dict() or {}
            races.append({
                'id': race_doc.id,
                'name': rd.get('name', ''),
                'date': rd.get('date', ''),
                'hasResults': bool(rd.get('results')),
            })
        races.sort(key=lambda x: x['date'])

        return jsonify({
            'id': doc.id,
            'name': d.get('name', ''),
            'archivedAt': archived_at.timestamp() * 1000 if hasattr(archived_at, 'timestamp') else None,
            'settings': d.get('settings', {}),
            'standings': d.get('standings', {}),
            'races': races,
        }), 200
    except Exception as e:
        logger.error(f"Get archive error: {e}")
        return jsonify({'message': str(e)}), 500


@league_bp.route('/archives/<archive_id>/races/<race_id>', methods=['GET'])
def get_archive_race(archive_id, race_id):
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        doc = db.collection('archives').document(archive_id).collection('races').document(race_id).get()
        if not doc.exists:
            return jsonify({'message': 'Race not found'}), 404
        return jsonify({'race': {**doc.to_dict(), 'id': doc.id}}), 200
    except Exception as e:
        logger.error(f"Get archive race error: {e}")
        return jsonify({'message': str(e)}), 500


def _archive_race_ref(archive_id: str, race_id: str):
    return (
        db.collection('archives')
        .document(str(archive_id))
        .collection('races')
        .document(str(race_id))
    )


@league_bp.route('/archives/<archive_id>/races/<race_id>/dr-verifications', methods=['GET'])
def get_archive_race_dr_verifications(archive_id: str, race_id: str):
    """Return archived DR verification summaries for Historik race results."""
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_ref = _archive_race_ref(archive_id, race_id)
        if not race_ref.get().exists:
            return jsonify({'message': 'Race not found'}), 404

        out = []
        for d in race_ref.collection('dr_verifications').stream():
            payload = d.to_dict() or {}
            payload['zwiftId'] = str(payload.get('zwiftId') or d.id)
            if not public_dr_row_visible(payload):
                continue
            out.append(payload)
        return jsonify({'verifications': out}), 200
    except Exception as e:
        logger.error(
            "Archive DR list error archive=%s race=%s: %s",
            archive_id,
            race_id,
            e,
        )
        return jsonify({'message': str(e)}), 500


@league_bp.route(
    '/archives/<archive_id>/races/<race_id>/dr-verifications/<rider_id>',
    methods=['GET'],
)
def get_archive_race_dr_verification_detail(archive_id: str, race_id: str, rider_id: str):
    """
    Return DR detail for Historik modal.

    Prefer stream blob referenced by the archived verification doc (same as live
    cache). Fall back to live races/{raceId} cache if still present. If neither
    has streams, return a summary payload so the modal can show status without graphs.
    """
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_ref = _archive_race_ref(archive_id, race_id)
        if not race_ref.get().exists:
            return jsonify({'message': 'Race not found'}), 404

        doc = race_ref.collection('dr_verifications').document(str(rider_id)).get()
        if not doc.exists:
            return jsonify({'message': 'Verification not found'}), 404

        verification = doc.to_dict() or {}
        verification['zwiftId'] = str(verification.get('zwiftId') or doc.id)
        verification['raceId'] = str(verification.get('raceId') or race_id)
        if not public_dr_row_visible(verification):
            return jsonify({'message': 'Verification not found'}), 404

        stream_blob_path = str(verification.get('streamBlobPath') or '').strip()
        if stream_blob_path:
            cached_result = _load_dr_stream_blob_result(stream_blob_path)
            if cached_result:
                return jsonify(_strip_hr_from_dr_result(cached_result)), 200

        # Transitional: live race/cache may still exist before season reset.
        try:
            live_result = get_dual_recording_result(
                db=db,
                rider_id=str(rider_id),
                zwift_activity_id=None,
                strava_activity_id=None,
                event_start_iso=None,
                race_id=str(race_id),
                logger=logger,
            )
            return jsonify(_strip_hr_from_dr_result(live_result)), 200
        except DualRecordingError:
            pass

        # No stream cache (e.g. sw_only) — return summary so modal shows status.
        return jsonify({
            'status': verification.get('status') or 'unknown',
            'zwiftId': verification.get('zwiftId'),
            'raceId': verification.get('raceId'),
            'activityId': verification.get('activityId'),
            'stravaActivityId': verification.get('stravaActivityId'),
            'passed': verification.get('passed'),
            'failingMetrics': verification.get('failingMetrics') or [],
            'comparison': verification.get('comparison') or {'cpDiff': [], 'avgPower': {}},
            'verifiedAt': verification.get('verifiedAt'),
            'streamUnavailable': True,
            'message': 'No stream cache available for this archived verification',
        }), 200
    except Exception as e:
        logger.error(
            "Archive DR detail error archive=%s race=%s rider=%s: %s",
            archive_id,
            race_id,
            rider_id,
            e,
        )
        return jsonify({'message': str(e)}), 500


@league_bp.route('/archives/<archive_id>/races/<race_id>/weight-verifications', methods=['GET'])
def get_archive_race_weight_verifications(archive_id: str, race_id: str):
    """
    Return weight verification statuses for an archived race.
    Built from live user verification requests matched by raceId (not stored in archive).
    """
    try:
        verify_user_token(request)
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

    if not db:
        return jsonify({'error': 'DB not available'}), 500

    try:
        race_ref = _archive_race_ref(archive_id, race_id)
        if not race_ref.get().exists:
            return jsonify({'message': 'Race not found'}), 404

        verifications = _build_race_weight_verifications(str(race_id))
        public_rows = [{
            'zwiftId': str(v.get('zwiftId') or ''),
            'status': str(v.get('status') or ''),
        } for v in verifications if str(v.get('zwiftId') or '').strip()]
        return jsonify({'verifications': public_rows}), 200
    except Exception as e:
        logger.error(
            "Archive weight list error archive=%s race=%s: %s",
            archive_id,
            race_id,
            e,
        )
        return jsonify({'message': str(e)}), 500

