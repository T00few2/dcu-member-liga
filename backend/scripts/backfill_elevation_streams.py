"""
Backfill missing distance/altitude streams in elevation_cache.

Tries Strava first, then What's on Zwift (requires world + route slug).
Preserves existing profileSegments via merge=True.

Usage:
  conda run -n py311 python backend/scripts/backfill_elevation_streams.py
  conda run -n py311 python backend/scripts/backfill_elevation_streams.py --segment-id 37098941 --world watopia --route itza-party
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from dotenv import load_dotenv

load_dotenv(BACKEND_DIR / '.env')

from firebase_admin import credentials, firestore, initialize_app, get_app
from services.strava import StravaService
from services.elevation_sources import fetch_whatsonzwift_elevation_streams


DEFAULT_TARGETS = [
    {
        'segment_id': 37098941,
        'world': 'watopia',
        'route': 'itza-party',
        'lead_in_km': 0.497,
    },
    {
        'segment_id': 15155838,
        'world': 'london',
        'route': 'the-london-pretzel',
        'lead_in_km': 0.462,
    },
]


def _has_streams(data: dict | None) -> bool:
    if not isinstance(data, dict):
        return False
    d = data.get('distance')
    a = data.get('altitude')
    return isinstance(d, list) and isinstance(a, list) and len(d) > 0 and len(a) > 0


def _init_db():
    try:
        get_app()
    except ValueError:
        cred_path = os.environ.get('GOOGLE_APPLICATION_CREDENTIALS')
        local_key = BACKEND_DIR / 'serviceAccountKey.json'
        if cred_path and Path(cred_path).exists():
            initialize_app(credentials.Certificate(cred_path))
        elif local_key.exists():
            initialize_app(credentials.Certificate(str(local_key)))
        else:
            raise SystemExit(
                'Firestore credentials missing. Set GOOGLE_APPLICATION_CREDENTIALS '
                'or place backend/serviceAccountKey.json'
            )
    return firestore.client()


def backfill_one(db, strava: StravaService, target: dict, force: bool = False) -> int:
    sid = int(target['segment_id'])
    world = target.get('world')
    route = target.get('route')
    lead_in = target.get('lead_in_km')
    ref = db.collection('elevation_cache').document(str(sid))
    existing = ref.get().to_dict() if ref.get().exists else {}
    if not isinstance(existing, dict):
        existing = {}

    if _has_streams(existing) and not force:
        print(f'{sid}: already has streams (dist={len(existing["distance"])}), skip')
        return 0

    streams = None
    source = None
    strava_streams, strava_err = strava.get_segment_streams(sid)
    if strava_streams and _has_streams(strava_streams):
        streams, source = strava_streams, 'strava'
    else:
        print(f'{sid}: Strava unavailable ({strava_err})')
        if world and route:
            wow = fetch_whatsonzwift_elevation_streams(world, route)
            if wow and _has_streams(wow):
                streams, source = wow, 'whatsonzwift'
            else:
                print(f'{sid}: What\'s on Zwift fallback failed')
                return 1
        else:
            print(f'{sid}: no world/route for fallback')
            return 1

    payload = {
        'distance': streams['distance'],
        'altitude': streams['altitude'],
    }
    if lead_in is not None and existing.get('leadInDistance') is None:
        payload['leadInDistance'] = float(lead_in)

    ref.set(payload, merge=True)
    print(
        f'{sid}: wrote {len(payload["distance"])} points via {source}; '
        f'profileSegments kept={isinstance(existing.get("profileSegments"), list)}'
    )
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description='Backfill elevation_cache streams')
    parser.add_argument('--segment-id', type=int)
    parser.add_argument('--world')
    parser.add_argument('--route')
    parser.add_argument('--lead-in-km', type=float)
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()

    db = _init_db()
    strava = StravaService(db)

    if args.segment_id:
        targets = [{
            'segment_id': args.segment_id,
            'world': args.world,
            'route': args.route,
            'lead_in_km': args.lead_in_km,
        }]
    else:
        targets = DEFAULT_TARGETS

    failures = 0
    for t in targets:
        failures += backfill_one(db, strava, t, force=args.force)
    return 1 if failures else 0


if __name__ == '__main__':
    raise SystemExit(main())
