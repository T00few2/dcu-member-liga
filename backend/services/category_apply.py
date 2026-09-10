"""Apply liga-category changelog to rider docs and race name strings."""
from __future__ import annotations

import copy
from typing import Any

from services.category_changelog import (
    names_of,
    resolve_name_through_ops,
)
from services.category_engine import (
    assignment_floor_category,
    build_liga_category,
    build_manual_assigned,
    cats_from_defs,
    compute_category_status,
    get_category_by_name,
)


SAMPLE_LIMIT = 8


def _rank_index(name: str | None, cats) -> int | None:
    if not name:
        return None
    names = [n for n, _, _ in cats]
    try:
        return names.index(name)
    except ValueError:
        return None


def _is_same_or_harder(name: str, floor: str, cats) -> bool:
    ri = _rank_index(name, cats)
    fi = _rank_index(floor, cats)
    if ri is None or fi is None:
        return False
    return ri <= fi


def _hold_rating(hold: dict | None) -> int | None:
    data = hold if isinstance(hold, dict) else {}
    for key in ("assignedRating", "predictedVelo", "lastCheckedRating"):
        val = data.get(key)
        if val is not None and val != "N/A":
            try:
                return int(val)
            except (TypeError, ValueError):
                pass
    return None


def _refresh_bounds(name: str, rating: int | None, new_defs: list[dict], grace_period: int) -> dict | None:
    cats = cats_from_defs(new_defs)
    found = get_category_by_name(name, cats)
    if not found:
        return None
    _n, _lower, upper = found
    grace_limit = (upper + grace_period) if upper is not None else None
    status = (
        compute_category_status(rating, upper, grace_limit) if rating is not None else "ok"
    )
    return {
        "upperBoundary": upper,
        "graceLimit": grace_limit,
        "status": status,
    }


def _canonical_lc(lc: dict) -> dict:
    """Comparable snapshot of assignment names/bounds (ignore live timestamps)."""

    def _hold(h: dict | None) -> dict | None:
        if not h:
            return None
        keys = (
            "category",
            "upperBoundary",
            "graceLimit",
            "assignedRating",
            "assignedFrom",
            "predictedVelo",
            "status",
        )
        return {k: h.get(k) for k in keys}

    return {
        "locked": bool(lc.get("locked")),
        "category": lc.get("category"),
        "autoAssigned": _hold(lc.get("autoAssigned")),
        "manualAssigned": _hold(lc.get("manualAssigned")),
        "selfSelected": {"category": (lc.get("selfSelected") or {}).get("category")}
        if lc.get("selfSelected")
        else None,
    }


