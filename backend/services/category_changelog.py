"""Editor changelog for liga category config (merge / rename / split).

Do not infer remaps by diffing old vs new lists. The admin editor records
operations; this module applies them, reduces a name map, and checks that
the ops produce the submitted category list.
"""
from __future__ import annotations

import copy
import hashlib
import json
from typing import Any

from services.category_engine import ZR_CATEGORY_DEFS


class CategoryChangelogError(ValueError):
    """Invalid changelog or submitted category list."""


def _norm_def(entry: dict) -> dict:
    name = str(entry.get("name") or "").strip()
    upper = entry.get("upper")
    if upper is not None:
        upper = int(upper)
    return {
        "name": name,
        "upper": upper,
        "requiresVerification": bool(entry.get("requiresVerification")),
    }


def normalize_defs(defs: list[dict] | None) -> list[dict]:
    if not defs:
        return []
    return [_norm_def(d) for d in defs if isinstance(d, dict)]


def names_of(defs: list[dict]) -> list[str]:
    return [d["name"] for d in defs]


def unique_names_or_error(defs: list[dict]) -> None:
    seen: set[str] = set()
    for name in names_of(defs):
        if not name:
            raise CategoryChangelogError("Each category must have a non-empty name")
        key = name.casefold()
        if key in seen:
            raise CategoryChangelogError(f"Duplicate category name: {name}")
        seen.add(key)


def liga_categories_fingerprint(defs: list[dict] | None) -> str:
    payload = normalize_defs(defs)
    blob = json.dumps(payload, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()


def _index_by_name(defs: list[dict], name: str) -> int:
    want = str(name or "").strip()
    for i, d in enumerate(defs):
        if d["name"] == want:
            return i
    raise CategoryChangelogError(f"Category not found: {want}")


def apply_ops_to_defs(old_defs: list[dict], ops: list[dict]) -> list[dict]:
    """Replay changelog ops onto a copy of the saved list."""
    defs = copy.deepcopy(normalize_defs(old_defs))
    for raw in ops or []:
        if not isinstance(raw, dict):
            raise CategoryChangelogError("Each changelog op must be an object")
        op = str(raw.get("op") or "").strip()
        if op == "mergeUp":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("into") or "").strip()
            if not src or not dest:
                raise CategoryChangelogError("mergeUp requires from and into")
            if src == dest:
                raise CategoryChangelogError("mergeUp from and into must differ")
            i_from = _index_by_name(defs, src)
            i_into = _index_by_name(defs, dest)
            if i_from == 0:
                raise CategoryChangelogError("Cannot merge the top category upward")
            if i_into != i_from - 1:
                raise CategoryChangelogError(
                    f"mergeUp {src} must merge into the category immediately above it ({defs[i_from - 1]['name']})"
                )
            removed = defs.pop(i_from)
            if removed.get("requiresVerification"):
                defs[i_into]["requiresVerification"] = True
        elif op == "rename":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("to") or "").strip()
            if not src or not dest:
                raise CategoryChangelogError("rename requires from and to")
            if src == dest:
                continue
            i = _index_by_name(defs, src)
            if any(d["name"] == dest for j, d in enumerate(defs) if j != i):
                raise CategoryChangelogError(f"rename target already exists: {dest}")
            defs[i]["name"] = dest
        elif op == "split":
            src = str(raw.get("from") or "").strip()
            into = raw.get("into") or []
            if not src or not isinstance(into, list) or len(into) != 2:
                raise CategoryChangelogError("split requires from and into: [A, B]")
            name_a = str(into[0] or "").strip()
            name_b = str(into[1] or "").strip()
            if not name_a or not name_b or name_a == name_b:
                raise CategoryChangelogError("split into names must be two different non-empty names")
            mid = raw.get("mid")
            if mid is None or not isinstance(mid, (int, float)):
                raise CategoryChangelogError("split requires numeric mid")
            mid_i = int(mid)
            i = _index_by_name(defs, src)
            cat = defs[i]
            lower = defs[i + 1]["upper"] if i + 1 < len(defs) else 0
            lower_i = int(lower) if lower is not None else 0
            upper = cat.get("upper")
            if upper is not None and mid_i >= int(upper):
                raise CategoryChangelogError("split mid must be below the category upper bound")
            if mid_i <= lower_i:
                raise CategoryChangelogError("split mid must be above the category lower bound")
            existing = {d["name"] for j, d in enumerate(defs) if j != i}
            if name_a in existing or name_b in existing:
                raise CategoryChangelogError("split names collide with an existing category")
            defs[i] = {
                "name": name_a,
                "upper": cat.get("upper"),
                "requiresVerification": bool(cat.get("requiresVerification")),
            }
            defs.insert(
                i + 1,
                {
                    "name": name_b,
                    "upper": mid_i,
                    "requiresVerification": False,
                },
            )
        else:
            raise CategoryChangelogError(f"Unknown changelog op: {op or '(empty)'}")
        unique_names_or_error(defs)
    return defs


