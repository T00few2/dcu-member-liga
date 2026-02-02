"""
Set/unset Firebase custom claim `admin` on a user.

Examples:
  python backend/scripts/set_admin_claim.py --email "user@example.com" --admin true
  python backend/scripts/set_admin_claim.py --uid "<FIREBASE_UID>" --admin false
"""

from __future__ import annotations

import argparse
import os
from typing import Any, Dict

import firebase_admin
from firebase_admin import auth, credentials


def _parse_bool(value: str) -> bool:
    v = value.strip().lower()
    if v in {"1", "true", "t", "yes", "y", "on"}:
        return True
    if v in {"0", "false", "f", "no", "n", "off"}:
        return False
    raise argparse.ArgumentTypeError(f"Invalid boolean: {value}")


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
    parser.add_argument("--admin", required=True, type=_parse_bool, help="true/false")
    args = parser.parse_args()

    _init_firebase()

    user = _get_user(args.uid, args.email)
    existing: Dict[str, Any] = dict(user.custom_claims or {})

    if args.admin:
        existing["admin"] = True
    else:
        existing.pop("admin", None)

    auth.set_custom_user_claims(user.uid, existing)

    print(f"Updated {user.uid}: admin={args.admin}.")
    print("Note: the user may need to refresh their ID token (sign out/in) to pick up the new claim.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

