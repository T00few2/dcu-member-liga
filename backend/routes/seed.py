from flask import Blueprint, request, jsonify
from firebase_admin import firestore
from extensions import db
from services.results_processor import ResultsProcessor
import random
from authz import require_admin, AuthzError

seed_bp = Blueprint('seed', __name__)

def verify_admin_auth():
    return require_admin(request)

@seed_bp.route('/admin/seed/stats', methods=['GET'])
def get_seed_stats():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        users_ref = db.collection('users').where('isTestData', '==', True)
        docs = list(users_ref.stream())
        return jsonify({'testParticipantCount': len(docs)}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@seed_bp.route('/admin/seed/participants', methods=['POST'])
def seed_participants():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        req_data = request.get_json(silent=True) or {}
        count = req_data.get('count', 20)
        
        first_names = ['Magnus', 'Oliver', 'William', 'Noah', 'Lucas', 'Oscar', 'Carl', 'Victor', 'Malthe', 'Alfred', 'Emil', 'Aksel', 'Valdemar', 'August', 'Frederik', 'Emma', 'Ida', 'Clara', 'Freja', 'Alma', 'Ella', 'Sofia', 'Anna', 'Laura', 'Karla', 'Mathilde', 'Agnes', 'Lily', 'Josefine', 'Alberte']
        last_names = ['Nielsen', 'Jensen', 'Hansen', 'Pedersen', 'Andersen', 'Christensen', 'Larsen', 'Sørensen', 'Rasmussen', 'Petersen', 'Madsen', 'Kristensen', 'Olsen', 'Thomsen', 'Christiansen', 'Poulsen', 'Johansen', 'Knudsen', 'Mortensen', 'Møller']
        clubs = ['Aarhus Cykle Ring', 'Team Biciklet', 'Odense Cykel Club', 'Copenhagen Cycling', 'Roskilde CK', 'Aalborg CK', 'Test Club']
        categories = ['A', 'B', 'C', 'D', 'E']
        
        existing_test = db.collection('users').where('isTestData', '==', True).stream()
        max_id = 0
        for doc in existing_test:
            data = doc.to_dict()
            e_lic = data.get('eLicense', '')
            if e_lic.startswith('TEST-'):
                try:
                    num = int(e_lic.split('-')[1])
                    if num > max_id: max_id = num
                except: pass
        
        created = []
        for i in range(count):
            idx = max_id + i + 1
            e_license = f"TEST-{idx:04d}"
            zwift_id = f"999{idx:04d}"
            name = f"{random.choice(first_names)} {random.choice(last_names)}"
            assigned_category = random.choice(categories)
            
            user_data = {
                'eLicense': e_license,
                'zwiftId': zwift_id,
                'name': name,
                'club': random.choice(clubs),
                'equipment': {'trainer': 'Wahoo Kickr Core'},
                'isTestData': True,
                'registration': {'status': 'complete'},
                'verified': True,
                'zwiftPower': {'category': assigned_category},
                'createdAt': firestore.SERVER_TIMESTAMP
            }
            # Use Zwift ID as key
            db.collection('users').document(zwift_id).set(user_data)
            created.append({'eLicense': e_license, 'name': name, 'zwiftId': zwift_id, 'category': assigned_category})
        
        return jsonify({'message': f'Created {len(created)} test participants', 'participants': created}), 201
    except Exception as e: return jsonify({'message': str(e)}), 500

@seed_bp.route('/admin/seed/participants', methods=['DELETE'])
def clear_seed_participants():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        users_ref = db.collection('users').where('isTestData', '==', True)
        docs = list(users_ref.stream())
        deleted_count = 0
        for doc in docs:
            doc.reference.delete()
            deleted_count += 1
        return jsonify({'message': f'Deleted {deleted_count} test participants'}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@seed_bp.route('/admin/seed/results', methods=['POST'])
def seed_results():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        req_data = request.get_json(silent=True) or {}
        race_ids = req_data.get('raceIds', [])
        progress = req_data.get('progress', 100)
        category_riders = req_data.get('categoryRiders', {})
        
        if not race_ids: return jsonify({'message': 'No race IDs provided'}), 400
        
        # 1. Fetch participants
        test_users_ref = db.collection('users').where('isTestData', '==', True)
        test_participants = []
        for doc in test_users_ref.stream():
            data = doc.to_dict()
            test_participants.append({
                'zwiftId': data.get('zwiftId'),
                'name': data.get('name'),
                'eLicense': data.get('eLicense'),
                'category': data.get('category', 'A') 
            })
        
        if len(test_participants) == 0:
            # Fallback temp gen
            for i in range(100):
                test_participants.append({
                    'zwiftId': f"999{i:04d}",
                    'name': f"Temp User {i}",
                    'eLicense': f"TEMP-{i:04d}",
                    'category': random.choice(['A', 'B', 'C', 'D', 'E'])
                })
        
        results_generated = {}
        processor = ResultsProcessor(db, None, None) 
        
        for race_id in race_ids:
            # Initialize immediately to prevent scope issues in error blocks
            race_results = {}
            
            race_doc = db.collection('races').document(race_id).get()
            if not race_doc.exists: continue
            
            race_data = race_doc.to_dict()
            
            # Categories logic
            categories = []
            category_configs = {}
            
            if race_data.get('eventMode') == 'multi' and race_data.get('eventConfiguration'):
                 for cfg in race_data['eventConfiguration']:
                     cat = cfg.get('customCategory')
                     if cat:
                         categories.append(cat)
                         category_configs[cat] = {'sprints': cfg.get('sprints', [])}
            elif race_data.get('singleModeCategories'):
                 for cfg in race_data['singleModeCategories']:
                     cat = cfg.get('category')
                     if cat:
                         categories.append(cat)
                         category_configs[cat] = {'sprints': cfg.get('sprints', [])}
            else:
                 categories = ['A', 'B', 'C', 'D', 'E']
                 for cat in categories:
                     category_configs[cat] = {'sprints': race_data.get('sprints', [])}
            
            for category in categories:
                rider_count = category_riders.get(category, 5)
                cat_config = category_configs.get(category, {})
                sprints = cat_config.get('sprints', [])
                
                # Custom Category Mapping Logic
                target_pool_cat = category
                if category not in ['A', 'B', 'C', 'D', 'E']:
                    hash_val = sum(ord(c) for c in category)
                    target_pool_cat = ['A', 'B', 'C', 'D', 'E'][hash_val % 5]
                
                potential_riders = [p for p in test_participants if p.get('category') == target_pool_cat]
                if not potential_riders: continue
                    
                # Sort for deterministic selection
                potential_riders.sort(key=lambda x: x['zwiftId'])
                
                # Take top N
                riders_list = potential_riders[:rider_count]
                if len(riders_list) == 0: continue
                
                # Randomize finish order
                random.shuffle(riders_list) 
                
                cat_results = []
                base_time_ms = random.randint(1800000, 3600000)
                
                for rank, rider in enumerate(riders_list, 1):
                     finish_time = base_time_ms + (random.randint(5000, 30000) * rank)
                     if progress < 100: finish_time = 0
                     
                     sprint_data = {}
                     if sprints:
                         sprints_complete = max(1, int((progress / 100) * len(sprints))) if progress > 0 else 0
                         for s_idx, sprint in enumerate(sprints[:sprints_complete]):
                             sprint_key = sprint.get('key') or f"{sprint.get('id')}_{sprint.get('count', 1)}"
                             
                             # Generate realistic worldTime (arrival time at split)
                             # Base: Race Start (arbitrary) + 10 mins per split
                             # Variance: Slower riders (higher rank) arrive later
                             race_start_ts = 1700000000000
                             split_base_ms = (s_idx + 1) * 600000 
                             gap_ms = (rank - 1) * random.randint(2000, 8000) + random.randint(0, 500)
                             
                             sprint_data[sprint_key] = {
                                 'worldTime': race_start_ts + split_base_ms + gap_ms,
                                 'time': random.randint(30000, 120000),
                                 'avgPower': random.randint(200, 400)
                             }
                     
                     cat_results.append({
                         'zwiftId': rider['zwiftId'],
                         'name': rider['name'],
                         'finishTime': finish_time,
                         'finishRank': 0,
                         'finishPoints': 0,
                         'sprintPoints': 0,
                         'totalPoints': 0,
                         'sprintDetails': {},
                         'sprintData': sprint_data,
                         'isTestData': True
                     })
                
                cat_results.sort(key=lambda x: x['finishTime'] if x['finishTime'] > 0 else 999999999999)
                race_results[category] = cat_results
            
            db.collection('races').document(race_id).update({
                'results': race_results,
                'resultsUpdatedAt': firestore.SERVER_TIMESTAMP,
                'manualDQs': [],
                'manualDeclassifications': [],
                'manualExclusions': []
            })
            
            try:
                processor.recalculate_race_points(race_id)
                results_generated[race_id] = {'status': 'ok'}
            except Exception as e:
                results_generated[race_id] = {'error': str(e)}
        
        return jsonify({'message': f'Generated results for {len(results_generated)} races', 'results': results_generated}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500

@seed_bp.route('/admin/seed/results', methods=['DELETE'])
def clear_seed_results():
    try: verify_admin_auth()
    except AuthzError as e: return jsonify({'message': e.message}), e.status_code
    
    if not db: return jsonify({'error': 'DB not available'}), 500
    try:
        req_data = request.get_json(silent=True) or {}
        race_ids = req_data.get('raceIds', [])
        
        if race_ids:
            for race_id in race_ids:
                db.collection('races').document(race_id).update({'results': firestore.DELETE_FIELD})
        else:
            docs = db.collection('races').stream()
            for doc in docs:
                doc.reference.update({'results': firestore.DELETE_FIELD})
        
        try:
             processor = ResultsProcessor(db, None, None)
             processor.save_league_standings()
        except: pass
        
        return jsonify({'message': 'Cleared results'}), 200
    except Exception as e: return jsonify({'message': str(e)}), 500