def remap_user_liga_category(
    lc: dict | None,
    *,
    ops: list[dict],
    new_defs: list[dict],
    grace_period: int,
    eff_rating: int | None,
) -> tuple[dict | None, dict[str, Any]]:
    """Return (next ligaCategory or None if unchanged, stats)."""
    if not lc:
        return None, {}

    cats = cats_from_defs(new_defs)
    valid = set(names_of(new_defs))
    next_lc = copy.deepcopy(lc)
    stats: dict[str, Any] = {
        "manualRewrite": False,
        "selfRewrite": False,
        "selfDrop": False,
        "autoBandChange": False,
        "autoNameOnly": False,
        "splitHoldMove": False,
        "lockedRemap": False,
    }
    samples: dict[str, Any] = {}

    auto = dict(next_lc.get("autoAssigned") or {})
    manual = dict(next_lc.get("manualAssigned") or {})
    sel = dict(next_lc.get("selfSelected") or {})
    locked = bool(next_lc.get("locked"))

    old_auto_name = str(auto.get("category") or "").strip() or None
    old_manual_name = str(manual.get("category") or "").strip() or None
    old_sel_name = str(sel.get("category") or "").strip() or None
    old_locked_name = str(next_lc.get("category") or "").strip() or None

    if auto:
        if not locked and eff_rating is not None:
            rebuilt = build_liga_category(eff_rating, grace_period, cats)
            rebuilt["assignedRating"] = auto.get("assignedRating", eff_rating)
            rebuilt["assignedAt"] = auto.get("assignedAt")
            if auto.get("lastCheckedRating") is not None:
                rebuilt["lastCheckedRating"] = auto.get("lastCheckedRating")
            if auto.get("lastCheckedAt") is not None:
                rebuilt["lastCheckedAt"] = auto.get("lastCheckedAt")
            if rebuilt.get("category") != old_auto_name:
                stats["autoBandChange"] = True
                samples["auto"] = {"from": old_auto_name, "to": rebuilt.get("category")}
            next_lc["autoAssigned"] = rebuilt
        elif old_auto_name:
            mapped = resolve_name_through_ops(old_auto_name, eff_rating, ops)
            if mapped and mapped in valid:
                bounds = _refresh_bounds(mapped, eff_rating, new_defs, grace_period) or {}
                auto["category"] = mapped
                auto.update(bounds)
                next_lc["autoAssigned"] = auto
                if mapped != old_auto_name:
                    stats["autoNameOnly"] = True
                    samples["auto"] = {"from": old_auto_name, "to": mapped}

    if manual and old_manual_name:
        split_rating = _hold_rating(manual) if _hold_rating(manual) is not None else eff_rating
        mapped = resolve_name_through_ops(old_manual_name, split_rating, ops)
        if mapped and mapped in valid:
            keep_from = manual.get("assignedFrom")
            keep_pred = manual.get("predictedVelo")
            keep_at = manual.get("assignedAt")
            keep_rating = manual.get("assignedRating")
            refreshed = build_manual_assigned(
                mapped,
                keep_rating if keep_rating is not None else split_rating,
                grace_period,
                cats,
                assigned_from=str(keep_from or "admin"),
            )
            if refreshed:
                if keep_from:
                    refreshed["assignedFrom"] = keep_from
                if keep_pred is not None:
                    refreshed["predictedVelo"] = keep_pred
                if keep_at is not None:
                    refreshed["assignedAt"] = keep_at
                next_lc["manualAssigned"] = refreshed
                if mapped != old_manual_name:
                    stats["manualRewrite"] = True
                    samples["manual"] = {"from": old_manual_name, "to": mapped}
                    if any(str(op.get("op")) == "split" for op in ops):
                        stats["splitHoldMove"] = True
        else:
            next_lc.pop("manualAssigned", None)
            if old_manual_name:
                stats["manualRewrite"] = True
                samples["manual"] = {"from": old_manual_name, "to": None}

    floor_lc = {
        "autoAssigned": next_lc.get("autoAssigned") or {},
        "manualAssigned": next_lc.get("manualAssigned") or {},
    }
    floor = assignment_floor_category(floor_lc)

    if sel and old_sel_name:
        mapped = resolve_name_through_ops(old_sel_name, eff_rating, ops)
        keep = bool(mapped and mapped in valid and floor and _is_same_or_harder(mapped, floor, cats))
        if keep:
            sel["category"] = mapped
            next_lc["selfSelected"] = sel
            if mapped != old_sel_name:
                stats["selfRewrite"] = True
                samples["self"] = {"from": old_sel_name, "to": mapped}
        else:
            next_lc.pop("selfSelected", None)
            stats["selfDrop"] = True
            samples["self"] = {"from": old_sel_name, "to": None}
    elif not sel:
        next_lc.pop("selfSelected", None)

    if locked:
        source = old_locked_name or old_auto_name or old_manual_name
        mapped = resolve_name_through_ops(source, eff_rating, ops) if source else None
        if mapped and mapped in valid:
            next_lc["category"] = mapped
            next_lc["locked"] = True
            if mapped != old_locked_name:
                stats["lockedRemap"] = True
                samples["locked"] = {"from": old_locked_name, "to": mapped}
        else:
            next_lc["locked"] = True
    else:
        if "category" in next_lc and not locked:
            # Unlocked riders should not keep a stale top-level name after remap.
            if old_locked_name:
                mapped = resolve_name_through_ops(old_locked_name, eff_rating, ops)
                if mapped and mapped in valid:
                    next_lc["category"] = mapped
                else:
                    next_lc.pop("category", None)

    if _canonical_lc(lc) == _canonical_lc(next_lc):
        return None, {}
    stats["sample"] = samples
    return next_lc, stats


def _dedupe_named_rows(rows: list[dict], name_key: str) -> list[dict]:
    seen: set[str] = set()
    out: list[dict] = []
    for row in rows:
        name = str(row.get(name_key) or "").strip()
        key = name.casefold()
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(row)
    return out


