"""
Get Firebase custom claims for a user (e.g. to check if they are admin).

Examples:
  python backend/scripts/get_user_claims.py --email "user@example.com"
  python backend/scripts/get_user_claims.py --uid "<FIREBASE_UID>"
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Any, Dict

import firebase_admin
from firebase_admin import auth, credentials


def _init_firebase():
    if firebase_admin._apps:
        return

    # Prefer explicit credentials if present.
    gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if gac and os.path.exists(gac):
        firebase_admin.initialize_app(credentials.Certificate(gac))
        return

    # Fallback: local file next to repo (same convention used by backend/extensions.py).
    local_sa = os.path.join(os.getcwd(), "backend", "serviceAccountKey.json")
    if os.path.exists(local_sa):
        firebase_admin.initialize_app(credentials.Certificate(local_sa))
        return

    # Last resort: ADC (e.g., gcloud auth application-default login)
    firebase_admin.initialize_app()


def _get_user(uid: str | None, email: str | None):
    if uid:
        return auth.get_user(uid)
    if email:
        return auth.get_user_by_email(email)
    raise ValueError("Provide --uid or --email")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--uid", help="Firebase Auth UID")
    parser.add_argument("--email", help="User email in Firebase Auth")
    args = parser.parse_args()

    if not args.uid and not args.email:
        parser.print_help()
        return 1

    try:
        _init_firebase()
        user = _get_user(args.uid, args.email)
        
        print(f"User: {user.email} ({user.uid})")
        print("-" * 40)
        
        claims = user.custom_claims or {}
        if not claims:
            print("No custom claims found.")
        else:
            print("Custom Claims:")
            for k, v in claims.items():
                print(f"  {k}: {v}")
                
        is_admin = claims.get("admin") is True
        print("-" * 40)
        print(f"Is Admin: {is_admin}")

    except Exception as e:
        print(f"Error: {e}")
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
