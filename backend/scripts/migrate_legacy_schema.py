"""
ARCHIVAL MIGRATION SCRIPT.

One-time migration: normalise user document registration status.

Older user documents may use any of three different field conventions:
  (A) NEW:    registration.status == 'complete'        (current schema)
  (B) OLD:    registrationComplete == True              (deprecated)
  (C) OLDEST: verified == True                          (very old)

This script rewrites all (B) and (C) documents to use the canonical (A) schema.
It is retained for historical reference and should not be run as routine maintenance.

Usage (from the backend/ directory):
    python scripts/migrate_legacy_schema.py [--dry-run]

Options:
    --dry-run   Print what would be changed without writing anything.

Prerequisites:
    • serviceAccountKey.json must be present in the backend/ directory, OR
      GOOGLE_APPLICATION_CREDENTIALS must point to a valid service account.
"""
from __future__ import annotations

import argparse
import sys
import os

# Allow running from project root or backend/ directory.
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import firebase_admin
from firebase_admin import credentials, firestore

import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s %(message)s')
logger = logging.getLogger(__name__)


def _init_firebase() -> firestore.Client:
    cred_path = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'serviceAccountKey.json')
    if os.path.exists(cred_path):
        firebase_admin.initialize_app(credentials.Certificate(cred_path))
    else:
        firebase_admin.initialize_app()
    return firestore.client()


def _is_registered_deprecated(data: dict) -> bool:
    """True if the document uses a deprecated registration signal."""
    # Already on the new schema — skip.
    if data.get('registration', {}).get('status') == 'complete':
        return False
    # Old schema B
    if data.get('registrationComplete') is True:
        return True
    # Oldest schema C
    if data.get('verified') is True:
        return True
    return False


def migrate(dry_run: bool = False) -> None:
    db = _init_firebase()

    users_ref = db.collection('users')
    docs = list(users_ref.stream())
    logger.info(f"Total user documents: {len(docs)}")

    to_migrate = []
    for doc in docs:
        data = doc.to_dict() or {}
        if _is_registered_deprecated(data):
            to_migrate.append(doc)

    logger.info(f"Documents requiring migration: {len(to_migrate)}")

    if not to_migrate:
        logger.info("Nothing to do — all documents already use the current schema.")
        return

    if dry_run:
        for doc in to_migrate:
            data = doc.to_dict() or {}
            old_signal = (
                'registrationComplete=True' if data.get('registrationComplete')
                else 'verified=True'
            )
            logger.info(f"  [DRY-RUN] Would migrate {doc.id} ({old_signal})")
        return

    batch = db.batch()
    count = 0
    BATCH_SIZE = 400

    for doc in to_migrate:
        data = doc.to_dict() or {}
        old_signal = (
            'registrationComplete=True' if data.get('registrationComplete')
            else 'verified=True'
        )

        # Build the registration sub-document, preserving any existing fields.
        existing_reg = data.get('registration', {})
        updated_reg = {
            **existing_reg,
            'status': 'complete',
        }

        update_payload = {
            'registration': updated_reg,
            # Clear now-redundant deprecated fields.
            'registrationComplete': firestore.DELETE_FIELD,
            'verified': firestore.DELETE_FIELD,
        }

        batch.update(doc.reference, update_payload)
        count += 1
        logger.info(f"  Migrating {doc.id} ({old_signal}) → registration.status=complete")

        if count % BATCH_SIZE == 0:
            batch.commit()
            batch = db.batch()

    if count % BATCH_SIZE != 0:
        batch.commit()

    logger.info(f"Migration complete: {count} documents updated.")


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Migrate deprecated user registration schema.')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without writing.')
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