def apply_ops_to_named_rows(
    rows: list | None,
    ops: list[dict] | None,
    name_key: str,
) -> list[dict]:
    """Rewrite category name fields in place for a list of config rows."""
    current = [copy.deepcopy(r) for r in (rows or []) if isinstance(r, dict)]
    for raw in ops or []:
        if not isinstance(raw, dict):
            continue
        op = str(raw.get("op") or "").strip()
        if op == "mergeUp":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("into") or "").strip()
            for row in current:
                if str(row.get(name_key) or "").strip() == src:
                    row[name_key] = dest
            current = _dedupe_named_rows(current, name_key)
        elif op == "rename":
            src = str(raw.get("from") or "").strip()
            dest = str(raw.get("to") or "").strip()
            if not src or not dest or src == dest:
                continue
            for row in current:
                if str(row.get(name_key) or "").strip() == src:
                    row[name_key] = dest
        elif op == "split":
            src = str(raw.get("from") or "").strip()
            into = [str(x).strip() for x in (raw.get("into") or [])]
            if not src or len(into) != 2:
                continue
            name_a, name_b = into
            expanded: list[dict] = []
            for row in current:
                if str(row.get(name_key) or "").strip() == src:
                    row_a = copy.deepcopy(row)
                    row_a[name_key] = name_a
                    row_b = copy.deepcopy(row)
                    row_b[name_key] = name_b
                    row_b["sprints"] = []
                    expanded.extend([row_a, row_b])
                else:
                    expanded.append(row)
            current = expanded
    return current


def remap_race_groups(groups: list | None, ops: list[dict] | None) -> list[dict]:
    out: list[dict] = []
    for group in groups or []:
        if not isinstance(group, dict):
            continue
        nxt = copy.deepcopy(group)
        nxt["categories"] = apply_ops_to_named_rows(group.get("categories") or [], ops, "category")
        out.append(nxt)
    return out


def race_name_string_diff(
    *,
    label: str,
    before_groups: list | None,
    after_groups: list | None,
    name_key: str = "category",
) -> list[dict]:
    """Summarize per-group category name rewrites (membership / group ids unchanged)."""
    changes: list[dict] = []
    before = [g for g in (before_groups or []) if isinstance(g, dict)]
    after = [g for g in (after_groups or []) if isinstance(g, dict)]
    for i, grp in enumerate(before):
        after_grp = after[i] if i < len(after) else {}
        b_names = [
            str((c or {}).get(name_key) or "").strip()
            for c in (grp.get("categories") or [])
            if isinstance(c, dict)
        ]
        a_names = [
            str((c or {}).get(name_key) or "").strip()
            for c in (after_grp.get("categories") or [])
            if isinstance(c, dict)
        ]
        if b_names != a_names:
            changes.append(
                {
                    "where": label,
                    "group": grp.get("name") or grp.get("id"),
                    "from": b_names,
                    "to": a_names,
                }
            )
    return changes


def remap_simple_name_list(
    rows: list | None,
    ops: list[dict] | None,
    name_key: str,
) -> list[dict]:
    return apply_ops_to_named_rows(rows, ops, name_key)


def empty_user_counts() -> dict[str, int]:
    return {
        "manualRewrite": 0,
        "selfRewrite": 0,
        "selfDrop": 0,
        "autoBandChange": 0,
        "autoNameOnly": 0,
        "splitHoldMove": 0,
        "lockedRemap": 0,
        "usersUpdated": 0,
        "usersUnchanged": 0,
    }


def accumulate_user_stats(counts: dict[str, int], stats: dict[str, Any], changed: bool) -> None:
    if not changed:
        counts["usersUnchanged"] += 1
        return
    counts["usersUpdated"] += 1
    for key in (
        "manualRewrite",
        "selfRewrite",
        "selfDrop",
        "autoBandChange",
        "autoNameOnly",
        "splitHoldMove",
        "lockedRemap",
    ):
        if stats.get(key):
            counts[key] += 1


def rider_sample(name: str, zwift_id: str, stats: dict[str, Any]) -> dict:
    return {
        "name": name,
        "zwiftId": zwift_id,
        **(stats.get("sample") or {}),
    }