def reduce_ops_to_remap(ops: list[dict]) -> dict[str, str]:
    """Map original (and intermediate) names to the current name after merge/rename.

    Split is not represented here — use split_ops().
    """
    remap: dict[str, str] = {}

    def _rewrite(old: str, new: str) -> None:
        remap[old] = new
        for k, v in list(remap.items()):
            if v == old:
                remap[k] = new

    for raw in ops or []:
        if not isinstance(raw, dict):
            continue
        op = str(raw.get("op") or "").strip()
        if op == "mergeUp":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("into") or "").strip()
            _rewrite(src, dest)
        elif op == "rename":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("to") or "").strip()
            if src and dest and src != dest:
                _rewrite(src, dest)
    return {k: v for k, v in remap.items() if k != v}


def split_ops(ops: list[dict]) -> list[dict]:
    out: list[dict] = []
    for raw in ops or []:
        if isinstance(raw, dict) and str(raw.get("op") or "").strip() == "split":
            out.append(
                {
                    "from": str(raw.get("from") or "").strip(),
                    "into": [str(x).strip() for x in (raw.get("into") or [])],
                    "mid": int(raw["mid"]),
                }
            )
    return out


def validate_changelog(
    old_defs: list[dict] | None,
    ops: list[dict] | None,
    submitted_defs: list[dict],
) -> dict[str, Any]:
    """Return remap, splits, and produced defs, or raise CategoryChangelogError.

    Ops determine the name sequence. Bounds and verification flags come from
    the submitted editor list. Empty ops with the same names is a bounds-only save.
    """
    old = normalize_defs(old_defs)
    if not old:
        old = normalize_defs(ZR_CATEGORY_DEFS)
    submitted = normalize_defs(submitted_defs)
    unique_names_or_error(submitted)
    if len(submitted) < 2:
        raise CategoryChangelogError("At least 2 categories are required")
    ops_list = list(ops or [])

    produced = apply_ops_to_defs(old, ops_list)
    if names_of(produced) != names_of(submitted):
        raise CategoryChangelogError(
            "Changelog does not produce the submitted category list"
        )
    return {
        "remap": reduce_ops_to_remap(ops_list),
        "splits": split_ops(ops_list),
        "produced": submitted,
    }


def resolve_name(name: str | None, remap: dict[str, str]) -> str | None:
    if name is None:
        return None
    raw = str(name).strip()
    if not raw:
        return None
    return remap.get(raw, raw)


def resolve_name_through_ops(
    name: str | None,
    rating: int | float | None,
    ops: list[dict] | None,
) -> str | None:
    """Walk merge/rename/split ops in order to map a stored category name."""
    current = str(name or "").strip()
    if not current:
        return None
    for raw in ops or []:
        if not isinstance(raw, dict):
            continue
        op = str(raw.get("op") or "").strip()
        if op == "mergeUp":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("into") or "").strip()
            if current == src and dest:
                current = dest
        elif op == "rename":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("to") or "").strip()
            if current == src and dest:
                current = dest
        elif op == "split":
            src = str(raw.get("from") or "").strip()
            into = [str(x).strip() for x in (raw.get("into") or [])]
            if current == src and len(into) == 2:
                mid = int(raw["mid"])
                if rating is None:
                    current = into[0]
                else:
                    current = into[0] if int(rating) >= mid else into[1]
    return current


def resolve_split_name(
    name: str | None,
    rating: int | float | None,
    splits: list[dict],
) -> str | None:
    """Place a pre-split name into A (harder, rating >= mid) or B (easier)."""
    raw = str(name or "").strip()
    if not raw:
        return None
    current = raw
    for spec in splits:
        src = spec.get("from") or ""
        into = spec.get("into") or []
        if current != src or len(into) != 2:
            continue
        mid = int(spec["mid"])
        if rating is None:
            current = into[0]
        else:
            current = into[0] if int(rating) >= mid else into[1]
    return current
