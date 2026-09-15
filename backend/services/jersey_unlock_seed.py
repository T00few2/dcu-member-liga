"""Known jersey unlocks from public web lists, matched to the live catalog.

Level numbers follow ZwiftInsider's current XP table:
https://zwiftinsider.com/points-levels-unlocks/
Promo codes follow the Zwift Wiki cycling jerseys table:
https://zwift.fandom.com/wiki/Cycling_Jerseys

Seeded codes are stored as unverified. Many published codes are dead.
"""
from __future__ import annotations

from typing import Any, Iterable, Mapping

from services.club_kits import _int_or_none, _str_or_none, normalize_code_status, unlocks_by_signature

# Catalog `name` -> drop level. Insider levels win over older wiki pack levels
# (e.g. Camo is 9 on Insider, 3 on the wiki).
LEVEL_BY_NAME: dict[str, int] = {
    "Zwift Standard Orange": 1,
    "Basic 1": 2,
    "Basic 2": 2,
    "Basic 3": 2,
    "Vintage 1": 8,
    "Vintage 2": 8,
    "Vintage 3": 8,
    "Camo 1": 9,
    "Camo 2": 9,
    "Camo 3": 9,
    "DigiCamo 1": 11,
    "DigiCamo 2": 11,
    "DigiCamo 3": 11,
    "Basic 4": 12,
    "Basic 5": 12,
    "Level 15": 15,
    "Classy 1": 18,
    "Classy 2": 18,
    "Classy 3": 18,
    "Level 20": 20,
    "Fluoro 1": 21,
    "Fluoro 2": 21,
    "Fluoro 3": 21,
    "Level 25": 25,
    "Level 30": 30,
    "Monochrome 1": 34,
    "Monochrome 2": 34,
    "Monochrome 3": 34,
    "Level 40": 40,
    "La Z Claire": 42,
    "Alpine Slopes 1": 44,
    "Alpine Slopes 2": 44,
    "Alpine Slopes 3": 44,
    "Prism 1": 46,
    "Prism 2": 46,
    "Prism 3": 46,
    "Level 50": 50,
    "Avocado": 51,
    "Donut": 51,
    "Espresso": 51,
    "1980s": 52,
    "Cheetah Print": 56,
    "Cow Print": 56,
    "Tiger Print": 56,
    "Level 60": 60,
    "London Tube": 63,
    "Bike Packer": 66,
    "Alpe du Knit Cozy": 68,
    "Alpe du Knit Evergreen": 68,
    "Alpe du Knit Ice": 68,
    "Level 70": 70,
    "Makuri Blossoms": 72,
    "Outfield": 74,
    "Dino Power": 76,
    "Island Flowers": 78,
    "Island Palms": 78,
    "Island Pineapples": 78,
    "Level 80": 80,
    "Wolf Power": 82,
    "Solid Clay": 84,
    "Solid Mustard": 84,
    "Solid Olive": 84,
    "Gravel Party": 87,
    "Level 90": 90,
    "Modern": 91,
    "Out of This World": 93,
    "Mirage": 95,
    "Level 100": 100,
}

# Catalog `name` -> published P-code. Status is always seeded as unverified.
CODE_BY_NAME: dict[str, str] = {
    "Alienware": "GOALIENWARE",
    "ATOC 2015": "ATOC2015",
    "Amgen Tour of California 2015": "ATOC2015",
    "ATOC 2017": "GOAMGENTOC",
    "Battenkill": "GOBATTENKILL",
    "Bicycling": "BICYCLINGMAG",
    "Bicycling 2017": "BICYCLINGMAG",
    "Bike and Beer": "BIKEANDBEER",
    "Bike Radar": "BIKERADAR",
    "CRCA": "CRCANYC",
    "CIS Training Systems": "GOCIS",
    "Cycleops": "GOCYCLEOPS",
    "Cycling Tips": "CTKIT",
    "Elite": "GOELITE",
    "Freespeed": "GOFREESPEED",
    "Gear Patrol": "GEARPATROL",
    "Geelong CC": "GEELONGCCKIT",
    "GCN": "GOGCN",
    "Lava": "LAVA",
    "Pearson CC": "GOPEARSON",
    "Radavist": "RADAVIST",
    "Rye": "GOSKRYE",
    "Soigneur": "SOIGNEURDK",
    "Tacx": "GOTACX",
    "Deloitte Digital": "D.CYCLE4GOOD",
    "Tour de Pier": "TDP2015",
    "Triathlete": "TRIATHLETEMAG",
    "TS Bikes": "TSBIKES",
    "USMES": "GOUSMES",
    "Wahoo": "WAHOOFITNESS",
    "World Bicycle Relief": "GOWBR",
    "World Social Riders": "GOWBR",
    "Zwift Thailand": "ZTHKIT",
}


def _norm(name: str) -> str:
    return " ".join((name or "").strip().lower().split())


def match_known_unlocks(catalog: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    """Map live catalog jerseys onto the known level/code tables."""
    level_lookup = {_norm(name): level for name, level in LEVEL_BY_NAME.items()}
    code_lookup = {_norm(name): code for name, code in CODE_BY_NAME.items()}
    rows: list[dict[str, Any]] = []
    seen: set[int] = set()
    for item in catalog:
        try:
            signature = int(item.get("signature") or item.get("jerseySignature"))
        except (TypeError, ValueError):
            continue
        if signature in seen:
            continue
        name = _str_or_none(item.get("name") or item.get("jerseyName")) or ""
        key = _norm(name)
        min_level = level_lookup.get(key)
        unlock_code = code_lookup.get(key)
        if min_level is None and unlock_code is None:
            continue
        seen.add(signature)
        row: dict[str, Any] = {
            "jerseySignature": signature,
            "jerseyName": name,
            "imageName": _str_or_none(item.get("imageName")) or "",
            "imageUrl": _str_or_none(item.get("imageUrl")),
            "minLevel": min_level,
            "unlockCode": unlock_code,
        }
        if unlock_code:
            row["codeStatus"] = "unverified"
        rows.append(row)
    rows.sort(key=lambda row: ((row.get("minLevel") or 999), (row.get("jerseyName") or "").lower()))
    return rows


def merge_unlocks(
    existing: Iterable[Mapping[str, Any]],
    seeded: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    """Keep admin edits; fill missing minLevel/code from the seed."""
    merged = unlocks_by_signature(existing)
    added = 0
    updated = 0
    for seed in seeded:
        signature = _int_or_none(seed.get("jerseySignature"))
        if signature is None:
            continue
        current = merged.get(signature)
        if current is None:
            merged[signature] = dict(seed)
            added += 1
            continue
        changed = False
        if current.get("minLevel") is None and seed.get("minLevel") is not None:
            current["minLevel"] = seed["minLevel"]
            changed = True
        if not _str_or_none(current.get("unlockCode")) and _str_or_none(seed.get("unlockCode")):
            current["unlockCode"] = seed["unlockCode"]
            if not normalize_code_status(current):
                current["codeStatus"] = "unverified"
            changed = True
        if not _str_or_none(current.get("imageName")) and seed.get("imageName"):
            current["imageName"] = seed["imageName"]
            changed = True
        if not _str_or_none(current.get("imageUrl")) and seed.get("imageUrl"):
            current["imageUrl"] = seed["imageUrl"]
            changed = True
        if changed:
            updated += 1
            merged[signature] = current
    rows = list(merged.values())
    rows.sort(key=lambda row: ((row.get("minLevel") or 999), (row.get("jerseyName") or "").lower()))
    return rows
