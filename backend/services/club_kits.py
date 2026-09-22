"""Obtainable club kits, intersections, and greedy auto-assignment.

Level-auto kits count when effective drop level >= minLevel. Missing or sub-1
dropLevel is treated as 1 (starter kits every Zwift rider has). Promo-code kits
count only when codeStatus is "working".
"""
from __future__ import annotations

from collections import Counter
from typing import Any, Iterable, Mapping

CODE_WORKING = "working"
CODE_EXPIRED = "expired"
CODE_UNVERIFIED = "unverified"
VALID_CODE_STATUSES = {CODE_WORKING, CODE_EXPIRED, CODE_UNVERIFIED}

ASSIGN_PINNED = "pinned"
ASSIGN_AUTO = "auto"

SOURCE_LEVEL = "level"
SOURCE_CODE = "code"
SOURCE_BOTH = "both"
SOURCE_CLUB = "club"

# New Zwift accounts start at drop level 1 and already have starter jerseys.
MIN_ZWIFT_DROP_LEVEL = 1


def drop_level_from_achievement(raw: Any) -> int | None:
    """Map Zwift achievementLevel to drop level.

    Unofficial JSON uses hundredths (11202 → 112). Official racing-profile
    achievements use the drop level directly (42).
    """
    if raw is None or isinstance(raw, bool):
        return None
    try:
        n = int(raw)
    except (TypeError, ValueError):
        return None
    if n < 0:
        return None
    if n >= 1000:
        return n // 100
    return n


