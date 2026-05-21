"""
Register or unregister riders on Zwift event subgroups (admin ops).

Uses the official batch endpoints documented in zwift_api_docs.md:
  POST .../participants/batch-register
  POST .../participants/batch-unregister

Requires ZWIFT_CLIENT_ID and ZWIFT_CLIENT_SECRET (backend/.env).

Examples:
  # Unregister by Zwift public UUID
  conda run -n py311 python backend/scripts/zwift_event_participants.py \\
    unregister \\
    --public-id 094e4781-af17-4bde-b7bb-88692d5a8a2a \\
    --subgroup-id 7158675 --subgroup-id 7158679

  # Register using Firestore user doc id (= numeric zwiftId)
  conda run -n py311 python backend/scripts/zwift_event_participants.py \\
    register \\
    --zwift-id 1747183 --subgroup-id 7158674

  # Apply a local batch file (see zwift_signup_batch.example.json)
  conda run -n py311 python backend/scripts/zwift_event_participants.py \\
    apply \\
    --batch backend/scripts/local/my_fixups.json
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any

import firebase_admin
from firebase_admin import credentials, firestore

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extensions import get_zwift_service  # noqa: E402


def _init_firebase() -> firestore.Client:
    if not firebase_admin._apps:
        gac = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
        if gac and os.path.exists(gac):
            firebase_admin.initialize_app(credentials.Certificate(gac))
        else:
            local_sa = (
                Path(__file__).resolve().parents[1] / "serviceAccountKey.json"
            )
            if local_sa.exists():
                firebase_admin.initialize_app(
                    credentials.Certificate(str(local_sa)),
                )
            else:
                firebase_admin.initialize_app()
    return firestore.client()


def _resolve_public_id(
    public_id: str | None,
    zwift_id: str | None,
) -> str:
    if public_id:
        return str(public_id).strip()
    if not zwift_id:
        raise ValueError("Provide --public-id or --zwift-id")

    doc = (
        _init_firebase()
        .collection("users")
        .document(str(zwift_id).strip())
        .get()
    )
    if not doc.exists:
        raise ValueError(
            f"Firestore user doc not found for zwiftId {zwift_id}",
        )

    data = doc.to_dict() or {}
    resolved = str(
        data.get("zwiftUserId")
        or ((data.get("connections") or {}).get("zwift") or {}).get("userId")
        or ""
    ).strip()
    if not resolved:
        raise ValueError(
            f"User {zwift_id} has no zwiftUserId / connections.zwift.userId"
        )
    return resolved


def _run_action(
    svc,
    action: str,
    public_ids: list[str],
    subgroup_ids: list[str],
) -> list[dict[str, Any]]:
    if action not in {"register", "unregister"}:
        raise ValueError(f"Unsupported action: {action}")

    fn = (
        svc.batch_register_participants
        if action == "register"
        else svc.batch_unregister_participants
    )
    results: list[dict[str, Any]] = []
    for subgroup_id in subgroup_ids:
        status, payload = fn(
            event_subgroup_id=subgroup_id,
            public_ids=public_ids,
        )
        results.append(
            {
                "action": action,
                "subgroupId": subgroup_id,
                "publicIds": public_ids,
                "status": status,
                "payload": payload,
            }
        )
        print(json.dumps(results[-1], default=str))
    return results


def _apply_batch(batch_path: Path) -> list[dict[str, Any]]:
    payload = json.loads(batch_path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("Batch file must be a JSON array")

    svc = get_zwift_service()
    all_results: list[dict[str, Any]] = []

    for idx, entry in enumerate(payload):
        if not isinstance(entry, dict):
            raise ValueError(f"Batch entry {idx} must be an object")

        name = str(entry.get("name") or entry.get("zwiftId") or idx)
        print(f"\n=== {name} ===")

        public_id = _resolve_public_id(
            entry.get("publicId"),
            entry.get("zwiftId"),
        )

        for subgroup_id in entry.get("unregister") or []:
            all_results.extend(
                _run_action(svc, "unregister", [public_id], [str(subgroup_id)])
            )

        for subgroup_id in entry.get("register") or []:
            all_results.extend(
                _run_action(svc, "register", [public_id], [str(subgroup_id)])
            )

    return all_results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Register/unregister Zwift event subgroup participants",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    for action in ("register", "unregister"):
        cmd = sub.add_parser(
            action,
            help=f"Batch-{action} riders on subgroup pens",
        )
        cmd.add_argument(
            "--public-id",
            help="Zwift public UUID (connections.zwift.userId / zwiftUserId)",
        )
        cmd.add_argument(
            "--zwift-id",
            help="Numeric Zwift profile id (= Firestore users/{docId})",
        )
        cmd.add_argument(
            "--subgroup-id",
            action="append",
            required=True,
            dest="subgroup_ids",
            help="Event subgroup id (repeatable)",
        )

    batch_cmd = sub.add_parser(
        "apply",
        help="Apply register/unregister steps from a JSON batch file",
    )
    batch_cmd.add_argument(
        "--batch",
        required=True,
        help="Path to JSON batch file (store under scripts/local/)",
    )

    args = parser.parse_args()
    svc = get_zwift_service()

    if args.command == "apply":
        _apply_batch(Path(args.batch))
        return

    public_id = _resolve_public_id(
        getattr(args, "public_id", None),
        getattr(args, "zwift_id", None),
    )
    _run_action(svc, args.command, [public_id], args.subgroup_ids)


if __name__ == "__main__":
    main()
