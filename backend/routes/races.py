from flask import Blueprint, request, jsonify
from firebase_admin import auth, firestore
from extensions import db, get_zwift_service, get_zwift_game_service
from services.results_processor import ResultsProcessor
from datetime import datetime

races_bp = Blueprint('races', __name__)

def verify_admin_auth():
    auth_header = request.headers.get('Authorization')
    if not auth_header or not auth_header.startswith('Bearer '):
        raise Exception('Unauthorized')
    try:
        id_token = auth_header.split('Bearer ')[1]
        auth.verify_id_token(id_token)
        # TODO: Add specific admin check here if needed
    except Exception:
        raise Exception('Unauthorized')

@races_bp.route('/races', methods=['GET'])
def get_races():
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    try:
        races_ref = db.collection('races').order_by('date')
        docs = races_ref.stream()
        races = []
        for doc in docs:
            r = doc.to_dict()
            r['id'] = doc.id
            races.append(r)
        return jsonify({'races': races}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races', methods=['POST'])
def create_race():
    try:
        verify_admin_auth()
    except:
        return jsonify({'message': 'Unauthorized'}), 401

    if not db:
        return jsonify({'error': 'DB not available'}), 500
        
    try:
        data = request.get_json()
        if not data.get('name') or not data.get('date'):
            return jsonify({'message': 'Missing required fields'}), 400
            
        _, doc_ref = db.collection('races').add(data)
        return jsonify({'message': 'Race created', 'id': doc_ref.id}), 201
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races/<race_id>', methods=['DELETE'])
def delete_race(race_id):
    try:
        verify_admin_auth()
    except:
        return jsonify({'message': 'Unauthorized'}), 401

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        db.collection('races').document(race_id).delete()
        return jsonify({'message': 'Race deleted'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races/<race_id>', methods=['PUT'])
def update_race(race_id):
    try:
        verify_admin_auth()
    except:
        return jsonify({'message': 'Unauthorized'}), 401

    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        data = request.get_json()
        if not data.get('name') or not data.get('date'):
            return jsonify({'message': 'Missing required fields'}), 400

        db.collection('races').document(race_id).update(data)
        return jsonify({'message': 'Race updated'}), 200
    except Exception as e:
        return jsonify({'message': str(e)}), 500

@races_bp.route('/races/<race_id>/results/refresh', methods=['POST'])
def refresh_results(race_id):
    try:
        verify_admin_auth()
    except:
        return jsonify({'message': 'Unauthorized'}), 401
    
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        zwift_service = get_zwift_service()
        game_service = get_zwift_game_service()
        processor = ResultsProcessor(db, zwift_service, game_service)
        
        req_data = request.get_json(silent=True) or {}
        fetch_mode = req_data.get('source', 'finishers')
        filter_registered = req_data.get('filterRegistered', True)
        category_filter = req_data.get('categoryFilter', 'All')
        
        results = processor.process_race_results(
            race_id, 
            fetch_mode=fetch_mode, 
            filter_registered=filter_registered,
            category_filter=category_filter
        )
        
        return jsonify({'message': f'Results calculated (Mode: {fetch_mode}, Cat: {category_filter})', 'results': results}), 200
    except Exception as e:
        print(f"Results Processing Error: {e}")
        return jsonify({'message': str(e)}), 500
