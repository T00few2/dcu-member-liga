"""
Script to inspect Firestore data. Outputs results as JSON for easy parsing.

Usage:
  # List all collections
  python backend/scripts/inspect_data.py --list-collections

  # Get all documents in a collection (limited to 10 by default)
  python backend/scripts/inspect_data.py --collection users

  # Get specific document
  python backend/scripts/inspect_data.py --collection users --doc <DOC_ID>

  # Query with where clause (simple equality)
  python backend/scripts/inspect_data.py --collection users --where email user@example.com
"""

import argparse
import json
import os
import sys
from datetime import datetime
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore


def _init_firebase():
    if firebase_admin._apps:
        return

    # Prefer explicit credentials if present.
    gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if gac and os.path.exists(gac):
        firebase_admin.initialize_app(credentials.Certificate(gac))
        return

    # Fallback: local file next to repo
    local_sa = os.path.join(os.getcwd(), "backend", "serviceAccountKey.json")
    if os.path.exists(local_sa):
        firebase_admin.initialize_app(credentials.Certificate(local_sa))
        return

    # Last resort: ADC
    firebase_admin.initialize_app()


class DateTimeEncoder(json.JSONEncoder):
    """Custom JSON encoder to handle Firestore timestamps/datetime objects."""
    def default(self, obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        if hasattr(obj, 'timestamp') and callable(obj.timestamp):
             # Handle Firestore Timestamp objects if they appear as such
            return obj.isoformat()
        return super().default(obj)


def main():
    parser = argparse.ArgumentParser(description="Inspect Firestore Data")
    parser.add_argument("--list-collections", action="store_true", help="List all root collections")
    parser.add_argument("--collection", help="Collection name")
    parser.add_argument("--doc", help="Document ID (optional)")
    parser.add_argument("--limit", type=int, default=10, help="Max number of documents to return (default 10)")
    parser.add_argument("--where", nargs=2, metavar=('FIELD', 'VALUE'), help="Simple equality filter: --where field value")
    
    args = parser.parse_args()

    try:
        _init_firebase()
        db = firestore.client()

        result = {}

        if args.list_collections:
            collections = [c.id for c in db.collections()]
            result = {"collections": collections}
        
        elif args.collection:
            ref = db.collection(args.collection)

            if args.doc:
                doc = ref.document(args.doc).get()
                if doc.exists:
                    result = doc.to_dict()
                    result['_id'] = doc.id
                else:
                    result = {"error": "Document not found"}
            else:
                query = ref
                if args.where:
                    field, value = args.where
                    # Try to convert value to appropriate type if possible (bool, int)
                    if value.lower() == 'true': value = True
                    elif value.lower() == 'false': value = False
                    elif value.isdigit(): value = int(value)
                    
                    query = query.where(field, '==', value)
                
                docs = query.limit(args.limit).stream()
                result = []
                for doc in docs:
                    d = doc.to_dict()
                    d['_id'] = doc.id
                    result.append(d)
        
        else:
            parser.print_help()
            return 1

        print(json.dumps(result, indent=2, cls=DateTimeEncoder))
        return 0

    except Exception as e:
        print(json.dumps({"error": str(e)}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
