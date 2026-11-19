"""Pre-flight checks for "Log ind med Zwift" with real credentials.

Writes nothing to Firestore or Firebase Auth. It:
  1. mints a Firebase custom token (proves the backend's credentials can sign them),
  2. prints the Zwift authorize URL and redirect URI the sign-in flow will use,
  3. optionally sends one verification-style email via Zoho SMTP (--send-test-email you@example.com).

Usage:
  conda run -n py311 python backend/scripts/zwift_signin_preflight.py
  conda run -n py311 python backend/scripts/zwift_signin_preflight.py --send-test-email you@example.com
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
os.chdir(os.path.join(os.path.dirname(__file__), ".."))  # so serviceAccountKey.json resolves like the app


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--send-test-email", metavar="ADDRESS", help="send one test email via Zoho SMTP")
    args = parser.parse_args()

    ok = True

    import extensions  # noqa: F401  (initializes firebase_admin the same way the app does)
    from firebase_admin import auth

    print("1) Firebase custom token")
    try:
        token = auth.create_custom_token("zwift_preflight_check")
        print(f"   OK: minted a custom token ({len(token)} bytes). Nothing was written.")
    except Exception as exc:  # noqa: BLE001
        ok = False
        print(f"   FAILED: {exc}")
        print("   With ADC only, the service account needs iam.serviceAccounts.signBlob")
        print("   (role 'Service Account Token Creator' on itself).")

    print("2) Zwift authorize URL")
    from config import ZWIFT_CLIENT_ID, ZWIFT_REDIRECT_URI
    from extensions import get_zwift_service

    if not ZWIFT_CLIENT_ID:
        ok = False
        print("   FAILED: ZWIFT_CLIENT_ID is not set")
    else:
        url = get_zwift_service().build_authorize_url(state="preflight")
        print(f"   redirect_uri: {ZWIFT_REDIRECT_URI}")
        print("   This must be the redirect URI registered with Zwift (it is the same one the")
        print("   existing 'Forbind med Zwift Link' button uses).")
        print(f"   URL: {url}")

    if args.send_test_email:
        print(f"3) Test email to {args.send_test_email}")
        from utils.email_sender import send_plain_email

        try:
            send_plain_email(
                to_email=args.send_test_email,
                subject="Test: bekræftelseskode til DCU Member Liga",
                message="Dette er en test af bekræftelses-emailen. Din kode ville stå her: 123456",
            )
            print("   OK: sent. Check the inbox (and spam folder).")
        except Exception as exc:  # noqa: BLE001
            ok = False
            print(f"   FAILED: {exc}")

    print("\nAll checks passed." if ok else "\nSome checks FAILED (see above).")
    return 0 if ok else 1


if __name__ == "__main__":
    raise SystemExit(main())
