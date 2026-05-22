"""
Seed a temporary Firestore race document pointing at any Zwift event and
optionally flip /live-race to it, so the live-race map page can be exercised
end-to-end before a real DCU league race.

Names will be blank for un-registered Zwift users (that is expected).

Usage:
  # Seed the test race (and flip /live-race to it)
  conda run -n py311 python backend/scripts/seed_test_live_race.py \\
      --event-id 4985729 --activate

  # Seed only (do not activate)
  conda run -n py311 python backend/scripts/seed_test_live_race.py \\
      --event-id 4985729

  # Deactivate /live-race (clears liveRaceState/active.raceId)
  conda run -n py311 python backend/scripts/seed_test_live_race.py --deactivate

  # Remove the seeded test race doc
  conda run -n py311 python backend/scripts/seed_test_live_race.py \\
      --event-id 4985729 --cleanup
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore

_BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(_BACKEND_DIR))

# Ensure Firebase Admin can find credentials before extensions.py imports.
# extensions.py uses a relative path that only resolves when cwd == backend/.
_LOCAL_SA = _BACKEND_DIR / "serviceAccountKey.json"
if not os.getenv("GOOGLE_APPLICATION_CREDENTIALS") and _LOCAL_SA.exists():
    os.environ["GOOGLE_APPLICATION_CREDENTIALS"] = str(_LOCAL_SA)

from extensions import get_zwift_service  # noqa: E402

logger = logging.getLogger("seed_test_live_race")


# Standard Zwift worldId -> map name (slugified to lowercase by frontend before
# matching `zwift-data` slugs). Uppercase matches existing Firestore convention.
WORLD_ID_TO_NAME: dict[int, str] = {
    1: "WATOPIA",
    2: "RICHMOND",
    3: "LONDON",
    4: "NEW YORK",
    5: "INNSBRUCK",
    6: "BOLOGNA",
    7: "YORKSHIRE",
    8: "CRIT CITY",
    9: "MAKURI ISLANDS",
    10: "FRANCE",
    11: "PARIS",
    12: "SCOTLAND",
    13: "PARIS",  # cobbled climbs / paris area
}


def _init_firebase() -> firestore.Client:
    # extensions.py may have already created an app with no usable credentials;
    # if so, replace it with one that uses our service-account key.
    if firebase_admin._apps and _LOCAL_SA.exists():
        try:
            firestore.client()
        except Exception:
            for app in list(firebase_admin._apps.values()):
                firebase_admin.delete_app(app)

    if not firebase_admin._apps:
        gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if gac and os.path.exists(gac):
            firebase_admin.initialize_app(credentials.Certificate(gac))
        elif _LOCAL_SA.exists():
            firebase_admin.initialize_app(credentials.Certificate(str(_LOCAL_SA)))
        else:
            firebase_admin.initialize_app()
    return firestore.client()


def _load_routes_index() -> dict[int, dict[str, Any]]:
    routes_path = Path(__file__).resolve().parents[1] / "data" / "routes.json"
    with routes_path.open("r", encoding="utf-8") as f:
        rows = json.load(f)
    index: dict[int, dict[str, Any]] = {}
    for r in rows:
        rid = r.get("id")
        if isinstance(rid, int):
            index[rid] = r
    return index


def _build_subgroup_config(
    subgroup: dict[str, Any],
    routes_index: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    raw_label = subgroup.get("subgroupLabel") or subgroup.get("name") or ""
    label = str(raw_label).strip().upper() or "A"
    return {
        "customCategory": label,
        "subgroupId": str(subgroup["id"]),
        "eventId": str(subgroup.get("eventId") or ""),
        "laps": int(subgroup.get("laps") or 1),
        "sprints": [],
        "startTime": subgroup.get("eventSubgroupStart"),
    }


def _pick_primary_route(
    subgroups: list[dict[str, Any]],
    routes_index: dict[int, dict[str, Any]],
) -> dict[str, Any] | None:
    for sg in subgroups:
        route_id = sg.get("routeId")
        if isinstance(route_id, int) and route_id in routes_index:
            return routes_index[route_id]
    return None


def _world_name_for(route: dict[str, Any]) -> str | None:
    world_id = route.get("worldId")
    if isinstance(world_id, int):
        return WORLD_ID_TO_NAME.get(world_id)
    return None


def seed_race(
    db: firestore.Client,
    event_id: str,
    doc_id: str,
) -> dict[str, Any]:
    zwift = get_zwift_service()
    event = zwift.get_public_event_info(event_id)
    if not event:
        raise RuntimeError(f"Could not fetch event {event_id} from Zwift")

    subgroups = event.get("eventSubgroups") or []
    if not isinstance(subgroups, list) or not subgroups:
        raise RuntimeError(f"Event {event_id} has no eventSubgroups")

    routes_index = _load_routes_index()
    primary_route = _pick_primary_route(subgroups, routes_index)
    if not primary_route:
        raise RuntimeError(
            f"None of the subgroup routeIds resolved in backend/data/routes.json"
        )

    world_name = _world_name_for(primary_route)
    if not world_name:
        raise RuntimeError(
            f"Unknown worldId {primary_route.get('worldId')} for route "
            f"{primary_route.get('name')}"
        )

    laps = int(subgroups[0].get("laps") or 1)
    distance_km = round(
        (primary_route.get("distanceInMeters", 0) * laps
         + primary_route.get("leadinDistanceInMeters", 0)) / 1000.0,
        1,
    )
    elevation_m = int(round(
        primary_route.get("ascentInMeters", 0) * laps
        + primary_route.get("leadinAscentInMeters", 0)
    ))

    event_configuration = [
        _build_subgroup_config({**sg, "eventId": event_id}, routes_index)
        for sg in subgroups
        if isinstance(sg, dict) and sg.get("id")
    ]

    event_start = event.get("eventStart") or subgroups[0].get("eventSubgroupStart")
    if event_start:
        date_str = str(event_start)
    else:
        date_str = datetime.now(timezone.utc).isoformat()

    race_doc = {
        "name": f"[TEST] {event.get('name') or 'Live race test'}",
        "date": date_str,
        "routeId": str(primary_route.get("id")),
        "routeName": primary_route.get("name"),
        "map": world_name,
        "laps": laps,
        "totalDistance": distance_km,
        "totalElevation": elevation_m,
        "eventId": str(event_id),
        "eventMode": "multi",
        "eventConfiguration": event_configuration,
        "resultsPhase": "pending",
        "_seededBy": "seed_test_live_race",
        "_seededAt": firestore.SERVER_TIMESTAMP,
    }

    db.collection("races").document(doc_id).set(race_doc)
    print(f"Seeded races/{doc_id}")
    print(f"  name        : {race_doc['name']}")
    print(f"  map / route : {race_doc['map']} / {race_doc['routeName']}")
    print(f"  laps        : {race_doc['laps']}  ({race_doc['totalDistance']} km, "
          f"{race_doc['totalElevation']} m)")
    print("  subgroups   :")
    for cfg in event_configuration:
        print(f"    - cat={cfg['customCategory']}  subgroupId={cfg['subgroupId']}  "
              f"laps={cfg['laps']}")
    return race_doc


def set_active(db: firestore.Client, race_id: str | None) -> None:
    db.collection("liveRaceState").document("active").set(
        {
            "raceId": race_id,
            "activatedAt": firestore.SERVER_TIMESTAMP,
            "activatedBy": "seed_test_live_race",
        },
        merge=False,
    )
    if race_id:
        print(f"Activated /live-race -> races/{race_id}")
    else:
        print("Deactivated /live-race (raceId=None)")


def cleanup(db: firestore.Client, doc_id: str) -> None:
    db.collection("races").document(doc_id).delete()
    print(f"Deleted races/{doc_id}")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--event-id", help="Zwift event id (numeric)")
    parser.add_argument(
        "--doc-id",
        help="Firestore races/{doc_id} (default: test_live_<event_id>)",
    )
    parser.add_argument(
        "--activate",
        action="store_true",
        help="Flip /live-race to the seeded race after writing",
    )
    parser.add_argument(
        "--deactivate",
        action="store_true",
        help="Clear liveRaceState/active.raceId and exit",
    )
    parser.add_argument(
        "--cleanup",
        action="store_true",
        help="Delete the seeded race doc (and deactivate if it is currently active)",
    )
    args = parser.parse_args()

    db = _init_firebase()

    if args.deactivate and not args.cleanup and not args.event_id:
        set_active(db, None)
        return 0

    if not args.event_id and not args.deactivate:
        parser.error("--event-id is required (unless using --deactivate)")
        return 2

    doc_id = (args.doc_id or f"test_live_{args.event_id}").strip()

    if args.cleanup:
        state = db.collection("liveRaceState").document("active").get()
        if state.exists and (state.to_dict() or {}).get("raceId") == doc_id:
            set_active(db, None)
        cleanup(db, doc_id)
        return 0

    seed_race(db, args.event_id, doc_id)
    if args.activate:
        set_active(db, doc_id)
    else:
        print("Note: pass --activate, or open Admin -> Liga -> Resultater and "
              "click 'Aktivér live-race side' on the seeded race.")
    return 0


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    sys.exit(main())
