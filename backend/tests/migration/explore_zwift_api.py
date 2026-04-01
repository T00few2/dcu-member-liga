"""
Zwift API endpoint explorer.

Calls every relevant endpoint and prints the raw JSON response so you can
inspect exactly what each one returns.

Delete this file (and the migration/ directory) once the migration is confirmed.

Usage
-----
# Minimum — app-credential endpoints only:
python explore_zwift_api.py --event-id 12345 --subgroup-id 67890

# With a user access token (racing profile, power curve, activity):
python explore_zwift_api.py --event-id 12345 --subgroup-id 67890 \\
    --user-token <access_token>

# With a specific rider and activity:
python explore_zwift_api.py --event-id 12345 --subgroup-id 67890 \\
    --rider-id 99999 --activity-id 55555 --user-token <access_token>

# ZwiftRacing.app endpoints (requires ZR_AUTH_KEY env var):
python explore_zwift_api.py --event-id 12345 --subgroup-id 67890 --rider-id 99999

Credentials are read from environment variables (or a .env file):
    ZWIFT_CLIENT_ID
    ZWIFT_CLIENT_SECRET
    ZR_AUTH_KEY          (optional — for ZwiftRacing endpoints)
    ZWIFT_AUTH_BASE_URL  (optional — defaults to production)
    ZWIFT_API_BASE_URL   (optional — defaults to production)
    ZR_BASE_URL          (optional — defaults to production)
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Credentials / config from env
# ---------------------------------------------------------------------------

ZWIFT_CLIENT_ID     = os.environ.get("ZWIFT_CLIENT_ID", "")
ZWIFT_CLIENT_SECRET = os.environ.get("ZWIFT_CLIENT_SECRET", "")
ZWIFT_AUTH_BASE     = os.environ.get("ZWIFT_AUTH_BASE_URL", "https://secure.zwift.com/auth/realms/zwift").rstrip("/")
ZWIFT_API_BASE      = os.environ.get("ZWIFT_API_BASE_URL", "https://us-or-rly101.zwift.com").rstrip("/")
ZR_AUTH_KEY         = os.environ.get("ZR_AUTH_KEY", "")
ZR_BASE_URL         = os.environ.get("ZR_BASE_URL", "https://api.zwiftracing.app/api").rstrip("/")

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DIVIDER = "=" * 70


def section(title: str) -> None:
    print(f"\n{DIVIDER}")
    print(f"  {title}")
    print(DIVIDER)


def show(label: str, status: int, data: object, max_entries: int | None = None) -> None:
    """Pretty-print an API response."""
    print(f"\n--- {label}  [HTTP {status}] ---")
    if isinstance(data, dict) and "entries" in data and max_entries is not None:
        # Truncate long entry lists but always show the schema
        entries = data["entries"]
        display = dict(data)
        display["entries"] = entries[:max_entries]
        if len(entries) > max_entries:
            display["_note"] = f"(showing {max_entries} of {len(entries)} entries)"
        print(json.dumps(display, indent=2, default=str))
    else:
        print(json.dumps(data, indent=2, default=str))


def get_app_token() -> str:
    """Obtain an app-level access token via client_credentials."""
    resp = requests.post(
        f"{ZWIFT_AUTH_BASE}/protocol/openid-connect/token",
        data={
            "client_id": ZWIFT_CLIENT_ID,
            "client_secret": ZWIFT_CLIENT_SECRET,
            "grant_type": "client_credentials",
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    if resp.status_code != 200:
        print(f"ERROR: Could not acquire app token ({resp.status_code}): {resp.text}")
        sys.exit(1)
    token = resp.json().get("access_token")
    expires_in = resp.json().get("expires_in", "?")
    print(f"  App token acquired (expires_in={expires_in}s)")
    return token


def zwift_get(path: str, token: str, params: dict | None = None) -> tuple[int, object]:
    resp = requests.get(
        f"{ZWIFT_API_BASE}{path}",
        headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
        params=params,
        timeout=20,
    )
    try:
        body = resp.json()
    except Exception:
        body = {"_raw": resp.text}
    return resp.status_code, body


def zr_get(path: str) -> tuple[int, object]:
    headers = {"Authorization": ZR_AUTH_KEY} if ZR_AUTH_KEY else {}
    resp = requests.get(f"{ZR_BASE_URL}{path}", headers=headers, timeout=20)
    try:
        body = resp.json()
    except Exception:
        body = {"_raw": resp.text}
    return resp.status_code, body


# ---------------------------------------------------------------------------
# Endpoint groups
# ---------------------------------------------------------------------------

def explore_app_token() -> str:
    section("AUTH — Client Credentials (app token)")
    if not ZWIFT_CLIENT_ID or not ZWIFT_CLIENT_SECRET:
        print("SKIPPED: ZWIFT_CLIENT_ID / ZWIFT_CLIENT_SECRET not set")
        sys.exit(1)
    token = get_app_token()
    return token


def explore_event_info(token: str, event_id: str) -> None:
    section(f"OFFICIAL — GET /api/link/events/{{eventId}}  (event_id={event_id})")
    status, body = zwift_get(f"/api/link/events/{event_id}", token)
    show("Event info", status, body)


def explore_segment_results(token: str, subgroup_id: str) -> None:
    section(f"OFFICIAL — GET /api/link/events/subgroups/{{subgroupId}}/segment-results  (subgroup_id={subgroup_id})")

    # Fetch first page only so we can inspect the schema.
    status, body = zwift_get(
        f"/api/link/events/subgroups/{subgroup_id}/segment-results",
        token,
    )
    show("Segment results (first page, first 5 entries)", status, body, max_entries=5)

    # If there are entries, highlight the unique segmentId values so we can
    # understand the structure (finish line vs. sprint segments).
    if isinstance(body, dict) and body.get("entries"):
        segment_ids = sorted({e.get("segmentId") for e in body["entries"] if e.get("segmentId")})
        user_ids = sorted({e.get("userId") for e in body["entries"] if e.get("userId")})
        print(f"\n  Unique segmentIds in this page : {segment_ids}")
        print(f"  Unique userIds in this page    : {len(user_ids)} riders")

        # Show one full entry per unique segmentId so every field is visible.
        seen: set = set()
        print("\n  --- One representative entry per segmentId ---")
        for entry in body["entries"]:
            sid = entry.get("segmentId")
            if sid not in seen:
                seen.add(sid)
                print(f"\n  segmentId={sid}:")
                print(json.dumps(entry, indent=4, default=str))


def explore_live_data(token: str, subgroup_id: str) -> None:
    section(f"OFFICIAL — GET /api/link/events/subgroups/{{subgroupId}}/live-data  (subgroup_id={subgroup_id})")
    status, body = zwift_get(
        f"/api/link/events/subgroups/{subgroup_id}/live-data",
        token,
        params={"page": 0, "limit": 5},
    )
    show("Live data (first 5 entries)", status, body, max_entries=5)


def explore_racing_profile(token: str) -> None:
    section("OFFICIAL — GET /api/link/racing-profile  (user token required)")
    status, body = zwift_get(
        "/api/link/racing-profile",
        token,
        params={"includeCompetitionMetrics": "true"},
    )
    show("Racing profile", status, body)


def explore_power_curve(token: str) -> None:
    section("OFFICIAL — GET /api/link/power-curve/best/all-time  (user token required)")
    status, body = zwift_get("/api/link/power-curve/best/all-time", token)
    show("Power curve (all-time)", status, body)

    section("OFFICIAL — GET /api/link/power-curve/best/last?days=30  (user token required)")
    status, body = zwift_get("/api/link/power-curve/best/last", token, params={"days": 30})
    show("Power curve (last 30 days)", status, body)

    section("OFFICIAL — GET /api/link/power-curve/power-profile  (user token required)")
    status, body = zwift_get("/api/link/power-curve/power-profile", token)
    show("Power profile", status, body)


def explore_activity(token: str, activity_id: str) -> None:
    section(f"OFFICIAL — GET /api/thirdparty/activity/{{activityId}}  (activity_id={activity_id})")
    status, body = zwift_get(f"/api/thirdparty/activity/{activity_id}", token)
    show("Activity", status, body)


# ---------------------------------------------------------------------------
# ZwiftRacing.app endpoints
# ---------------------------------------------------------------------------

def explore_zr_rider(rider_id: str) -> None:
    section(f"ZWIFTRACING — GET /public/riders/{{riderId}}  (rider_id={rider_id})")
    if not ZR_AUTH_KEY:
        print("SKIPPED: ZR_AUTH_KEY not set")
        return
    status, body = zr_get(f"/public/riders/{rider_id}")
    show("Rider stats", status, body)


def explore_zr_results(event_id: str) -> None:
    section(f"ZWIFTRACING — GET /public/results/{{eventId}}  (event_id={event_id})")
    if not ZR_AUTH_KEY:
        print("SKIPPED: ZR_AUTH_KEY not set")
        return
    status, body = zr_get(f"/public/results/{event_id}")
    show("ZwiftRacing results (first 5 entries)", status, body, max_entries=5)


def explore_zp_results(event_id: str) -> None:
    section(f"ZWIFTRACING — GET /public/zp/{{eventId}}/results  (event_id={event_id})")
    if not ZR_AUTH_KEY:
        print("SKIPPED: ZR_AUTH_KEY not set")
        return
    status, body = zr_get(f"/public/zp/{event_id}/results")
    show("ZwiftPower results via ZwiftRacing (first 5 entries)", status, body, max_entries=5)

    # Highlight the fields present in the first entry so we can compare
    # with the official segment-results schema.
    if isinstance(body, list) and body:
        print("\n  Fields in first ZP result entry:")
        print(f"  {sorted(body[0].keys())}")
    elif isinstance(body, dict):
        for key, val in body.items():
            if isinstance(val, list) and val:
                print(f"\n  Fields in first entry of body['{key}']:")
                print(f"  {sorted(val[0].keys())}")
                break


# ---------------------------------------------------------------------------
# Legacy endpoints (dual_stack mode only — shows what they look like)
# ---------------------------------------------------------------------------

def explore_legacy_event_info(token: str, event_id: str) -> None:
    section(f"LEGACY — GET /api/events/{{eventId}}  (event_id={event_id})")
    status, body = zwift_get(f"/api/events/{event_id}", token)
    show("Legacy event info", status, body)


def explore_legacy_race_results(token: str, subgroup_id: str) -> None:
    section(f"LEGACY — GET /api/race-results/entries  (subgroup_id={subgroup_id})")
    status, body = zwift_get(
        "/api/race-results/entries",
        token,
        params={"event_subgroup_id": subgroup_id, "start": 0, "limit": 5},
    )
    show("Legacy race results (first 5 entries)", status, body, max_entries=5)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="Explore Zwift API endpoints and print raw responses.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    p.add_argument("--event-id",    required=True,  help="Zwift event ID")
    p.add_argument("--subgroup-id", required=True,  help="Zwift event subgroup ID")
    p.add_argument("--rider-id",    default=None,   help="Zwift rider/user ID (for ZR endpoints)")
    p.add_argument("--activity-id", default=None,   help="Zwift activity ID")
    p.add_argument("--user-token",  default=None,   help="User OAuth access token (for profile/power curve)")
    p.add_argument("--legacy",      action="store_true",
                   help="Also call legacy endpoints for comparison")
    p.add_argument("--skip-zr",     action="store_true",
                   help="Skip ZwiftRacing.app endpoints")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    print("\nZwift API Explorer")
    print(f"  ZWIFT_API_BASE : {ZWIFT_API_BASE}")
    print(f"  ZWIFT_AUTH_BASE: {ZWIFT_AUTH_BASE}")
    print(f"  ZR_BASE_URL    : {ZR_BASE_URL}")
    print(f"  ZR_AUTH_KEY    : {'set' if ZR_AUTH_KEY else 'NOT SET'}")

    # --- App-level token (used for most official endpoints) ---
    app_token = explore_app_token()

    # --- Official Zwift endpoints (app token) ---
    explore_event_info(app_token, args.event_id)
    explore_segment_results(app_token, args.subgroup_id)
    explore_live_data(app_token, args.subgroup_id)

    # --- Official Zwift endpoints (user token) ---
    if args.user_token:
        explore_racing_profile(args.user_token)
        explore_power_curve(args.user_token)
        if args.activity_id:
            explore_activity(args.user_token, args.activity_id)
    else:
        section("OFFICIAL — User-token endpoints (SKIPPED — pass --user-token to enable)")
        print("  Skipped: racing-profile, power-curve, activity")

    # --- ZwiftRacing.app ---
    if not args.skip_zr:
        if args.rider_id:
            explore_zr_rider(args.rider_id)
        explore_zr_results(args.event_id)
        explore_zp_results(args.event_id)

    # --- Legacy endpoints ---
    if args.legacy:
        explore_legacy_event_info(app_token, args.event_id)
        explore_legacy_race_results(app_token, args.subgroup_id)

    print(f"\n{DIVIDER}")
    print("  Done.")
    print(DIVIDER)


if __name__ == "__main__":
    main()
