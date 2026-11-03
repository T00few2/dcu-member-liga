"""Measure and tune the vELO predictor against real Firestore data.

The predictor is used to place riders from their Strava (outdoor) power. This
script checks how often that gives the right division for riders whose real
vELO is known, and searches for better settings.

Usage (from the repo root):
  # Today's accuracy only (nothing is written)
  conda run -n py311 python backend/scripts/predictor_tune.py --report-only

  # Full search, print the result, write nothing
  conda run -n py311 python backend/scripts/predictor_tune.py --dry-run

  # Full search and store the run; a better config shows up for Apply/Reject
  conda run -n py311 python backend/scripts/predictor_tune.py

  # First fill the Strava curve cache for up to 20 eligible riders that have none.
  # Spends Strava API requests (about 50 per rider) and pauses between riders to
  # stay under Strava's 100 requests / 15 min limit.
  conda run -n py311 python backend/scripts/predictor_tune.py --warm-strava 20 --dry-run

Credentials: GOOGLE_APPLICATION_CREDENTIALS, else backend/serviceAccountKey.json, else ADC.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time

import firebase_admin
from firebase_admin import credentials

BACKEND_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, BACKEND_DIR)


def _init_firebase() -> None:
    if firebase_admin._apps:
        return
    gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if gac and os.path.exists(gac):
        firebase_admin.initialize_app(credentials.Certificate(gac))
        return
    local_sa = os.path.join(BACKEND_DIR, "serviceAccountKey.json")
    if os.path.exists(local_sa):
        firebase_admin.initialize_app(credentials.Certificate(local_sa))
        return
    firebase_admin.initialize_app()


def _print(title: str, data) -> None:
    print(f"\n== {title} ==")
    print(json.dumps(data, indent=2, ensure_ascii=False, default=str))


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--report-only", action="store_true", help="Only measure today's accuracy")
    parser.add_argument("--dry-run", action="store_true", help="Search but do not store the run")
    parser.add_argument("--folds", type=int, default=5)
    parser.add_argument("--warm-strava", type=int, default=0, metavar="N",
                        help="Fetch Strava curves for up to N eligible riders without a cached curve")
    parser.add_argument("--pause-seconds", type=int, default=450,
                        help="Pause between Strava riders when warming the cache (default 450)")
    args = parser.parse_args()

    try:
        _init_firebase()
    except Exception as exc:
        print(f"Firebase credentials not available: {exc}", file=sys.stderr)
        return 2

    from extensions import db, strava_service
    from services import predictor_service as ps
    from services import predictor_tuning as pt
    from services import predictor_tuning_runs as runs
    from services.dual_recording.strava import _compute_strava_power_curve
    from services.strava_power_curve import get_strava_power_curve, read_cached_curve

    if db is None:
        print("Firestore is not available (check credentials).", file=sys.stderr)
        return 2

    participants = ps.load_participants(db)
    categories = ps.load_categories(db)
    config = ps.load_config(db)
    min_rides = ps.division_agent_settings(db)["minZwiftRides"]
    print(f"Riders loaded: {len(participants)} · minZwiftRides: {min_rides}")

    if args.warm_strava > 0:
        days = config.stravaWindowDays
        todo = [
            p for p in participants
            if pt.reliable_velo(p, min_rides) is not None
            and p.get("userDocId")
            and read_cached_curve(db, p["userDocId"], days) is None
        ][: args.warm_strava]
        print(f"Warming Strava cache ({days}d) for {len(todo)} riders…")
        for i, p in enumerate(todo, 1):
            try:
                entry = get_strava_power_curve(db, strava_service, p["userDocId"], days,
                                               compute_curve=_compute_strava_power_curve)
                print(f"  {i}/{len(todo)} {p.get('zwiftId')}: {entry['activityCount']} rides")
            except Exception as exc:
                print(f"  {i}/{len(todo)} {p.get('zwiftId')}: failed ({exc})")
            if i < len(todo):
                time.sleep(args.pause_seconds)

    def read_curve(doc_id: str, d: int):
        try:
            return read_cached_curve(db, doc_id, d)
        except Exception:
            return None

    riders = pt.build_eval_set(participants, read_curve, min_rides=min_rides, categories=categories)
    print(f"Eval riders (reliable vELO + cached Strava curve): {len(riders)}")

    if args.report_only:
        score, _ = pt.cross_validate(participants, riders, config, categories=categories, folds=args.folds)
        _print("Current config", config.to_dict())
        _print("Strava → division accuracy (cross-validated)", score.to_dict() if score else None)
        _print("Earlier predicted placements vs. real vELO now",
               pt.past_prediction_outcomes(participants, min_rides=min_rides, categories=categories))
        return 0

    run = runs.run_tuning(db, started_by="predictor_tune.py", save=not args.dry_run, folds=args.folds)
    _print("Tuning result", run["result"])
    if args.dry_run:
        print("\nDry run: nothing stored.")
    elif run["status"] == "pending":
        print(f"\nStored run {run['runId']} — apply or reject it on the admin predictor page.")
    else:
        print(f"\nStored report-only run {run['runId']}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