def _int_or_none(value: Any) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _str_or_none(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def normalize_code_status(unlock: Mapping[str, Any]) -> str | None:
    status = _str_or_none(unlock.get("codeStatus"))
    if status in VALID_CODE_STATUSES:
        return status
    if _str_or_none(unlock.get("unlockCode")):
        return CODE_UNVERIFIED
    return None


def has_working_code(unlock: Mapping[str, Any]) -> bool:
    return bool(_str_or_none(unlock.get("unlockCode"))) and normalize_code_status(unlock) == CODE_WORKING


def unlock_source(unlock: Mapping[str, Any], *, pinned_custom: bool = False) -> str:
    if pinned_custom:
        return SOURCE_CLUB
    has_level = _int_or_none(unlock.get("minLevel")) is not None
    has_code = bool(_str_or_none(unlock.get("unlockCode")))
    if has_level and has_code:
        return SOURCE_BOTH
    if has_level:
        return SOURCE_LEVEL
    if has_code:
        return SOURCE_CODE
    return SOURCE_CLUB


def in_auto_pool(unlock: Mapping[str, Any]) -> bool:
    """Pool kits need minLevel or a working code (or both)."""
    return _int_or_none(unlock.get("minLevel")) is not None or has_working_code(unlock)


def effective_drop_level(drop_level: int | None) -> int:
    """Unknown or sub-1 levels count as a new Zwift rider (starter kits)."""
    if drop_level is None or drop_level < MIN_ZWIFT_DROP_LEVEL:
        return MIN_ZWIFT_DROP_LEVEL
    return drop_level


PLATFORM_WINDOWS = "windows"
PLATFORM_MAC = "mac"
PLATFORM_IOS = "ios"
PLATFORM_ANDROID = "android"
PLATFORM_TVOS = "tvos"
PLATFORM_UNKNOWN = "unknown"
PC_MAC_PLATFORMS = {PLATFORM_WINDOWS, PLATFORM_MAC}


def parse_game_client_platform(user_agent: str | None) -> str:
    """Last Zwift launch OS from profile userAgent."""
    text = (user_agent or "").lower()
    if not text.strip():
        return PLATFORM_UNKNOWN
    if "tvos" in text or "apple tv" in text:
        return PLATFORM_TVOS
    if "iphone" in text or "ipad" in text or "ipod" in text:
        return PLATFORM_IOS
    if "android" in text:
        return PLATFORM_ANDROID
    if "macintosh" in text or "mac os" in text or "macos" in text:
        return PLATFORM_MAC
    if "windows" in text:
        return PLATFORM_WINDOWS
    return PLATFORM_UNKNOWN


def extract_game_client_fields(profile: Mapping[str, Any] | None) -> dict[str, Any]:
    if not isinstance(profile, Mapping):
        return {}
    ua = _str_or_none(profile.get("userAgent"))
    if not ua:
        return {}
    platform = parse_game_client_platform(ua)
    return {
        "gameClientUserAgent": ua,
        "gameClientPlatform": platform,
        "canEnterUnlockCode": platform in PC_MAC_PLATFORMS,
    }


def rider_can_enter_unlock_code(member: Mapping[str, Any] | None) -> bool:
    if not isinstance(member, Mapping):
        return False
    flag = member.get("canEnterUnlockCode")
    if flag is True:
        return True
    if flag is False:
        return False
    platform = (_str_or_none(member.get("gameClientPlatform")) or "").lower()
    return platform in PC_MAC_PLATFORMS


def obtainable_signatures(
    unlocks: Iterable[Mapping[str, Any]],
    drop_level: int | None,
    *,
    can_enter_code: bool = False,
) -> set[int]:
    """Jerseys this rider can obtain via auto-grant and/or a working P-code on PC/Mac."""
    level = effective_drop_level(drop_level)
    obtained: set[int] = set()
    for unlock in unlocks:
        signature = _int_or_none(unlock.get("jerseySignature"))
        if signature is None:
            continue
        min_level = _int_or_none(unlock.get("minLevel"))
        if min_level is not None and level >= min_level:
            obtained.add(signature)
        if can_enter_code and has_working_code(unlock):
            obtained.add(signature)
    return obtained


def unlocks_by_signature(unlocks: Iterable[Mapping[str, Any]]) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for unlock in unlocks:
        signature = _int_or_none(unlock.get("jerseySignature"))
        if signature is None:
            continue
        out[signature] = dict(unlock)
    return out


def club_kits_by_club(club_kits: Iterable[Mapping[str, Any]]) -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for row in club_kits:
        club = _str_or_none(row.get("club"))
        if not club:
            continue
        out[club] = dict(row)
    return out


def kit_for_club(club_kits: Iterable[Mapping[str, Any]], club_name: str) -> dict[str, Any] | None:
    rows = club_kits_by_club(club_kits)
    kit = rows.get(club_name)
    if kit:
        return kit
    wanted = club_name.casefold()
    for name, row in rows.items():
        if name.casefold() == wanted:
            return row
    return None


def riders_by_club(riders: Iterable[Mapping[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for rider in riders:
        club = _str_or_none(rider.get("club"))
        if not club:
            continue
        grouped.setdefault(club, []).append(dict(rider))
    return grouped


def club_obtainable_intersection(
    members: Iterable[Mapping[str, Any]],
    unlocks: Iterable[Mapping[str, Any]],
) -> set[int]:
    member_sets: list[set[int]] = []
    for member in members:
        drop_level = _int_or_none(member.get("dropLevel"))
        member_sets.append(obtainable_signatures(
            unlocks,
            drop_level,
            can_enter_code=rider_can_enter_unlock_code(member),
        ))
    if not member_sets:
        return set()
    return set.intersection(*member_sets)


def rider_can_obtain_kit(
    member: Mapping[str, Any],
    kit: Mapping[str, Any] | None,
    unlocks: Iterable[Mapping[str, Any]],
) -> bool:
    """True if this rider can get the club's assigned kit via level and/or working code."""
    if not kit:
        return False
    signature = _int_or_none(kit.get("jerseySignature"))
    if signature is None:
        return False
    drop = _int_or_none(member.get("dropLevel"))
    unlock_list = list(unlocks)
    can_enter = rider_can_enter_unlock_code(member)
    if signature in obtainable_signatures(unlock_list, drop, can_enter_code=can_enter):
        return True
    unlock = unlocks_by_signature(unlock_list).get(signature) or {}
    min_level = _int_or_none(unlock.get("minLevel"))
    if min_level is None:
        min_level = _int_or_none(kit.get("minLevel"))
    if min_level is not None and effective_drop_level(drop) >= min_level:
        return True
    return can_enter and (has_working_code(unlock) or has_working_code(kit))


def kit_is_level_or_code(kit: Mapping[str, Any] | None, unlocks: Iterable[Mapping[str, Any]]) -> bool:
    """Coverage only scores level-auto and working-code kits, not custom/club pins."""
    if not kit:
        return False
    if _int_or_none(kit.get("jerseySignature")) is None:
        return False
    if (_str_or_none(kit.get("source")) or "") == SOURCE_CLUB:
        return False
    unlock = unlocks_by_signature(unlocks).get(_int_or_none(kit.get("jerseySignature")) or -1) or {}
    min_level = _int_or_none(unlock.get("minLevel"))
    if min_level is None:
        min_level = _int_or_none(kit.get("minLevel"))
    return min_level is not None or has_working_code(unlock) or has_working_code(kit)


def rider_assigned_kit_coverage(
    riders: Iterable[Mapping[str, Any]],
    club_kits: Iterable[Mapping[str, Any]],
    unlocks: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Share of riders on level/code kits who can obtain that assigned jersey."""
    unlock_list = list(unlocks)
    kit_list = list(club_kits)
    eligible = 0
    can_obtain = 0
    skipped = 0
    for rider in riders:
        if not _str_or_none(rider.get("club")):
            continue
        kit = kit_for_club(kit_list, rider.get("club") or "")
        if not kit_is_level_or_code(kit, unlock_list):
            skipped += 1
            continue
        eligible += 1
        if rider_can_obtain_kit(rider, kit, unlock_list):
            can_obtain += 1
    return {
        "total": eligible,
        "assigned": eligible,
        "skipped": skipped,
        "canObtain": can_obtain,
        "percent": round(100.0 * can_obtain / eligible, 1) if eligible else 0.0,
    }


def _empty_kit_level_gap() -> dict[str, Any]:
    return {
        "kitMinLevel": None,
        "belowKitLevelCount": 0,
        "belowKitLevel": [],
        "atKitLevelCount": None,
    }


def riders_below_kit_level(
    members: Iterable[Mapping[str, Any]],
    kit: Mapping[str, Any] | None,
    unlocks: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Level coverage for a saved kit. Working codes still skip the 'below' warning list."""
    if not kit:
        return _empty_kit_level_gap()
    signature = _int_or_none(kit.get("jerseySignature"))
    unlock = unlocks_by_signature(unlocks).get(signature or -1) or {}
    min_level = _int_or_none(unlock.get("minLevel"))
    if min_level is None:
        min_level = _int_or_none(kit.get("minLevel"))
    if min_level is None:
        return _empty_kit_level_gap()
    below: list[dict[str, Any]] = []
    at_level = 0
    for member in members:
        drop = _int_or_none(member.get("dropLevel"))
        if effective_drop_level(drop) >= min_level:
            at_level += 1
            continue
        below.append({
            "name": _str_or_none(member.get("name")) or "",
            "dropLevel": drop,
        })
    below.sort(key=lambda row: (
        row["dropLevel"] is None,
        row["dropLevel"] if row["dropLevel"] is not None else 0,
        str(row["name"]).lower(),
    ))
    if has_working_code(unlock) or has_working_code(kit):
        return {
            "kitMinLevel": min_level,
            "belowKitLevelCount": 0,
            "belowKitLevel": [],
            "atKitLevelCount": at_level,
        }
    return {
        "kitMinLevel": min_level,
        "belowKitLevelCount": len(below),
        "belowKitLevel": below,
        "atKitLevelCount": at_level,
    }


def riders_blocked_from_code_kit(
    members: Iterable[Mapping[str, Any]],
    kit: Mapping[str, Any] | None,
    unlocks: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Riders who need a P-code for the saved kit but last launched off PC/Mac."""
    empty = {"cannotEnterCodeCount": 0, "cannotEnterCode": []}
    if not kit:
        return empty
    signature = _int_or_none(kit.get("jerseySignature"))
    unlock = unlocks_by_signature(unlocks).get(signature or -1) or {}
    if not (has_working_code(unlock) or has_working_code(kit)):
        return empty
    min_level = _int_or_none(unlock.get("minLevel"))
    if min_level is None:
        min_level = _int_or_none(kit.get("minLevel"))
    blocked: list[dict[str, Any]] = []
    for member in members:
        if rider_can_enter_unlock_code(member):
            continue
        drop = _int_or_none(member.get("dropLevel"))
        if min_level is not None and effective_drop_level(drop) >= min_level:
            continue
        blocked.append({
            "name": _str_or_none(member.get("name")) or "",
            "dropLevel": drop,
            "gameClientPlatform": _str_or_none(member.get("gameClientPlatform")) or PLATFORM_UNKNOWN,
        })
    blocked.sort(key=lambda row: str(row["name"]).lower())
    return {
        "cannotEnterCodeCount": len(blocked),
        "cannotEnterCode": blocked,
    }


def assert_kit_enterable_by_club(
    members: Iterable[Mapping[str, Any]],
    kit: Mapping[str, Any] | None,
    unlocks: Iterable[Mapping[str, Any]],
) -> None:
    """Reject assigning a P-code jersey when any rider cannot type the code."""
    blocked = riders_blocked_from_code_kit(members, kit, unlocks)
    count = int(blocked["cannotEnterCodeCount"] or 0)
    if count <= 0:
        return
    names = ", ".join(row["name"] or "?" for row in blocked["cannotEnterCode"][:8])
    extra = f" (+{count - 8})" if count > 8 else ""
    raise ValueError(
        f"Trøjen kræver P-kode, men {count} rytter(e) bruger ikke PC/Mac: {names}{extra}"
    )


def members_for_club(
    grouped: Mapping[str, list[dict[str, Any]]],
    club: str | None,
) -> list[dict[str, Any]]:
    club_name = _str_or_none(club) or ""
    if club_name in grouped:
        return grouped[club_name]
    wanted = club_name.casefold()
    for name, rows in grouped.items():
        if name.casefold() == wanted:
            return rows
    return []


def denormalize_kit_row(
    *,
    club: str,
    signature: int,
    assignment: str,
    unlock: Mapping[str, Any] | None = None,
    jersey: Mapping[str, Any] | None = None,
    notes: str | None = None,
    pinned_custom: bool = False,
) -> dict[str, Any]:
    unlock = unlock or {}
    jersey = jersey or {}
    image_url = _str_or_none(unlock.get("imageUrl")) or _str_or_none(jersey.get("imageUrl"))
    row: dict[str, Any] = {
        "club": club,
        "jerseySignature": signature,
        "jerseyName": (
            _str_or_none(unlock.get("jerseyName"))
            or _str_or_none(jersey.get("name"))
            or _str_or_none(jersey.get("jerseyName"))
            or ""
        ),
        "imageName": (
            _str_or_none(unlock.get("imageName"))
            or _str_or_none(jersey.get("imageName"))
            or ""
        ),
        "imageUrl": image_url,
        "assignment": assignment,
        "source": unlock_source(unlock, pinned_custom=pinned_custom or assignment == ASSIGN_PINNED and not in_auto_pool(unlock)),
        "minLevel": _int_or_none(unlock.get("minLevel")),
        "unlockCode": _str_or_none(unlock.get("unlockCode")),
        "codeStatus": normalize_code_status(unlock),
        "notes": _str_or_none(notes) if notes is not None else _str_or_none(unlock.get("notes")),
    }
    if assignment == ASSIGN_PINNED and pinned_custom:
        row["source"] = SOURCE_CLUB
    return row


def _empty_pool_reason(members: list[Mapping[str, Any]], unlocks: Iterable[Mapping[str, Any]]) -> str:
    unlock_list = list(unlocks)
    known = sum(1 for m in members if _int_or_none(m.get("dropLevel")) is not None)
    working_codes = sum(1 for u in unlock_list if has_working_code(u))
    pc_mac = sum(1 for m in members if rider_can_enter_unlock_code(m))
    if not any(in_auto_pool(u) for u in unlock_list):
        return "Unlock-index er tomt — indlæs kendte trøjer eller tilføj minLevel/working codes"
    if not members:
        return "Ingen registrerede ryttere i klubben"
    if known == 0 and working_codes == 0:
        return "Kun starttrøjer (level 1) i puljen — ingen fælles kit i unlock-index"
    if working_codes and pc_mac == 0:
        return "Working codes kræver PC/Mac, og ingen medlemmer har sidst logget ind derfra"
    if known == 0:
        return "Ukendt Zwift-level tælles som 1 — kun starttrøjer og working codes"
    if working_codes == 0:
        return "Lav eller spredt Zwift-level og ingen fungerende kode-trøjer"
    return "Ingen fælles trøje i intersection (lav/ukendt level og ingen fælles working codes)"


ASSIGN_MODE_SCRATCH = "scratch"
ASSIGN_MODE_NEW = "new"
ASSIGN_MODE_MINIMAL = "minimal"
ASSIGN_MODES = {ASSIGN_MODE_SCRATCH, ASSIGN_MODE_NEW, ASSIGN_MODE_MINIMAL}


def signature_obtain_counts(
    members: Iterable[Mapping[str, Any]],
    unlocks: Iterable[Mapping[str, Any]],
    *,
    banned: set[int] | None = None,
) -> dict[int, int]:
    """How many members can obtain each jersey, ignoring pinned signatures."""
    unlock_list = list(unlocks)
    banned_sigs = banned or set()
    counts: dict[int, int] = {}
    for member in members:
        drop_level = _int_or_none(member.get("dropLevel"))
        for signature in obtainable_signatures(
            unlock_list,
            drop_level,
            can_enter_code=rider_can_enter_unlock_code(member),
        ):
            if signature in banned_sigs:
                continue
            counts[signature] = counts.get(signature, 0) + 1
    return counts


def club_obtain_count(
    members: Iterable[Mapping[str, Any]],
    kit: Mapping[str, Any] | None,
    unlocks: Iterable[Mapping[str, Any]],
) -> int:
    if not kit:
        return 0
    unlock_list = list(unlocks)
    return sum(1 for member in members if rider_can_obtain_kit(member, kit, unlock_list))


def _resolve_assign_mode(mode: str | None, preserve_saved: bool) -> str:
    if mode in ASSIGN_MODES:
        return mode
    return ASSIGN_MODE_NEW if preserve_saved else ASSIGN_MODE_SCRATCH


def _working_code_signatures(unlocks: Iterable[Mapping[str, Any]]) -> set[int]:
    signatures: set[int] = set()
    for unlock in unlocks:
        signature = _int_or_none(unlock.get("jerseySignature"))
        if signature is not None and has_working_code(unlock):
            signatures.add(signature)
    return signatures


def _all_members_can_enter_code(members: Iterable[Mapping[str, Any]]) -> bool:
    rows = list(members)
    return bool(rows) and all(rider_can_enter_unlock_code(member) for member in rows)


def _pick_intersection(pool: set[int], usage: Counter[int]) -> int:
    unused = [sig for sig in pool if usage[sig] == 0]
    if unused:
        return min(unused)
    return min(pool, key=lambda sig: (usage[sig], sig))


def _pick_best_coverage(counts: dict[int, int], usage: Counter[int]) -> int:
    best = max(counts.values())
    candidates = [sig for sig, count in counts.items() if count == best]
    unused = [sig for sig in candidates if usage[sig] == 0]
    pool = unused or candidates
    return min(pool, key=lambda sig: (usage[sig], sig))


def _assign_code_jerseys_first(
    pending: list[tuple[str, set[int], list[dict[str, Any]]]],
    *,
    unlock_list: list[dict[str, Any]],
    unlock_map: Mapping[int, Mapping[str, Any]],
    jersey_map: Mapping[int, Mapping[str, Any]],
    usage: Counter[int],
    auto_rows: list[dict[str, Any]],
    club_summaries: list[dict[str, Any]],
    pinned_sigs: set[int],
) -> list[tuple[str, set[int], list[dict[str, Any]]]]:
    """Give each free P-code jersey to an all-PC/Mac club before level jerseys are used."""
    code_sigs = _working_code_signatures(unlock_list) - pinned_sigs
    if not code_sigs:
        return pending
    code_pending: list[tuple[str, set[int], list[dict[str, Any]], set[int]]] = []
    rest: list[tuple[str, set[int], list[dict[str, Any]]]] = []
    for club, pool, members in pending:
        code_pool = pool & code_sigs
        if code_pool and _all_members_can_enter_code(members):
            code_pending.append((club, code_pool, members, pool))
        else:
            rest.append((club, pool, members))
    code_pending.sort(key=lambda item: (len(item[1]), item[0].lower()))
    for club, code_pool, members, full_pool in code_pending:
        unused = [sig for sig in code_pool if usage[sig] == 0]
        if not unused:
            rest.append((club, full_pool, members))
            continue
        pick = min(unused)
        usage[pick] += 1
        kit_row = denormalize_kit_row(
            club=club,
            signature=pick,
            assignment=ASSIGN_AUTO,
            unlock=unlock_map.get(pick) or {},
            jersey=jersey_map.get(pick) or {},
        )
        auto_rows.append(kit_row)
        club_summaries.append(_club_summary(club, members, full_pool, kit_row, pinned=False))
    return rest


def _assignment_changes(
    before: Iterable[Mapping[str, Any]],
    after: Iterable[Mapping[str, Any]],
) -> list[dict[str, Any]]:
    before_map = club_kits_by_club(before)
    after_map = club_kits_by_club(after)
    changes: list[dict[str, Any]] = []
    clubs = sorted(set(before_map) | set(after_map), key=str.lower)
    for club in clubs:
        old = before_map.get(club)
        new = after_map.get(club)
        old_sig = _int_or_none(old.get("jerseySignature")) if old else None
        new_sig = _int_or_none(new.get("jerseySignature")) if new else None
        if old_sig == new_sig:
            continue
        changes.append({
            "club": club,
            "fromSignature": old_sig,
            "toSignature": new_sig,
            "fromName": _str_or_none(old.get("jerseyName")) if old else None,
            "toName": _str_or_none(new.get("jerseyName")) if new else None,
        })
    return changes


def _pinned_rows(
    existing: Mapping[str, Mapping[str, Any]],
) -> tuple[list[dict[str, Any]], set[str], set[int]]:
    pinned_rows: list[dict[str, Any]] = []
    pinned_clubs: set[str] = set()
    pinned_sigs: set[int] = set()
    for club, row in existing.items():
        if row.get("assignment") != ASSIGN_PINNED:
            continue
        signature = _int_or_none(row.get("jerseySignature"))
        if signature is None:
            continue
        pinned_clubs.add(club)
        pinned_sigs.add(signature)
        pinned_rows.append(dict(row))
    return pinned_rows, pinned_clubs, pinned_sigs


def saved_club_summaries(
    *,
    unlocks: Iterable[Mapping[str, Any]],
    club_kits: Iterable[Mapping[str, Any]],
    riders: Iterable[Mapping[str, Any]],
) -> dict[str, Any]:
    """Admin table rows for the kits that are already saved. Does not propose changes."""
    unlock_list = list(unlocks)
    existing = club_kits_by_club(club_kits)
    grouped = riders_by_club(riders)
    pinned_rows, pinned_clubs, pinned_sigs = _pinned_rows(existing)
    clubs = sorted(set(grouped) | set(existing))
    summaries: list[dict[str, Any]] = []
    empty_pools: list[dict[str, Any]] = []
    for club in clubs:
        members = grouped.get(club, [])
        pool = club_obtainable_intersection(members, unlock_list)
        kit = existing.get(club)
        pinned = club in pinned_clubs
        summaries.append(_club_summary(club, members, pool, kit, pinned=pinned))
        if kit:
            continue
        auto_pool = set(pool) - pinned_sigs
        if auto_pool:
            continue
        empty_pools.append({
            "club": club,
            "reason": (
                "Eneste fælles trøjer er allerede pinnede til andre klubber"
                if pool
                else _empty_pool_reason(members, unlock_list)
            ),
            "memberCount": len(members),
        })
    return {
        "clubs": summaries,
        "pinned": pinned_rows,
        "emptyPools": empty_pools,
        "proposedClubKits": [dict(row) for row in existing.values()],
    }


def preview_auto_assignment(
    *,
    unlocks: Iterable[Mapping[str, Any]],
    club_kits: Iterable[Mapping[str, Any]],
    riders: Iterable[Mapping[str, Any]],
    jerseys_by_sig: Mapping[int, Mapping[str, Any]] | None = None,
    preserve_saved: bool = True,
    mode: str | None = None,
) -> dict[str, Any]:
    """Propose club kits. Pins stay exclusive and are never moved.

    scratch: ignore saved auto kits and assign every club from scratch.
    Working P-code jerseys go first, and only to clubs where every rider is on PC/Mac.
    new: keep every saved kit and only fill clubs that have none.
    minimal: keep a saved kit unless another jersey covers more of that club's riders.
    """
    assign_mode = _resolve_assign_mode(mode, preserve_saved)
    unlock_list = [dict(u) for u in unlocks]
    unlock_map = unlocks_by_signature(unlock_list)
    jersey_map = {int(k): dict(v) for k, v in (jerseys_by_sig or {}).items()}
    existing = club_kits_by_club(club_kits)
    grouped = riders_by_club(riders)

    clubs = sorted(set(grouped) | set(existing))
    pinned_rows, pinned_clubs, pinned_sigs = _pinned_rows(existing)

    usage: Counter[int] = Counter(pinned_sigs)
    auto_rows: list[dict[str, Any]] = []
    empty_pools: list[dict[str, Any]] = []
    club_summaries: list[dict[str, Any]] = []
    saved_auto: dict[str, dict[str, Any]] = {}
    if assign_mode != ASSIGN_MODE_SCRATCH:
        for club, row in existing.items():
            if club in pinned_clubs:
                continue
            signature = _int_or_none(row.get("jerseySignature"))
            if signature is None or signature in pinned_sigs:
                continue
            members = grouped.get(club, [])
            if assign_mode == ASSIGN_MODE_MINIMAL:
                counts = signature_obtain_counts(members, unlock_list, banned=pinned_sigs)
                best = max(counts.values()) if counts else 0
                current = club_obtain_count(members, row, unlock_list)
                if current < best:
                    continue
            saved_auto[club] = dict(row)
            usage[signature] += 1
            auto_rows.append(dict(row))

    pending: list[tuple[str, set[int], list[dict[str, Any]]]] = []
    for club in clubs:
        members = grouped.get(club, [])
        pool = club_obtainable_intersection(members, unlock_list)
        if club in pinned_clubs:
            kit = existing[club]
            club_summaries.append(_club_summary(club, members, pool, kit, pinned=True))
            continue
        if club in saved_auto:
            club_summaries.append(_club_summary(club, members, pool, saved_auto[club], pinned=False))
            continue
        if assign_mode == ASSIGN_MODE_MINIMAL:
            counts = signature_obtain_counts(members, unlock_list, banned=pinned_sigs)
            candidate_pool = set(counts)
        else:
            candidate_pool = set(pool) - pinned_sigs
        if not candidate_pool:
            empty_pools.append({
                "club": club,
                "reason": (
                    "Eneste fælles trøjer er allerede pinnede til andre klubber"
                    if pool
                    else _empty_pool_reason(members, unlock_list)
                ),
                "memberCount": len(members),
            })
            club_summaries.append(_club_summary(club, members, candidate_pool, None, pinned=False))
            continue
        pending.append((club, candidate_pool, members))

    if assign_mode == ASSIGN_MODE_SCRATCH:
        pending = _assign_code_jerseys_first(
            pending,
            unlock_list=unlock_list,
            unlock_map=unlock_map,
            jersey_map=jersey_map,
            usage=usage,
            auto_rows=auto_rows,
            club_summaries=club_summaries,
            pinned_sigs=pinned_sigs,
        )

    pending.sort(key=lambda item: (len(item[1]), item[0].lower()))
    for club, pool, members in pending:
        if assign_mode == ASSIGN_MODE_MINIMAL:
            counts = signature_obtain_counts(members, unlock_list, banned=pinned_sigs)
            if not counts:
                continue
            pick = _pick_best_coverage(counts, usage)
        else:
            pick = _pick_intersection(pool, usage)
        usage[pick] += 1
        unlock = unlock_map.get(pick) or {}
        jersey = jersey_map.get(pick) or {}
        kit_row = denormalize_kit_row(
            club=club,
            signature=pick,
            assignment=ASSIGN_AUTO,
            unlock=unlock,
            jersey=jersey,
        )
        auto_rows.append(kit_row)
        club_summaries.append(_club_summary(club, members, pool, kit_row, pinned=False))

    assigned_clubs = {row["club"] for row in pinned_rows} | {row["club"] for row in auto_rows}
    total_clubs = len(clubs)
    shared = [sig for sig, count in usage.items() if count > 1]
    unique_auto = sum(1 for row in auto_rows if usage[int(row["jerseySignature"])] == 1)
    proposed = pinned_rows + auto_rows
    flat_riders = [member for members in grouped.values() for member in members]

    return {
        "mode": assign_mode,
        "clubs": sorted(club_summaries, key=lambda c: c["club"].lower()),
        "pinned": pinned_rows,
        "auto": auto_rows,
        "emptyPools": empty_pools,
        "changes": _assignment_changes(existing.values(), proposed),
        "riderCoverage": rider_assigned_kit_coverage(flat_riders, proposed, unlock_list),
        "coverage": {
            "assignedClubs": len(assigned_clubs),
            "totalClubs": total_clubs,
            "percent": round(100.0 * len(assigned_clubs) / total_clubs, 1) if total_clubs else 0.0,
            "pinnedCount": len(pinned_rows),
            "autoCount": len(auto_rows),
            "emptyCount": len(empty_pools),
            "uniqueAuto": unique_auto,
            "sharedJerseyCount": len(shared),
        },
        "proposedClubKits": proposed,
    }


def apply_auto_assignment(
    *,
    unlocks: Iterable[Mapping[str, Any]],
    club_kits: Iterable[Mapping[str, Any]],
    riders: Iterable[Mapping[str, Any]],
    jerseys_by_sig: Mapping[int, Mapping[str, Any]] | None = None,
    preserve_saved: bool = True,
    mode: str | None = None,
) -> list[dict[str, Any]]:
    preview = preview_auto_assignment(
        unlocks=unlocks,
        club_kits=club_kits,
        riders=riders,
        jerseys_by_sig=jerseys_by_sig,
        preserve_saved=preserve_saved,
        mode=mode,
    )
    return list(preview["proposedClubKits"])


def commit_club_kit_proposal(
    *,
    proposed: Iterable[Mapping[str, Any]],
    existing: Iterable[Mapping[str, Any]],
    unlocks: Iterable[Mapping[str, Any]],
    jerseys_by_sig: Mapping[int, Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Replace saved auto kits with a reviewed proposal. Pins cannot move."""
    existing_map = club_kits_by_club(existing)
    proposed_map = club_kits_by_club(proposed)
    existing_pins = {
        club: row for club, row in existing_map.items() if row.get("assignment") == ASSIGN_PINNED
    }
    proposed_pins = {
        club: row for club, row in proposed_map.items() if row.get("assignment") == ASSIGN_PINNED
    }
    if set(existing_pins) != set(proposed_pins):
        raise ValueError("Pinned klubber kan ikke ændres her")
    for club, row in existing_pins.items():
        proposed_sig = _int_or_none(proposed_pins[club].get("jerseySignature"))
        if proposed_sig != _int_or_none(row.get("jerseySignature")):
            raise ValueError(f"Pin for {club} kan ikke ændres her")

    pinned_sigs = {
        sig for row in existing_pins.values()
        if (sig := _int_or_none(row.get("jerseySignature"))) is not None
    }
    unlock_map = unlocks_by_signature(unlocks)
    jersey_map = {int(k): dict(v) for k, v in (jerseys_by_sig or {}).items()}
    out: list[dict[str, Any]] = [dict(existing_pins[club]) for club in sorted(existing_pins, key=str.lower)]
    for club in sorted(proposed_map, key=str.lower):
        if club in existing_pins:
            continue
        row = proposed_map[club]
        if row.get("assignment") == ASSIGN_PINNED:
            raise ValueError("Nye pins skal sættes med Pin")
        signature = _int_or_none(row.get("jerseySignature"))
        if signature is None:
            raise ValueError(f"Mangler trøje for {club}")
        if signature in pinned_sigs:
            raise ValueError(f"Trøjen er pinnet og kan ikke auto-tildeles til {club}")
        unlock = dict(unlock_map.get(signature) or {})
        previous = existing_map.get(club)
        if not unlock and previous and _int_or_none(previous.get("jerseySignature")) == signature:
            kept = dict(previous)
            kept["assignment"] = ASSIGN_AUTO
            out.append(kept)
            continue
        if not unlock and signature not in jersey_map:
            raise ValueError(f"Ukendt trøje {signature} for {club}")
        out.append(denormalize_kit_row(
            club=club,
            signature=signature,
            assignment=ASSIGN_AUTO,
            unlock=unlock,
            jersey=jersey_map.get(signature) or {},
            notes=_str_or_none(row.get("notes")),
        ))
    return out


def pin_club_kit(
    *,
    club: str,
    signature: int,
    club_kits: Iterable[Mapping[str, Any]],
    unlocks: Iterable[Mapping[str, Any]],
    jersey: Mapping[str, Any] | None = None,
    notes: str | None = None,
    image_url: str | None = None,
    jersey_name: str | None = None,
    image_name: str | None = None,
    members: Iterable[Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    club = _str_or_none(club) or ""
    if not club:
        raise ValueError("club is required")
    existing = [dict(row) for row in club_kits]
    for row in existing:
        if row.get("assignment") == ASSIGN_PINNED and _int_or_none(row.get("jerseySignature")) == signature:
            other = _str_or_none(row.get("club"))
            if other and other != club:
                raise ValueError(f"Jersey already pinned to {other}")

    unlock_map = unlocks_by_signature(unlocks)
    unlock = dict(unlock_map.get(signature) or {})
    jersey_payload = dict(jersey or {})
    if jersey_name:
        jersey_payload["jerseyName"] = jersey_name
        jersey_payload["name"] = jersey_name
    if image_name:
        jersey_payload["imageName"] = image_name
    if image_url:
        jersey_payload["imageUrl"] = image_url
        unlock["imageUrl"] = image_url
    if notes is not None:
        unlock["notes"] = notes

    pinned_custom = not in_auto_pool(unlock) if unlock else True
    new_row = denormalize_kit_row(
        club=club,
        signature=signature,
        assignment=ASSIGN_PINNED,
        unlock=unlock,
        jersey=jersey_payload,
        notes=notes,
        pinned_custom=pinned_custom or notes is not None and not in_auto_pool(unlock),
    )
    if notes is not None:
        new_row["notes"] = _str_or_none(notes)
    if image_url:
        new_row["imageUrl"] = image_url
    if jersey_name:
        new_row["jerseyName"] = jersey_name
    if image_name:
        new_row["imageName"] = image_name
    if members is not None:
        assert_kit_enterable_by_club(members, new_row, unlocks)

    next_rows: list[dict[str, Any]] = []
    replaced = False
    for row in existing:
        row_club = _str_or_none(row.get("club"))
        if row_club == club:
            next_rows.append(new_row)
            replaced = True
            continue
        # Drop auto rows that used this jersey so the pin stays unique.
        if (
            row.get("assignment") == ASSIGN_AUTO
            and _int_or_none(row.get("jerseySignature")) == signature
        ):
            continue
        next_rows.append(row)
    if not replaced:
        next_rows.append(new_row)
    return next_rows


def assign_auto_club_kit(
    *,
    club: str,
    signature: int,
    club_kits: Iterable[Mapping[str, Any]],
    unlocks: Iterable[Mapping[str, Any]],
    jersey: Mapping[str, Any] | None = None,
    notes: str | None = None,
    image_url: str | None = None,
    jersey_name: str | None = None,
    image_name: str | None = None,
    members: Iterable[Mapping[str, Any]] | None = None,
) -> list[dict[str, Any]]:
    """Set one club's kit as auto without pinning or touching other clubs."""
    club = _str_or_none(club) or ""
    if not club:
        raise ValueError("club is required")
    wanted = club.casefold()
    existing = [dict(row) for row in club_kits]
    for row in existing:
        if row.get("assignment") != ASSIGN_PINNED:
            continue
        if _int_or_none(row.get("jerseySignature")) != signature:
            continue
        other = _str_or_none(row.get("club"))
        if other and other.casefold() != wanted:
            raise ValueError(f"Jersey already pinned to {other}")

    unlock_map = unlocks_by_signature(unlocks)
    unlock = dict(unlock_map.get(signature) or {})
    jersey_payload = dict(jersey or {})
    if jersey_name:
        jersey_payload["jerseyName"] = jersey_name
        jersey_payload["name"] = jersey_name
    if image_name:
        jersey_payload["imageName"] = image_name
    if image_url:
        jersey_payload["imageUrl"] = image_url
        unlock["imageUrl"] = image_url
    if notes is not None:
        unlock["notes"] = notes

    new_row = denormalize_kit_row(
        club=club,
        signature=signature,
        assignment=ASSIGN_AUTO,
        unlock=unlock,
        jersey=jersey_payload,
        notes=notes,
    )
    if notes is not None:
        new_row["notes"] = _str_or_none(notes)
    if image_url:
        new_row["imageUrl"] = image_url
    if jersey_name:
        new_row["jerseyName"] = jersey_name
    if image_name:
        new_row["imageName"] = image_name
    if members is not None:
        assert_kit_enterable_by_club(members, new_row, unlocks)

    next_rows: list[dict[str, Any]] = []
    replaced = False
    for row in existing:
        row_club = _str_or_none(row.get("club"))
        if row_club and row_club.casefold() == wanted:
            next_rows.append(new_row)
            replaced = True
            continue
        next_rows.append(row)
    if not replaced:
        next_rows.append(new_row)
    return next_rows


def unpin_club_kit(club: str, club_kits: Iterable[Mapping[str, Any]]) -> list[dict[str, Any]]:
    club = _str_or_none(club) or ""
    next_rows: list[dict[str, Any]] = []
    for row in club_kits:
        row_club = _str_or_none(row.get("club"))
        if row_club == club and row.get("assignment") == ASSIGN_PINNED:
            continue
        if row_club == club:
            continue
        next_rows.append(dict(row))
    return next_rows


def public_settings_view(settings: Mapping[str, Any]) -> dict[str, Any]:
    """Strip promo codes from league settings for non-admin clients."""
    out = dict(settings)
    unlocks = []
    for row in out.get("jerseyUnlocks") or []:
        item = dict(row)
        item.pop("unlockCode", None)
        unlocks.append(item)
    out["jerseyUnlocks"] = unlocks
    kits = []
    for row in out.get("clubKits") or []:
        item = dict(row)
        item.pop("unlockCode", None)
        kits.append(item)
    out["clubKits"] = kits
    return out


def rider_club_kit_payload(
    *,
    club: str | None,
    settings: Mapping[str, Any],
    drop_level: int | None,
    can_enter_unlock_code: bool = False,
) -> dict[str, Any] | None:
    """Public Min Profil payload. Live unlock row wins for dead codes."""
    club_name = _str_or_none(club)
    if not club_name:
        return None
    kit = kit_for_club(settings.get("clubKits") or [], club_name)
    if not kit:
        return None
    signature = _int_or_none(kit.get("jerseySignature"))
    unlock = unlocks_by_signature(settings.get("jerseyUnlocks") or []).get(signature or -1) or {}

    min_level = _int_or_none(unlock.get("minLevel"))
    if min_level is None:
        min_level = _int_or_none(kit.get("minLevel"))
    code_status = normalize_code_status(unlock) or normalize_code_status(kit)
    unlock_code = _str_or_none(unlock.get("unlockCode")) or _str_or_none(kit.get("unlockCode"))
    working = bool(unlock_code) and code_status == CODE_WORKING
    notes = _str_or_none(kit.get("notes"))
    has_level_grant = (
        drop_level is not None and min_level is not None and drop_level >= min_level
    )

    return {
        "club": club_name,
        "jerseySignature": signature,
        "jerseyName": _str_or_none(kit.get("jerseyName")) or _str_or_none(unlock.get("jerseyName")) or "",
        "imageName": _str_or_none(kit.get("imageName")) or _str_or_none(unlock.get("imageName")) or "",
        "imageUrl": _str_or_none(kit.get("imageUrl")) or _str_or_none(unlock.get("imageUrl")),
        "assignment": kit.get("assignment") or ASSIGN_AUTO,
        "source": kit.get("source") or unlock_source(unlock or kit),
        "minLevel": min_level,
        "unlockCode": unlock_code if working and can_enter_unlock_code else None,
        "codeStatus": code_status,
        "notes": notes,
        "dropLevel": drop_level,
        "hasLevelGrant": has_level_grant,
        "showCode": working and can_enter_unlock_code,
        "codeBlocked": working and not can_enter_unlock_code and not has_level_grant,
        "canEnterUnlockCode": can_enter_unlock_code,
    }


def _club_summary(
    club: str,
    members: list[Mapping[str, Any]],
    pool: set[int],
    kit: Mapping[str, Any] | None,
    *,
    pinned: bool,
) -> dict[str, Any]:
    known = [m for m in members if _int_or_none(m.get("dropLevel")) is not None]
    levels = [_int_or_none(m.get("dropLevel")) for m in known]
    levels_int = [lv for lv in levels if lv is not None]
    pc_mac = sum(1 for m in members if rider_can_enter_unlock_code(m))
    return {
        "club": club,
        "memberCount": len(members),
        "knownLevels": len(known),
        "unknownLevels": len(members) - len(known),
        "minDropLevel": min(levels_int) if levels_int else None,
        "maxDropLevel": max(levels_int) if levels_int else None,
        "pcMacCount": pc_mac,
        "poolSize": len(pool),
        "poolSignatures": sorted(pool),
        "pinned": pinned,
        "kit": dict(kit) if kit else None,
    }


def extract_level_fields(profile: Mapping[str, Any] | None) -> dict[str, Any]:
    """Pull achievement/drop/XP from official or unofficial profile JSON."""
    if not isinstance(profile, Mapping):
        return {}
    achievements = profile.get("achievements")
    nested = achievements if isinstance(achievements, Mapping) else {}
    raw = nested.get("achievementLevel")
    if raw is None:
        raw = profile.get("achievementLevel")
    xp = nested.get("totalExperiencePoints")
    if xp is None:
        xp = profile.get("totalExperiencePoints")
    drop = drop_level_from_achievement(raw)
    out: dict[str, Any] = {}
    if drop is not None:
        out["achievementLevel"] = int(raw)
        out["dropLevel"] = drop
    if xp is not None and not isinstance(xp, bool):
        try:
            out["totalExperiencePoints"] = int(xp)
        except (TypeError, ValueError):
            pass
    return out
