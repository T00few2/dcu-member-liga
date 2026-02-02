from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db, get_zwift_service, get_zwift_game_service
from services.results_processor import ResultsProcessor
from datetime import datetime
from authz import require_admin, AuthzError

races_bp = Blueprint('races', __name__)

def verify_admin_auth():
    # Backwards-compatible wrapper used throughout this file.
    return require_admin(request)

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
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

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
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

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
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code

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

@races_bp.route('/races/<race_id>/results/<category>/sprints', methods=['PUT'])
def update_sprint_data(race_id, category):
    """
    Update sprint data for riders in a specific category and recalculate all points.
    
    Request body:
    {
        "updates": [
            {
                "zwiftId": "12345",
                "sprintData": {
                    "sprint_key": { "worldTime": 1234567890, "time": 12345, "avgPower": 250 },
                    ...
                }
            },
            ...
        ]
    }
    """
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    
    if not db:
        return jsonify({'error': 'DB not available'}), 500
    
    try:
        req_data = request.get_json()
        updates = req_data.get('updates', [])
        
        if not updates:
            return jsonify({'message': 'No updates provided'}), 400
        
        # Fetch current race data
        race_doc = db.collection('races').document(race_id).get()
        if not race_doc.exists:
            return jsonify({'message': 'Race not found'}), 404
        
        race_data = race_doc.to_dict()
        results = race_data.get('results', {})
        
        if category not in results:
            return jsonify({'message': f'Category {category} not found in results'}), 404
        
        # Create lookup by zwiftId
        riders_by_id = {str(r['zwiftId']): r for r in results[category]}
        
        # Apply updates
        updated_count = 0
        for update in updates:
            zid = str(update.get('zwiftId'))
            new_sprint_data = update.get('sprintData', {})
            
            if zid in riders_by_id:
                rider = riders_by_id[zid]
                if 'sprintData' not in rider:
                    rider['sprintData'] = {}
                
                # Merge sprint data (update specific keys)
                for key, data in new_sprint_data.items():
                    if key not in rider['sprintData']:
                        rider['sprintData'][key] = {}
                    rider['sprintData'][key].update(data)
                
                updated_count += 1
        
        # Save updated results first
        db.collection('races').document(race_id).update({
            'results': results
        })
        
        # Now recalculate all points
        zwift_service = get_zwift_service()
        game_service = get_zwift_game_service()
        processor = ResultsProcessor(db, zwift_service, game_service)
        
        updated_results = processor.recalculate_race_points(race_id)
        
        return jsonify({
            'message': f'Updated {updated_count} riders, points recalculated',
            'results': updated_results
        }), 200
        
    except Exception as e:
        print(f"Sprint data update error: {e}")
        return jsonify({'message': str(e)}), 500


@races_bp.route('/races/<race_id>/results/refresh', methods=['POST'])
def refresh_results(race_id):
    try:
        verify_admin_auth()
    except AuthzError as e:
        return jsonify({'message': e.message}), e.status_code
    
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
