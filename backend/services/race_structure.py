"""Overlay season defaultRaceGroups onto existing grouped races."""
from __future__ import annotations

import copy
from typing import Any


def _norm_name(value: Any) -> str:
    return " ".join(str(value or "").strip().lower().split())


def race_has_results(race: dict | None) -> bool:
    results = (race or {}).get("results")
    if not isinstance(results, dict) or not results:
        return False
    return any(bool(v) for v in results.values())


def template_category_coverage(template: list | None, liga_names: list[str]) -> dict[str, Any]:
    """Every liga name should appear in exactly one template group."""
    counts: dict[str, int] = {n: 0 for n in liga_names}
    extras: list[str] = []
    for group in template or []:
        if not isinstance(group, dict):
            continue
        for row in group.get("categories") or []:
            if not isinstance(row, dict):
                continue
            name = str(row.get("category") or "").strip()
            if not name:
                continue
            matched = None
            for liga in liga_names:
                if liga.casefold() == name.casefold():
                    matched = liga
                    break
            if matched:
                counts[matched] = counts.get(matched, 0) + 1
            else:
                extras.append(name)
    missing = [n for n, c in counts.items() if c == 0]
    duplicated = [n for n, c in counts.items() if c > 1]
    return {
        "missing": missing,
        "duplicated": duplicated,
        "unknown": extras,
        "ok": not missing and not duplicated,
    }


def _has_sprints(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def overlay_race_groups(template: list | None, race_groups: list | None) -> dict[str, Any]:
    """Match template groups by normalized name, then leftover id.

    Keep eventId/secret/laps. Category sprints follow the category name across
    groups. Group-level sprints stay on a name/id match; if that list is empty,
    copy from a dropped/unmatched group that previously owned one of the
    group's categories. Unmatched race groups are dropped (caller must warn if
    that would drop an eventId).
    """
    race = [copy.deepcopy(g) for g in (race_groups or []) if isinstance(g, dict)]
    used: set[int] = set()
    next_groups: list[dict] = []
    diff: dict[str, Any] = {
        "matched": [],
        "appended": [],
        "dropped": [],
        "droppedEventIds": [],
        "categoryChanges": [],
        "warnings": [],
        "droppedGroupsWithSprints": [],
    }

    cat_by_norm: dict[str, dict] = {}
    group_sprints_by_cat: dict[str, list] = {}
    for rg in race:
        group_sprints = rg.get("sprints") if isinstance(rg.get("sprints"), list) else []
        for cat in rg.get("categories") or []:
            if not isinstance(cat, dict):
                continue
            key = _norm_name(cat.get("category"))
            if not key:
                continue
            if key not in cat_by_norm:
                cat_by_norm[key] = cat
            if _has_sprints(group_sprints) and key not in group_sprints_by_cat:
                group_sprints_by_cat[key] = group_sprints

    def _find_match(tg: dict) -> int | None:
        tname = _norm_name(tg.get("name"))
        tid = str(tg.get("id") or "").strip()
        if tname:
            for i, rg in enumerate(race):
                if i in used:
                    continue
                if _norm_name(rg.get("name")) == tname:
                    return i
        if tid:
            for i, rg in enumerate(race):
                if i in used:
                    continue
                if str(rg.get("id") or "").strip() == tid:
                    return i
        return None

    def _cats_for_template(t_cats: list[dict], group_label: Any) -> list[dict]:
        new_cats: list[dict] = []
        for tcat in t_cats:
            name = str(tcat.get("category") or "").strip()
            if not name:
                continue
            old = cat_by_norm.get(_norm_name(name))
            if old:
                kept = copy.deepcopy(old)
                kept["category"] = name
                new_cats.append(kept)
            else:
                new_cats.append({"category": name, "sprints": []})
                diff["categoryChanges"].append({"group": group_label, "added": name})
        return new_cats

    def _fill_group_sprints(group: dict, t_names: list[str]) -> None:
        if _has_sprints(group.get("sprints")):
            return
        for name in t_names:
            src = group_sprints_by_cat.get(_norm_name(name))
            if _has_sprints(src):
                group["sprints"] = copy.deepcopy(src)
                return

    for tg in template or []:
        if not isinstance(tg, dict):
            continue
        t_cats = [c for c in (tg.get("categories") or []) if isinstance(c, dict)]
        t_names = [str(c.get("category") or "").strip() for c in t_cats if str(c.get("category") or "").strip()]
        idx = _find_match(tg)
        if idx is None:
            new_g = {
                "id": str(tg.get("id") or ""),
                "name": str(tg.get("name") or ""),
                "eventId": "",
                "eventSecret": "",
                "laps": tg.get("laps"),
                "sprints": [],
                "segmentType": "sprint",
                "categories": _cats_for_template(t_cats, tg.get("name")),
            }
            _fill_group_sprints(new_g, t_names)
            next_groups.append(new_g)
            diff["appended"].append(new_g.get("name"))
            continue

        used.add(idx)
        rg = race[idx]
        next_g = copy.deepcopy(rg)
        if tg.get("name"):
            next_g["name"] = tg.get("name")
        next_g["categories"] = _cats_for_template(t_cats, rg.get("name"))
        _fill_group_sprints(next_g, t_names)
        next_groups.append(next_g)
        diff["matched"].append(next_g.get("name"))

    for i, rg in enumerate(race):
        if i in used:
            continue
        diff["dropped"].append(rg.get("name"))
        event_id = str(rg.get("eventId") or "").strip()
        if event_id:
            diff["droppedEventIds"].append({"group": rg.get("name"), "eventId": event_id})
            diff["warnings"].append(
                f"Group {rg.get('name')!r} has no template match and would drop eventId {event_id}"
            )
        if _has_sprints(rg.get("sprints")) or any(
            _has_sprints(c.get("sprints"))
            for c in (rg.get("categories") or [])
            if isinstance(c, dict)
        ):
            diff["droppedGroupsWithSprints"].append(rg.get("name"))
            diff["warnings"].append(
                f"Group {rg.get('name')!r} was dropped; category sprints are kept by name if the category still exists"
            )

    return {"next": next_groups, "diff": diff}
