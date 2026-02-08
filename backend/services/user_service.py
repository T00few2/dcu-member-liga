from firebase_admin import firestore
from extensions import db

class User:
    def __init__(self, doc_snapshot=None, data=None, doc_id=None):
        if doc_snapshot:
            self.id = doc_snapshot.id
            self._data = doc_snapshot.to_dict() or {}
        else:
            self.id = doc_id
            self._data = data or {}
            
    def to_dict(self):
        return self._data

    @property
    def name(self):
        return self._data.get('name', '')

    @property
    def e_license(self):
        return self._data.get('eLicense', '')

    @property
    def zwift_id(self):
        return self._data.get('zwiftId')

    @property
    def club(self):
        return self._data.get('club', '')

    @property
    def verification(self):
        return self._data.get('verification', {})

    @property
    def verification_status(self):
        return self.verification.get('status', 'none')

    @property
    def is_verified(self):
        return self.verification_status == 'approved'

    @property
    def verification_history(self):
        return self.verification.get('history', [])

    @property
    def current_verification_request(self):
        return self.verification.get('currentRequest', {})

    @property
    def weight_verification_video_link(self):
        return self.current_verification_request.get('videoLink', '')

    @property
    def weight_verification_deadline(self):
        return self.current_verification_request.get('deadline')

    @property
    def registration(self):
        return self._data.get('registration', {})

    @property
    def is_registered(self):
        return self.registration.get('status') == 'complete'

    @property
    def accepted_data_policy(self):
        return bool(self.registration.get('dataPolicy'))

    @property
    def accepted_public_results(self):
        return bool(self.registration.get('publicResultsConsent'))
    
    @property
    def data_policy_version(self):
        return self.registration.get('dataPolicy', {}).get('version')

    @property
    def public_results_consent_version(self):
        return self.registration.get('publicResultsConsent', {}).get('version')

    @property
    def strava_auth(self):
        return self._data.get('connections', {}).get('strava') or self._data.get('strava')

    # Equipment
    @property
    def trainer(self):
        # Fallback logic preserved from get_profile
        t = self._data.get('equipment', {}).get('trainer')
        if not t:
            t = self._data.get('trainer', '')
        return t

    # Legacy / Compatibility helpers if needed
    
    def update(self, updates):
        """
        Updates the user document in Firestore and updates the local data.
        """
    def update(self, updates):
        """
        Updates the user document in Firestore.
        """
        if not self.id:
            raise ValueError("User ID is required for updates")
        
        db.collection('users').document(str(self.id)).set(updates, merge=True)
        # Update local cache
        self._data.update(updates)

class UserService:
    @staticmethod
    def get_user_by_id(user_id):
        if not user_id: return None
        doc = db.collection('users').document(str(user_id)).get()
        if doc.exists:
            return User(doc_snapshot=doc)
        return None

    @staticmethod
    def get_user_by_auth_uid(uid):
        # Logic from users.py mapping lookup
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        if mapping_doc.exists:
            data = mapping_doc.to_dict()
            zwift_id = data.get('zwiftId')
            if zwift_id:
                return UserService.get_user_by_id(zwift_id)
            
            # Legacy eLicense fallback
            e_license = data.get('eLicense')
            if e_license:
                return UserService.get_user_by_id(e_license)
                
        # Direct lookup fallback
        user = UserService.get_user_by_id(uid)
        if user: return user
        
        # Query fallback
        docs = db.collection('users').where('authUid', '==', uid).limit(1).stream()
        for doc in docs:
            return User(doc_snapshot=doc)
            
        return None

    @staticmethod
    def get_user_by_elicense(elicense):
        if not elicense: return None
        docs = db.collection('users').where('eLicense', '==', str(elicense)).limit(1).stream()
        for doc in docs:
            return User(doc_snapshot=doc)
        return None

    @staticmethod
    def get_pending_verifications():
        docs = db.collection('users').where('verification.status', '==', 'submitted').stream()
        return [User(doc_snapshot=doc) for doc in docs]

    @staticmethod
    def get_active_verification_requests():
        docs = db.collection('users').where('verification.status', '==', 'pending').stream()
        return [User(doc_snapshot=doc) for doc in docs]

    @staticmethod
    def get_approved_verifications(limit=50):
        docs = db.collection('users').where('verification.status', '==', 'approved').limit(limit).stream()
        return [User(doc_snapshot=doc) for doc in docs]
    
    @staticmethod
    def get_all_participants(limit=100):
        docs = db.collection('users').limit(limit).stream()
        return [User(doc_snapshot=doc) for doc in docs]
