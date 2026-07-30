"""
Sync Zwift route/road/segment data from an installed Sauce for Zwift app.

Copies Sauce shared/deps/data into backend/data, transforming segments.json from
Sauce's directional rows into this repo's dual forward/reverse schema.

Usage:
  conda run -n py311 python backend/scripts/sync_sauce_data.py
  conda run -n py311 python backend/scripts/sync_sauce_data.py --sauce-data-dir PATH
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import defaultdict
from pathlib import Path
from typing import Any

BACKEND_DIR = Path(__file__).resolve().parents[1]
DATA_DIR = BACKEND_DIR / "data"
DEFAULT_ASAR = Path(
    os.environ.get(
        "SAUCE4ZWIFT_ASAR",
        Path(os.environ.get("LOCALAPPDATA", ""))
        / "Programs"
        / "sauce4zwift"
        / "resources"
        / "app.asar",
    )
)

COPY_ROOT_FILES = (
    "routes.json",
    "worldlist.json",
    "portal_roads.json",
    "countries.json",
)

# Local-only helpers (Sauce does not ship these) — never overwrite.
PRESERVE_ROOT_FILES = (
    "paddocks.json",
    "segRequireStartEnd.json",
)

REVERSE_NAME_RE = re.compile(r"\s+reverse$", re.IGNORECASE)


def _load_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def _dump_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(data, ensure_ascii=False, separators=(",", ":")),
        encoding="utf-8",
    )


def _normalize_base_name(name: str | None) -> str:
    if not name:
        return ""
    return REVERSE_NAME_RE.sub("", name).strip().casefold()


def _signed_reverse_id(forward_id: str | int) -> str:
    return str(int(forward_id) - (1 << 63))


def _group_key(seg: dict[str, Any]) -> tuple:
    arch = seg.get("archId")
    if arch is not None:
        return ("arch", arch)
    return ("name", _normalize_base_name(seg.get("name")))


def _index_local_segments(local_segs: list[dict[str, Any]]) -> dict[tuple, dict[str, Any]]:
    """Index existing dual-format rows for preserving reverse start when Sauce is forward-only."""
    by_key: dict[tuple, dict[str, Any]] = {}
    for seg in local_segs:
        arch = seg.get("archId")
        if arch is not None:
            by_key[("arch", arch)] = seg
        name = seg.get("nameForward") or ""
        by_key[("name", _normalize_base_name(name))] = seg
        fwd = seg.get("idForward")
        if fwd is not None:
            by_key[("id", str(fwd))] = seg
    return by_key


def transform_segments(
    sauce_segs: list[dict[str, Any]],
    local_segs: list[dict[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Convert Sauce directional segment rows into dual forward/reverse rows."""
    local_index = _index_local_segments(local_segs or [])
    groups: dict[tuple, list[dict[str, Any]]] = defaultdict(list)
    for seg in sauce_segs:
        groups[_group_key(seg)].append(seg)

    out: list[dict[str, Any]] = []
    for key, rows in groups.items():
        if key == ("name", ""):
            # Unnamed / ungroupable — emit one dual row per Sauce row.
            for row in rows:
                fwd = None if row.get("reverse") else row
                rev = row if row.get("reverse") else None
                out.append(_merge_pair(fwd, rev, local_index))
            continue

        forward = next((r for r in rows if not r.get("reverse")), None)
        reverse = next((r for r in rows if r.get("reverse")), None)
        if forward is None and reverse is None:
            continue
        out.append(_merge_pair(forward, reverse, local_index))

    # Stable-ish order: by archId (nulls last), then name.
    out.sort(
        key=lambda s: (
            s.get("archId") is None,
            s.get("archId") if s.get("archId") is not None else 10**9,
            (s.get("nameForward") or s.get("nameReverse") or "").casefold(),
        )
    )
    return out


