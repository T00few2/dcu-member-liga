from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db
from services.results_processor import ResultsProcessor
from authz import require_admin, AuthzError

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
            
        db.collection('league').document('settings').set(update_data, merge=True)
        
        return jsonify({'message': 'Settings saved'}), 200
    except Exception as e:
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
        
        db.collection('league').document('standings').set({
            'standings': standings,
            'updatedAt': firestore.SERVER_TIMESTAMP
        })
        
        return jsonify({'standings': standings}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500
