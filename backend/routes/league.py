from flask import Blueprint, request, jsonify
from firebase_admin import auth, firestore
from extensions import db
from services.results_processor import ResultsProcessor

league_bp = Blueprint('league', __name__)

def verify_admin_auth():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise Exception('Unauthorized')
    try:
        id_token = auth_header.split('Bearer ')[1]
        auth.verify_id_token(id_token)
    except Exception:
        raise Exception('Unauthorized')

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
    except:
        return jsonify({'message': 'Unauthorized'}), 401

    if not db:
            return jsonify({'error': 'DB not available'}), 500
    
    try:
        data = request.get_json()
        finish_points = data.get('finishPoints', [])
        sprint_points = data.get('sprintPoints', [])
        league_rank_points = data.get('leagueRankPoints', [])
        best_races_count = data.get('bestRacesCount', 5)
        
        db.collection('league').document('settings').set({
            'finishPoints': finish_points,
            'sprintPoints': sprint_points,
            'leagueRankPoints': league_rank_points,
            'bestRacesCount': best_races_count,
            'updatedAt': firestore.SERVER_TIMESTAMP
        }, merge=True)
        
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