def _merge_pair(
    forward: dict[str, Any] | None,
    reverse: dict[str, Any] | None,
    local_index: dict[tuple, dict[str, Any]],
) -> dict[str, Any]:
    primary = forward or reverse or {}
    existing = None
    arch = primary.get("archId")
    if arch is not None:
        existing = local_index.get(("arch", arch))
    if existing is None and forward and forward.get("id") is not None:
        existing = local_index.get(("id", str(forward["id"])))
    if existing is None:
        existing = local_index.get(("name", _normalize_base_name(primary.get("name"))))

    loop = bool((forward or {}).get("loop") or (reverse or {}).get("loop"))
    world_id = primary.get("worldId")
    road_id = primary.get("roadId")
    road_finish = primary.get("roadFinish")
    if forward and reverse:
        # Prefer shared finish from forward when both present.
        road_finish = forward.get("roadFinish", road_finish)

    row: dict[str, Any] = {
        "archId": arch,
        "color": primary.get("color"),
        "givesPowerUp": primary.get("givesPowerUp", True),
        "requiresAllCheckpoints": loop,
        "roadFinish": road_finish,
        "roadId": road_id,
        "worldId": world_id,
    }

    if forward:
        row["idForward"] = str(forward["id"])
        row["nameForward"] = forward.get("name")
        row["roadStartForward"] = forward.get("roadStart")
        row["distanceForward"] = forward.get("distance")
    else:
        # Reverse-only banner: keep reverse fields; leave forward empty so matchers skip it.
        row["idForward"] = None
        row["nameForward"] = (
            REVERSE_NAME_RE.sub("", reverse.get("name") or "").strip()
            if reverse
            else None
        ) or None
        row["roadStartForward"] = None
        row["distanceForward"] = None

    if reverse:
        row["idReverse"] = str(reverse["id"])
        row["nameReverse"] = reverse.get("name")
        row["roadStartReverse"] = reverse.get("roadStart")
        row["distanceReverse"] = reverse.get("distance")
        if road_finish is None:
            row["roadFinish"] = reverse.get("roadFinish")
        if road_id is None:
            row["roadId"] = reverse.get("roadId")
    elif forward:
        # Forward-only: synthesize reverse id; preserve local reverse geometry when available.
        row["idReverse"] = _signed_reverse_id(forward["id"])
        if existing and existing.get("roadStartReverse") is not None:
            row["roadStartReverse"] = existing["roadStartReverse"]
            row["distanceReverse"] = existing.get("distanceReverse")
            if existing.get("nameReverse"):
                row["nameReverse"] = existing["nameReverse"]
            if existing.get("idReverse") is not None:
                # Prefer previously known reverse id when present (may differ from formula).
                row["idReverse"] = str(existing["idReverse"])
        else:
            row["roadStartReverse"] = forward.get("roadFinish")
            row["distanceReverse"] = None
    else:
        row["idReverse"] = None
        row["roadStartReverse"] = None
        row["distanceReverse"] = None

    # Drop nameReverse when it duplicates nameForward.
    if row.get("nameReverse") and row.get("nameForward"):
        if _normalize_base_name(row["nameReverse"]) == _normalize_base_name(row["nameForward"]):
            if row["nameReverse"].casefold() == row["nameForward"].casefold():
                row.pop("nameReverse", None)

    return row


def extract_sauce_data(asar_path: Path, dest: Path) -> Path:
    """Extract Sauce asar and return path to shared/deps/data."""
    if not asar_path.is_file():
        raise FileNotFoundError(f"Sauce asar not found: {asar_path}")

    app_dir = dest / "app"
    if app_dir.exists():
        shutil.rmtree(app_dir)

    cmd = ["npx", "--yes", "asar", "extract", str(asar_path), str(app_dir)]
    print(f"Extracting {asar_path} ...")
    # shell=True on Windows so npx.cmd resolves.
    completed = subprocess.run(
        cmd,
        check=False,
        capture_output=True,
        text=True,
        shell=(os.name == "nt"),
    )
    if completed.returncode != 0:
        raise RuntimeError(
            "asar extract failed:\n"
            f"stdout: {completed.stdout}\nstderr: {completed.stderr}"
        )

    data_dir = app_dir / "shared" / "deps" / "data"
    if not data_dir.is_dir():
        raise FileNotFoundError(f"Sauce data dir missing after extract: {data_dir}")
    return data_dir


