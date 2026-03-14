"""
Read-only Firestore schema health check.

Usage:
  conda run -n py311 python backend/scripts/schema_health_check.py
"""

from __future__ import annotations

import json
import os
import sys
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore


DEPRECATED_USER_FIELDS = [
    "verified",
    "registrationComplete",
    "acceptedCoC",
    "acceptedDataPolicy",
    "acceptedPublicResults",
    "dataPolicyVersion",
    "publicResultsConsentVersion",
    "weightVerificationStatus",
    "verificationRequests",
    "weightVerificationVideoLink",
    "weightVerificationDeadline",
    "weightVerificationDate",
    "dataPolicy",
    "publicResultsConsent",
    "verification.status",
    "verification.history",
    "verification.currentRequest",
]


def _init_firebase() -> None:
    if firebase_admin._apps:
        return

    gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if gac and os.path.exists(gac):
        firebase_admin.initialize_app(credentials.Certificate(gac))
        return

    local_sa = os.path.join(os.getcwd(), "backend", "serviceAccountKey.json")
    if os.path.exists(local_sa):
        firebase_admin.initialize_app(credentials.Certificate(local_sa))
        return

    firebase_admin.initialize_app()


def _count_collection(db: firestore.Client, collection_name: str) -> int:
    return int(db.collection(collection_name).count().get()[0][0].value)


def _has_meaningful_value(v: Any) -> bool:
    return v not in (None, False, "", [], {})


def main() -> int:
    try:
        _init_firebase()
        db = firestore.client()

        collections = sorted([c.id for c in db.collections()])
        root_counts = {c: _count_collection(db, c) for c in collections}

        users = [(d.id, (d.to_dict() or {})) for d in db.collection("users").stream()]
        races = [d.to_dict() or {} for d in db.collection("races").stream()]
        auth_mappings = [d.to_dict() or {} for d in db.collection("auth_mappings").stream()]

        deprecated_presence = {
            key: sum(1 for _, data in users if key in data and _has_meaningful_value(data.get(key)))
            for key in DEPRECATED_USER_FIELDS
        }

        report = {
            "collections": collections,
            "rootCounts": root_counts,
            "usersTotal": len(users),
            "usersMissingRegistrationStatus": sum(
                1
                for _, data in users
                if not isinstance(data.get("registration"), dict)
                or not data.get("registration", {}).get("status")
            ),
            "usersDocIdZwiftMismatch": sum(
                1
                for doc_id, data in users
                if data.get("zwiftId") is not None and str(doc_id) != str(data.get("zwiftId"))
            ),
            "deprecatedFieldPresenceInUsers": deprecated_presence,
            "racesTotal": len(races),
            "racesWithNonMapResults": sum(
                1 for race in races if "results" in race and not isinstance(race.get("results"), dict)
            ),
            "racesWithManualArrayShapeIssues": sum(
                1
                for race in races
                if any(
                    key in race and not isinstance(race.get(key), list)
                    for key in ("manualDQs", "manualDeclassifications", "manualExclusions")
                )
            ),
            "authMappingsTotal": len(auth_mappings),
            "authMappingsMissingZwiftId": sum(1 for data in auth_mappings if not data.get("zwiftId")),
        }

        print(json.dumps(report, indent=2, default=str))
        return 0
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
