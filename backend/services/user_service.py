from __future__ import annotations

import logging
from typing import Any

from firebase_admin import firestore
from extensions import db

from models import UserDoc

logger = logging.getLogger(__name__)


class User:
    def __init__(
        self,
        doc_snapshot: Any = None,
        data: UserDoc | None = None,
        doc_id: str | None = None,
    ) -> None:
        if doc_snapshot:
            self.id: str | None = doc_snapshot.id
            self._data: UserDoc = doc_snapshot.to_dict() or {}
        else:
            self.id = doc_id
            self._data = data or {}

    def to_dict(self) -> UserDoc:
        return self._data

    @property
    def name(self) -> str:
        return self._data.get('name', '')

    @property
    def zwift_id(self) -> str | None:
        return self._data.get('zwiftId')

    @property
    def club(self) -> str:
        return self._data.get('club', '')

    @property
    def verification(self) -> dict[str, Any]:
        return self._data.get('verification', {})

    @property
    def verification_status(self) -> str:
        return self.verification.get('status', 'none')

    @property
    def is_verified(self) -> bool:
        return self.verification_status == 'approved'

    @property
    def verification_history(self) -> list[Any]:
        return self.verification.get('history', [])

    @property
    def current_verification_request(self) -> dict[str, Any]:
        return self.verification.get('currentRequest', {})

    @property
    def weight_verification_video_link(self) -> str:
        return self.current_verification_request.get('videoLink', '')

    @property
    def weight_verification_deadline(self) -> Any:
        return self.current_verification_request.get('deadline')

    @property
    def registration(self) -> dict[str, Any]:
        return self._data.get('registration', {})

    @property
    def is_registered(self) -> bool:
        return self.registration.get('status') == 'complete'

    @property
    def accepted_data_policy(self) -> bool:
        return bool(self.registration.get('dataPolicy'))

    @property
    def accepted_public_results(self) -> bool:
        return bool(self.registration.get('publicResultsConsent'))

    @property
    def data_policy_version(self) -> str | None:
        return self.registration.get('dataPolicy', {}).get('version')

    @property
    def public_results_consent_version(self) -> str | None:
        return self.registration.get('publicResultsConsent', {}).get('version')

    @property
    def strava_auth(self) -> dict[str, Any] | None:
        return self._data.get('connections', {}).get('strava')

    # Equipment
    @property
    def trainer(self) -> str:
        return self._data.get('equipment', {}).get('trainer', '')

    def update(self, updates: dict[str, Any]) -> None:
        """
        Updates the user document in Firestore.
        Uses .update() so that dotted keys (e.g. 'verification.status') are treated as nested fields.
        """
        if not self.id:
            raise ValueError("User ID is required for updates")

        db.collection('users').document(str(self.id)).update(updates)

        # Mirror changes into the local cache, expanding dotted keys into nested dicts.
        for key, value in updates.items():
            parts = key.split('.')
            if len(parts) == 1:
                self._data[key] = value
            else:
                d = self._data
                for part in parts[:-1]:
                    d = d.setdefault(part, {})
                d[parts[-1]] = value


class UserService:
    @staticmethod
    def get_user_by_id(user_id: str | None) -> User | None:
        if not user_id: return None
        doc = db.collection('users').document(str(user_id)).get()
        if doc.exists:
            return User(doc_snapshot=doc)
        return None

    @staticmethod
    def get_user_by_auth_uid(uid: str) -> User | None:
        mapping_doc = db.collection('auth_mappings').document(uid).get()
        if mapping_doc.exists:
            data = mapping_doc.to_dict()
            zwift_id = data.get('zwiftId')
            if zwift_id:
                return UserService.get_user_by_id(zwift_id)

        # Keep authUid query support for draft/incomplete accounts keyed by UID.
        docs = db.collection('users').where('authUid', '==', uid).limit(1).stream()
        for doc in docs:
            return User(doc_snapshot=doc)

        return None


    @staticmethod
    def get_pending_verifications() -> list[User]:
        docs = db.collection('users').where('verification.status', '==', 'submitted').stream()
        return [User(doc_snapshot=doc) for doc in docs]

    @staticmethod
    def get_active_verification_requests() -> list[User]:
        docs = db.collection('users').where('verification.status', '==', 'pending').stream()
        return [User(doc_snapshot=doc) for doc in docs]

    @staticmethod
    def get_approved_verifications(limit: int = 50) -> list[User]:
        docs = db.collection('users').where('verification.status', '==', 'approved').limit(limit).stream()
        return [User(doc_snapshot=doc) for doc in docs]

    @staticmethod
    def get_all_participants(limit: int = 100) -> list[User]:
        docs = (
            db.collection('users')
            .where('registration.status', '==', 'complete')
            .limit(limit)
            .stream()
        )
        return [User(doc_snapshot=doc) for doc in docs]