def sync(sauce_data: Path, dest_data: Path) -> None:
    if not sauce_data.is_dir():
        raise FileNotFoundError(f"Sauce data dir not found: {sauce_data}")

    old_routes = _load_json(dest_data / "routes.json") if (dest_data / "routes.json").exists() else []
    new_routes = _load_json(sauce_data / "routes.json")
    old_ids = {r["id"] for r in old_routes}
    new_ids = {r["id"] for r in new_routes}

    for name in COPY_ROOT_FILES:
        src = sauce_data / name
        if not src.exists():
            print(f"WARNING: missing Sauce file {name}, skipping")
            continue
        shutil.copy2(src, dest_data / name)
        print(f"Copied {name}")

    for name in PRESERVE_ROOT_FILES:
        if (dest_data / name).exists():
            print(f"Preserved {name}")
        else:
            print(f"WARNING: local {name} missing (not provided by Sauce)")

    worlds_src = sauce_data / "worlds"
    worlds_dst = dest_data / "worlds"
    segment_summaries: list[str] = []
    road_summaries: list[str] = []

    for world_dir in sorted(worlds_src.iterdir(), key=lambda p: int(p.name) if p.name.isdigit() else p.name):
        if not world_dir.is_dir():
            continue
        wid = world_dir.name
        dst_world = worlds_dst / wid
        dst_world.mkdir(parents=True, exist_ok=True)

        roads_src = world_dir / "roads.json"
        if roads_src.exists():
            old_roads = (
                _load_json(dst_world / "roads.json")
                if (dst_world / "roads.json").exists()
                else []
            )
            new_roads = _load_json(roads_src)
            shutil.copy2(roads_src, dst_world / "roads.json")
            if len(new_roads) != len(old_roads):
                road_summaries.append(f"world {wid}: roads {len(old_roads)}->{len(new_roads)}")

        # Never overwrite roadIntersections.json
        if (dst_world / "roadIntersections.json").exists():
            pass
        else:
            print(f"WARNING: world {wid} missing local roadIntersections.json")

        segs_src = world_dir / "segments.json"
        if segs_src.exists():
            sauce_segs = _load_json(segs_src)
            local_segs = (
                _load_json(dst_world / "segments.json")
                if (dst_world / "segments.json").exists()
                else []
            )
            transformed = transform_segments(sauce_segs, local_segs)
            _dump_json(dst_world / "segments.json", transformed)
            segment_summaries.append(
                f"world {wid}: sauce_rows={len(sauce_segs)} "
                f"local_dual {len(local_segs)}->{len(transformed)}"
            )

    print("\n=== Summary ===")
    print(f"routes: {len(old_routes)} -> {len(new_routes)}")
    print(f"  added: {len(new_ids - old_ids)}")
    print(f"  removed: {len(old_ids - new_ids)}")
    for r in sorted(
        (x for x in new_routes if x["id"] in (new_ids - old_ids)),
        key=lambda x: (x.get("worldId") or 0, x.get("name") or ""),
    ):
        print(f"  + {r['id']}: w{r.get('worldId')} {r.get('name')}")
    for r in sorted(
        (x for x in old_routes if x["id"] in (old_ids - new_ids)),
        key=lambda x: (x.get("worldId") or 0, x.get("name") or ""),
    ):
        print(f"  - {r['id']}: w{r.get('worldId')} {r.get('name')}")
    if road_summaries:
        print("roads:")
        for line in road_summaries:
            print(f"  {line}")
    print("segments:")
    for line in segment_summaries:
        print(f"  {line}")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--sauce-data-dir",
        type=Path,
        help="Path to Sauce shared/deps/data (skip asar extract if set)",
    )
    parser.add_argument(
        "--asar",
        type=Path,
        default=DEFAULT_ASAR,
        help=f"Path to Sauce app.asar (default: {DEFAULT_ASAR})",
    )
    parser.add_argument(
        "--dest",
        type=Path,
        default=DATA_DIR,
        help=f"Destination backend/data (default: {DATA_DIR})",
    )
    args = parser.parse_args(argv)

    if args.sauce_data_dir:
        sauce_data = args.sauce_data_dir
        sync(sauce_data, args.dest)
        return 0

    with tempfile.TemporaryDirectory(prefix="sauce4zwift-data-") as tmp:
        sauce_data = extract_sauce_data(args.asar, Path(tmp))
        sync(sauce_data, args.dest)
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001 — CLI surface
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
