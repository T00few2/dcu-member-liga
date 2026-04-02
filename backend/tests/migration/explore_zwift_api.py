"""
Zwift API endpoint explorer.

Calls every relevant endpoint and prints the raw JSON response so you can
inspect exactly what each one returns.

Delete this file (and the migration/ directory) once the migration is confirmed.

Usage
-----
# Minimum — app-credential endpoints only:
python explore_zwift_api.py --event-id 12345 --subgroup-id 67890

# Or let the script resolve subgroup IDs from event info:
python explore_zwift_api.py --event-id 12345 --resolve-subgroups

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
ZWIFT_USERNAME      = os.environ.get("ZWIFT_USERNAME", "")
ZWIFT_PASSWORD      = os.environ.get("ZWIFT_PASSWORD", "")
ZWIFT_LEGACY_CLIENT_ID = os.environ.get("ZWIFT_LEGACY_CLIENT_ID", "Zwift_Mobile_Link")
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


def get_legacy_token() -> str | None:
    """
    Obtain a legacy Zwift token for old unofficial endpoints.
    Uses Zwift username/password against the legacy token endpoint.
    """
    if not ZWIFT_USERNAME or not ZWIFT_PASSWORD:
        print("  Legacy auth skipped: ZWIFT_USERNAME / ZWIFT_PASSWORD not set")
        return None

    resp = requests.post(
        f"{ZWIFT_AUTH_BASE}/tokens/access/codes",
        data={
            "client_id": ZWIFT_LEGACY_CLIENT_ID,
            "grant_type": "password",
            "username": ZWIFT_USERNAME,
            "password": ZWIFT_PASSWORD,
        },
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        timeout=20,
    )
    if resp.status_code != 200:
        print(f"  Legacy auth failed ({resp.status_code}); legacy endpoints may return 403")
        return None
    token = resp.json().get("access_token")
    if token:
        print("  Legacy token acquired")
    else:
        print("  Legacy auth response did not include access_token")
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


def resolve_subgroup_ids(
    event_id: str,
    include_legacy: bool = False,
    legacy_token: str | None = None,
    event_secret: str | None = None,
) -> list[str]:
    """
    Resolve subgroup IDs from legacy event info.
    """
    section(f"RESOLVE — subgroup IDs from event info (event_id={event_id})")
    subgroup_ids: list[str] = []
    legacy_status = 0

    # Optional legacy fallback
    if include_legacy:
        if legacy_token:
            params = {"eventSecret": event_secret} if event_secret else None
            status, body = zwift_get(f"/api/events/{event_id}", legacy_token, params=params)
            legacy_status = status
            show("Legacy event info (for subgroup resolution)", status, body)
            if isinstance(body, dict):
                for subgroup in body.get("eventSubgroups", []) or []:
                    sid = subgroup.get("id")
                    if sid:
                        sid_str = str(sid)
                        if sid_str not in subgroup_ids:
                            subgroup_ids.append(sid_str)
        else:
            print("\n  Legacy subgroup resolution skipped: no legacy token")

    if subgroup_ids:
        print(f"\n  Resolved subgroup IDs: {subgroup_ids}")
    else:
        print("\n  No subgroup IDs resolved from event info.")
    return subgroup_ids, legacy_status


def explore_segment_results(token: str, subgroup_id: str) -> tuple[int, dict]:
    section(f"OFFICIAL — GET /api/link/events/subgroups/{{subgroupId}}/segment-results  (subgroup_id={subgroup_id})")

    # Fetch first page only so we can inspect the schema.
    status, body = zwift_get(
        f"/api/link/events/subgroups/{subgroup_id}/segment-results",
        token,
    )
    show("Segment results (first page, first 5 entries)", status, body, max_entries=5)
    checks = {
        "has_entries": False,
        "has_required_fields": False,
        "duration_is_numeric": False,
        "event_subgroup_present": False,
    }

    # If there are entries, highlight the unique segmentId values so we can
    # understand the structure (finish line vs. sprint segments).
    if isinstance(body, dict) and body.get("entries"):
        checks["has_entries"] = True
        segment_ids = sorted({e.get("segmentId") for e in body["entries"] if e.get("segmentId")})
        user_ids = sorted({e.get("userId") for e in body["entries"] if e.get("userId")})
        print(f"\n  Unique segmentIds in this page : {segment_ids}")
        print(f"  Unique userIds in this page    : {len(user_ids)} riders")

        first = body["entries"][0]
        required = {"id", "userId", "activityId", "segmentId", "eventSubgroupId", "durationInMilliseconds", "endDate"}
        checks["has_required_fields"] = required.issubset(set(first.keys()))
        checks["duration_is_numeric"] = isinstance(first.get("durationInMilliseconds"), (int, float))
        checks["event_subgroup_present"] = first.get("eventSubgroupId") is not None
        print("\n  Schema checks:")
        print(f"  - required fields present: {checks['has_required_fields']}")
        print(f"  - durationInMilliseconds numeric: {checks['duration_is_numeric']}")
        print(f"  - eventSubgroupId present: {checks['event_subgroup_present']}")

        # Show one full entry per unique segmentId so every field is visible.
        seen: set = set()
        print("\n  --- One representative entry per segmentId ---")
        for entry in body["entries"]:
            sid = entry.get("segmentId")
            if sid not in seen:
                seen.add(sid)
                print(f"\n  segmentId={sid}:")
                print(json.dumps(entry, indent=4, default=str))
    return status, checks


def explore_live_data(
    token: str,
    subgroup_id: str,
    include_avatar: bool = False,
    include_position: bool = False,
) -> int:
    section(f"OFFICIAL — GET /api/link/events/subgroups/{{subgroupId}}/live-data  (subgroup_id={subgroup_id})")
    status, body = zwift_get(
        f"/api/link/events/subgroups/{subgroup_id}/live-data",
        token,
        params={
            "page": 0,
            "limit": 5,
            "includeAvatar": str(include_avatar).lower(),
            "includePosition": str(include_position).lower(),
        },
    )
    show("Live data (first 5 entries)", status, body, max_entries=5)
    return status


def explore_racing_profile(token: str) -> int:
    section("OFFICIAL — GET /api/link/racing-profile  (user token required)")
    status, body = zwift_get(
        "/api/link/racing-profile",
        token,
        params={"includeCompetitionMetrics": "true"},
    )
    show("Racing profile", status, body)
    return status


def explore_power_curve(token: str, days: int = 30, year: int | None = None, activity_id: str | None = None) -> dict:
    statuses = {}
    section("OFFICIAL — GET /api/link/power-curve/best/all-time  (user token required)")
    status, body = zwift_get("/api/link/power-curve/best/all-time", token)
    show("Power curve (all-time)", status, body)
    statuses["best_all_time"] = status

    section(f"OFFICIAL — GET /api/link/power-curve/best/last?days={days}  (user token required)")
    status, body = zwift_get("/api/link/power-curve/best/last", token, params={"days": days})
    show(f"Power curve (last {days} days)", status, body)
    statuses["best_last"] = status

    if year is not None:
        section(f"OFFICIAL — GET /api/link/power-curve/best/year/{year}  (user token required)")
        status, body = zwift_get(f"/api/link/power-curve/best/year/{year}", token)
        show(f"Power curve (year {year})", status, body)
        statuses["best_year"] = status

    section("OFFICIAL — GET /api/link/power-curve/power-profile  (user token required)")
    status, body = zwift_get("/api/link/power-curve/power-profile", token)
    show("Power profile", status, body)
    statuses["power_profile"] = status

    if activity_id:
        section(f"OFFICIAL — GET /api/link/power-curve/activity/{{activityId}}  (activity_id={activity_id})")
        status, body = zwift_get(f"/api/link/power-curve/activity/{activity_id}", token)
        show("Power curve (single activity)", status, body)
        statuses["power_curve_activity"] = status
    return statuses


def explore_activity(token: str, activity_id: str) -> int:
    section(f"OFFICIAL — GET /api/thirdparty/activity/{{activityId}}  (activity_id={activity_id})")
    status, body = zwift_get(f"/api/thirdparty/activity/{activity_id}", token)
    show("Activity", status, body)
    return status


# ---------------------------------------------------------------------------
# ZwiftRacing.app endpoints
# ---------------------------------------------------------------------------

def explore_zr_rider(rider_id: str) -> int:
    section(f"ZWIFTRACING — GET /public/riders/{{riderId}}  (rider_id={rider_id})")
    if not ZR_AUTH_KEY:
        print("SKIPPED: ZR_AUTH_KEY not set")
        return 0
    status, body = zr_get(f"/public/riders/{rider_id}")
    show("Rider stats", status, body)
    return status


def explore_zr_results(event_id: str) -> int:
    section(f"ZWIFTRACING — GET /public/results/{{eventId}}  (event_id={event_id})")
    if not ZR_AUTH_KEY:
        print("SKIPPED: ZR_AUTH_KEY not set")
        return 0
    status, body = zr_get(f"/public/results/{event_id}")
    show("ZwiftRacing results (first 5 entries)", status, body, max_entries=5)
    return status


def explore_zp_results(event_id: str) -> int:
    section(f"ZWIFTRACING — GET /public/zp/{{eventId}}/results  (event_id={event_id})")
    if not ZR_AUTH_KEY:
        print("SKIPPED: ZR_AUTH_KEY not set")
        return 0
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
    return status


# ---------------------------------------------------------------------------
# Legacy endpoints (dual_stack mode only — shows what they look like)
# ---------------------------------------------------------------------------

def explore_legacy_event_info(token: str, event_id: str, event_secret: str | None = None) -> int:
    section(f"LEGACY — GET /api/events/{{eventId}}  (event_id={event_id})")
    params = {"eventSecret": event_secret} if event_secret else None
    status, body = zwift_get(f"/api/events/{event_id}", token, params=params)
    show("Legacy event info", status, body)
    return status


def explore_legacy_race_results(token: str, subgroup_id: str) -> int:
    section(f"LEGACY — GET /api/race-results/entries  (subgroup_id={subgroup_id})")
    status, body = zwift_get(
        "/api/race-results/entries",
        token,
        params={"event_subgroup_id": subgroup_id, "start": 0, "limit": 5},
    )
    show("Legacy race results (first 5 entries)", status, body, max_entries=5)
    return status


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
    p.add_argument("--subgroup-id", default=None,   help="Zwift event subgroup ID (optional if --resolve-subgroups)")
    p.add_argument("--event-secret", default=None,   help="Optional eventSecret (used on legacy event endpoint)")
    p.add_argument("--resolve-subgroups", action="store_true",
                   help="Resolve subgroup IDs from event info using eventId")
    p.add_argument("--rider-id",    default=None,   help="Zwift rider/user ID (for ZR endpoints)")
    p.add_argument("--activity-id", default=None,   help="Zwift activity ID")
    p.add_argument("--user-token",  default=None,   help="User OAuth access token (for profile/power curve)")
    p.add_argument("--days", type=int, default=30, help="Days window for /power-curve/best/last (default 30)")
    p.add_argument("--year", type=int, default=None, help="Optional year for /power-curve/best/year/{year}")
    p.add_argument("--include-avatar", action="store_true", help="Include avatar in live-data")
    p.add_argument("--include-position", action="store_true", help="Include position in live-data")
    p.add_argument("--legacy",      action="store_true",
                   help="Also call legacy endpoints for comparison")
    p.add_argument("--skip-zr",     action="store_true",
                   help="Skip ZwiftRacing.app endpoints")
    p.add_argument("--official-only", action="store_true",
                   help="Run only official Zwift API endpoints (skip legacy and ZwiftRacing)")
    return p.parse_args()


def main() -> None:
    args = parse_args()

    print("\nZwift API Explorer")
    print(f"  ZWIFT_API_BASE : {ZWIFT_API_BASE}")
    print(f"  ZWIFT_AUTH_BASE: {ZWIFT_AUTH_BASE}")
    print(f"  ZWIFT_USERNAME : {'set' if ZWIFT_USERNAME else 'NOT SET'}")
    print(f"  ZR_BASE_URL    : {ZR_BASE_URL}")
    print(f"  ZR_AUTH_KEY    : {'set' if ZR_AUTH_KEY else 'NOT SET'}")
    checks: dict[str, bool] = {}

    if args.official_only:
        args.legacy = False
        args.skip_zr = True
        section("MODE — Official only")
        print("  Legacy and ZwiftRacing endpoints disabled.")

    legacy_token: str | None = None
    if args.legacy:
        section("AUTH — Legacy token (username/password)")
        legacy_token = get_legacy_token()
        checks["legacy_token_acquired"] = bool(legacy_token)


    # --- App-level token (used for most official endpoints) ---
    app_token = explore_app_token()

    subgroup_ids: list[str] = []
    if args.subgroup_id:
        subgroup_ids = [str(args.subgroup_id)]
    elif args.resolve_subgroups:
        subgroup_ids, legacy_resolve_status = resolve_subgroup_ids(
            args.event_id,
            include_legacy=args.legacy,
            legacy_token=legacy_token,
            event_secret=args.event_secret,
        )
        if args.legacy:
            checks["legacy_resolve_event_info_200"] = legacy_resolve_status == 200
        checks["subgroup_resolved"] = len(subgroup_ids) > 0

    if subgroup_ids:
        selected_subgroup_id = subgroup_ids[0]
        print(f"\n  Using subgroup_id={selected_subgroup_id} for subgroup-based endpoint calls.")
        segment_status, segment_checks = explore_segment_results(app_token, selected_subgroup_id)
        checks["official_segment_results_200"] = segment_status == 200
        checks["segment_has_entries"] = segment_checks.get("has_entries", False)
        checks["segment_required_fields"] = segment_checks.get("has_required_fields", False)
        checks["segment_duration_numeric"] = segment_checks.get("duration_is_numeric", False)
        checks["segment_event_subgroup_present"] = segment_checks.get("event_subgroup_present", False)
        live_status = explore_live_data(
            app_token,
            selected_subgroup_id,
            include_avatar=args.include_avatar,
            include_position=args.include_position,
        )
        checks["official_live_data_200"] = live_status == 200
    else:
        section("OFFICIAL — subgroup endpoints (SKIPPED — pass --subgroup-id or --resolve-subgroups)")
        print("  Skipped: segment-results, live-data")
        checks["subgroup_resolved"] = False

    # --- Official Zwift endpoints (user token) ---
    if args.user_token:
        rp_status = explore_racing_profile(args.user_token)
        checks["official_racing_profile_200"] = rp_status == 200
        pc_statuses = explore_power_curve(
            args.user_token,
            days=args.days,
            year=args.year,
            activity_id=args.activity_id,
        )
        checks["official_best_all_time_200"] = pc_statuses.get("best_all_time") == 200
        checks["official_best_last_200"] = pc_statuses.get("best_last") == 200
        checks["official_power_profile_200"] = pc_statuses.get("power_profile") == 200
        if args.year is not None:
            checks["official_best_year_200"] = pc_statuses.get("best_year") == 200
        if args.activity_id:
            checks["official_power_curve_activity_200"] = pc_statuses.get("power_curve_activity") == 200
        if args.activity_id:
            act_status = explore_activity(args.user_token, args.activity_id)
            checks["official_activity_200"] = act_status == 200
    else:
        section("OFFICIAL — User-token endpoints (SKIPPED — pass --user-token to enable)")
        print("  Skipped: racing-profile, power-curve, activity")

    # --- ZwiftRacing.app ---
    if not args.skip_zr:
        if args.rider_id:
            zr_rider_status = explore_zr_rider(args.rider_id)
            checks["zr_rider_200"] = zr_rider_status == 200
        zr_results_status = explore_zr_results(args.event_id)
        checks["zr_results_200"] = zr_results_status == 200
        zp_results_status = explore_zp_results(args.event_id)
        checks["zp_results_200"] = zp_results_status == 200

    # --- Legacy endpoints ---
    if args.legacy:
        if legacy_token:
            legacy_event_status = explore_legacy_event_info(legacy_token, args.event_id, event_secret=args.event_secret)
            checks["legacy_event_info_200"] = legacy_event_status == 200
            if subgroup_ids:
                legacy_rr_status = explore_legacy_race_results(legacy_token, subgroup_ids[0])
                checks["legacy_race_results_200"] = legacy_rr_status == 200
            else:
                section("LEGACY — race-results (SKIPPED — no subgroup ID available)")
                print("  Skipped: /api/race-results/entries")
        else:
            section("LEGACY — endpoints (SKIPPED — no legacy token)")
            print("  Skipped: /api/events, /api/race-results/entries")

    section("CHECK SUMMARY")
    passed = 0
    failed = 0
    for name, ok in checks.items():
        mark = "PASS" if ok else "FAIL"
        print(f"  [{mark}] {name}")
        if ok:
            passed += 1
        else:
            failed += 1
    print(f"\n  Total: {passed} passed, {failed} failed")

    print(f"\n{DIVIDER}")
    print("  Done.")
    print(DIVIDER)


if __name__ == "__main__":
    main()
