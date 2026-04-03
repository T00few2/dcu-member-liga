"""
Find subgroup IDs for archived races.

This helper pulls archived race data from the local backend endpoints and then
tries event-info endpoints to resolve subgroup IDs for each archived event ID.

Run from repository root (or backend/):

    python backend/tests/migration/find_archived_subgroups.py \
        --archive-id <archiveId> \
        --race-id <raceId>

Optional:
    --all-races                   # process every race in archive
"""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

import requests
from dotenv import load_dotenv

load_dotenv()


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


ZWIFT_AUTH_BASE = _env("ZWIFT_AUTH_BASE_URL", "https://secure.zwift.com/auth/realms/zwift").rstrip("/")
ZWIFT_API_BASE = _env("ZWIFT_API_BASE_URL", "https://us-or-rly101.zwift.com").rstrip("/")
ZWIFT_USERNAME = _env("ZWIFT_USERNAME")
ZWIFT_PASSWORD = _env("ZWIFT_PASSWORD")
ZWIFT_LEGACY_CLIENT_ID = _env("ZWIFT_LEGACY_CLIENT_ID", "Zwift_Mobile_Link")


def fetch_json(url: str, *, headers: dict[str, str] | None = None, params: dict[str, Any] | None = None) -> tuple[int, Any]:
    resp = requests.get(url, headers=headers or {}, params=params or {}, timeout=20)
    try:
        return resp.status_code, resp.json()
    except Exception:
        return resp.status_code, {"_raw": resp.text}


def get_legacy_token() -> str | None:
    if not ZWIFT_USERNAME or not ZWIFT_PASSWORD:
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
        return None
    return resp.json().get("access_token")


def collect_targets(race_doc: dict[str, Any]) -> list[dict[str, str]]:
    targets: list[dict[str, str]] = []
    seen: set[tuple[str, str]] = set()

    for cfg in race_doc.get("eventConfiguration", []) or []:
        event_id = str(cfg.get("eventId") or "").strip()
        event_secret = str(cfg.get("eventSecret") or "").strip()
        if not event_id:
            continue
        key = (event_id, event_secret)
        if key in seen:
            continue
        seen.add(key)
        targets.append(
            {
                "eventId": event_id,
                "eventSecret": event_secret,
                "customCategory": str(cfg.get("customCategory") or "").strip(),
                "startTime": str(cfg.get("startTime") or "").strip(),
            }
        )

    # Fallback: linked IDs if config is missing.
    for linked in race_doc.get("linkedEventIds", []) or []:
        event_id = str(linked or "").strip()
        if not event_id:
            continue
        key = (event_id, "")
        if key in seen:
            continue
        seen.add(key)
        targets.append(
            {
                "eventId": event_id,
                "eventSecret": "",
                "customCategory": "",
                "startTime": "",
            }
        )

    return targets


def query_event_info(
    event_id: str,
    event_secret: str,
    legacy_token: str | None,
) -> dict[str, Any]:
    params = {"eventSecret": event_secret} if event_secret else {}

    if legacy_token:
        legacy_status, legacy_body = fetch_json(
            f"{ZWIFT_API_BASE}/api/events/{event_id}",
            headers={"Authorization": f"Bearer {legacy_token}", "Accept": "application/json"},
            params=params,
        )
    else:
        legacy_status, legacy_body = 0, {"_note": "legacy token unavailable"}

    subgroup_ids: list[str] = []
    subgroup_rows: list[dict[str, Any]] = []
    if isinstance(legacy_body, dict):
        for subgroup in legacy_body.get("eventSubgroups", []) or []:
            sid = str(subgroup.get("id") or "").strip()
            if sid and sid not in subgroup_ids:
                subgroup_ids.append(sid)
                subgroup_rows.append(
                    {
                        "id": sid,
                        "subgroupLabel": subgroup.get("subgroupLabel"),
                        "routeId": subgroup.get("routeId"),
                        "laps": subgroup.get("laps"),
                    }
                )

    return {
        "legacyStatus": legacy_status,
        "subgroupIds": subgroup_ids,
        "eventSubgroups": subgroup_rows,
    }


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Resolve subgroup IDs for archived races.")
    p.add_argument("--archive-id", required=True, help="Archive ID from GET /archives")
    p.add_argument("--race-id", help="Race ID inside archive (omit with --all-races)")
    p.add_argument("--all-races", action="store_true", help="Process all races in archive")
    p.add_argument("--backend-base", default="http://127.0.0.1:8080", help="Local backend base URL")
    return p.parse_args()


def main() -> int:
    args = parse_args()
    if not args.all_races and not args.race_id:
        print("ERROR: pass either --race-id or --all-races")
        return 2

    legacy_token = get_legacy_token()

    race_ids: list[str] = []
    if args.all_races:
        status, payload = fetch_json(f"{args.backend_base.rstrip('/')}/archives/{args.archive_id}")
        if status != 200 or not isinstance(payload, dict):
            print(json.dumps({"error": "failed_to_load_archive", "status": status, "payload": payload}, indent=2))
            return 1
        race_ids = [str(r.get("id")) for r in payload.get("races", []) if r.get("id")]
    else:
        race_ids = [args.race_id]

    results: list[dict[str, Any]] = []
    for race_id in race_ids:
        status, payload = fetch_json(f"{args.backend_base.rstrip('/')}/archives/{args.archive_id}/races/{race_id}")
        race_doc = payload.get("race", {}) if isinstance(payload, dict) else {}
        if status != 200 or not isinstance(race_doc, dict):
            results.append(
                {
                    "raceId": race_id,
                    "error": "failed_to_load_archive_race",
                    "status": status,
                    "payload": payload,
                }
            )
            continue

        targets = collect_targets(race_doc)
        event_checks: list[dict[str, Any]] = []
        for t in targets:
            check = query_event_info(t["eventId"], t["eventSecret"], legacy_token)
            event_checks.append(
                {
                    **t,
                    **check,
                }
            )

        results.append(
            {
                "raceId": race_id,
                "raceName": race_doc.get("name"),
                "targets": event_checks,
            }
        )

    print(json.dumps({"archiveId": args.archive_id, "races": results}, indent=2, default=str))

    print("\nSuggested explore command(s):")
    for race in results:
        for t in race.get("targets", []):
            subgroup_ids = t.get("subgroupIds", []) or []
            if not subgroup_ids:
                continue
            print(
                "python tests/migration/explore_zwift_api.py "
                f"--event-id {t['eventId']} --subgroup-id {subgroup_ids[0]} --legacy"
            )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
