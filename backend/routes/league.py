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
from authz import require_admin, AuthzError

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
        data = request.get_json()
        name = data.get('name')
        finish_points = data.get('finishPoints', [])
        sprint_points = data.get('sprintPoints', [])
        league_rank_points = data.get('leagueRankPoints', [])
        best_races_count = data.get('bestRacesCount', 5)
        
        update_data = {
            'finishPoints': finish_points,
            'sprintPoints': sprint_points,
            'leagueRankPoints': league_rank_points,
            'bestRacesCount': best_races_count,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }
        
        if name is not None:
            update_data['name'] = name
        update_data = with_schema_version(update_data)
        log_schema_issues(logger, "league/settings (save)", validate_league_settings_doc(update_data, partial=True))
            
        db.collection('league').document('settings').set(update_data, merge=True)
        
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
