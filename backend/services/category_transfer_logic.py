"""Pure category-move scoring.

A move leaves every existing result row where it is and appends one
last-place credit in the destination division for each race the rider
actually finished. Later moves do the same without deleting earlier credits.
"""
from __future__ import annotations

import copy
from typing import Any

from services.results.constants import RACE_STATUS_XFER
from services.results.season_points_defaults import points_for_place

TRANSFER_COLLECTION = "categoryTransfers"
STATUS_APPLIED = "applied"
STATUS_REVERTED = "reverted"


def is_category_transfer(rider: dict[str, Any] | None) -> bool:
    if not isinstance(rider, dict):
        return False
    if rider.get("categoryTransfer") is True:
        return True
    return str(rider.get("raceStatus") or "").upper() == RACE_STATUS_XFER


def _id_set(race: dict[str, Any], field: str) -> set[str]:
    return {str(value) for value in (race.get(field) or [])}


def is_real_finish(rider: dict[str, Any] | None, race: dict[str, Any]) -> bool:
    """A finish the rider actually rode: timed, not a transfer credit, not DQ or excluded."""
    if not isinstance(rider, dict) or is_category_transfer(rider):
        return False
    zid = str(rider.get("zwiftId") or "").strip()
    if not zid:
        return False
    if zid in _id_set(race, "manualDQs") or zid in _id_set(race, "manualExclusions"):
        return False
    try:
        return int(rider.get("finishTime") or 0) > 0
    except (TypeError, ValueError):
        return False


def _counts_for_last_place(rider: dict[str, Any], race: dict[str, Any]) -> bool:
    """Riders who set the place ahead of a transfer credit. Declassified riders share last place."""
    if not is_real_finish(rider, race):
        return False
    zid = str(rider.get("zwiftId") or "").strip()
    return zid not in _id_set(race, "manualDeclassifications")


def race_has_results(race: dict[str, Any]) -> bool:
    results = race.get("results") or {}
    if not isinstance(results, dict):
        return False
    return any(isinstance(rows, list) and len(rows) > 0 for rows in results.values())


def collect_real_finishes(races: list[dict[str, Any]], zwift_id: str) -> list[dict[str, Any]]:
    """One entry per race the rider finished for real, in any division."""
    zid = str(zwift_id).strip()
    found: list[dict[str, Any]] = []
    for race in races:
        race_id = str(race.get("id") or "")
        results = race.get("results") or {}
        if not isinstance(results, dict):
            continue
        for category, rows in results.items():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if str((row or {}).get("zwiftId") or "").strip() != zid:
                    continue
                if not is_real_finish(row, race):
                    continue
                found.append({
                    "raceId": race_id,
                    "raceName": str(race.get("name") or race_id),
                    "category": str(category),
                    "name": str(row.get("name") or ""),
                    "club": str(row.get("club") or ""),
                    "resultsPhase": str(race.get("resultsPhase") or ""),
                    "stageRaceId": str(race.get("stageRaceId") or ""),
                })
                break
            else:
                continue
            break
    return found


def _skipped_appearances(races: list[dict[str, Any]], zwift_id: str, credited_ids: set[str]) -> list[dict[str, str]]:
    zid = str(zwift_id).strip()
    skipped: list[dict[str, str]] = []
    for race in races:
        race_id = str(race.get("id") or "")
        if race_id in credited_ids:
            continue
        results = race.get("results") or {}
        if not isinstance(results, dict):
            continue
        for rows in results.values():
            if not isinstance(rows, list):
                continue
            for row in rows:
                if str((row or {}).get("zwiftId") or "").strip() != zid or is_category_transfer(row):
                    continue
                reason = "DNF"
                if str(zid) in _id_set(race, "manualDQs"):
                    reason = "DQ"
                elif str(zid) in _id_set(race, "manualExclusions"):
                    reason = "excluded"
                skipped.append({
                    "raceId": race_id,
                    "raceName": str(race.get("name") or race_id),
                    "reason": reason,
                })
                break
            else:
                continue
            break
    return skipped


def plan_credits(
    races: list[dict[str, Any]],
    zwift_id: str,
    to_category: str,
) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    """Credits to append in ``to_category``, plus races that were seen but not credited."""
    credits: list[dict[str, Any]] = []
    already: list[dict[str, str]] = []
    for finish in collect_real_finishes(races, zwift_id):
        race = next((item for item in races if str(item.get("id") or "") == finish["raceId"]), None)
        if race is None:
            continue
        dest_rows = (race.get("results") or {}).get(to_category) or []
        if isinstance(dest_rows, list) and any(
            is_real_finish(row, race) and str(row.get("zwiftId") or "") == str(zwift_id)
            for row in dest_rows
        ):
            already.append({
                "raceId": finish["raceId"],
                "raceName": finish["raceName"],
                "reason": "already finished in destination",
            })
            continue
        credits.append(finish)
    credited_ids = {item["raceId"] for item in credits} | {item["raceId"] for item in already}
    return credits, already + _skipped_appearances(races, zwift_id, credited_ids)


def build_transfer_row(
    *,
    zwift_id: str,
    name: str,
    club: str,
    transfer_id: str,
    from_category: str,
    place: int,
    finish_points: int,
) -> dict[str, Any]:
    return {
        "zwiftId": str(zwift_id),
        "name": name,
        "club": club,
        "finishTime": 0,
        "finishRank": place,
        "finishPoints": finish_points,
        "sprintPoints": 0,
        "totalPoints": finish_points,
        "raceStatus": RACE_STATUS_XFER,
        "categoryTransfer": True,
        "transferFromCategory": from_category,
        "transferId": transfer_id,
        "sprintData": {},
        "sprintDetails": {},
    }


def ensure_transfer_row(
    rows: list[dict[str, Any]],
    race: dict[str, Any],
    credit: dict[str, Any],
    *,
    zwift_id: str,
    transfer_id: str,
    finish_points_scheme: list[int],
) -> list[dict[str, Any]]:
    """Append this move's last-place row, replacing a previous row from the same move."""
    kept = [
        row for row in rows
        if not (
            is_category_transfer(row)
            and str(row.get("transferId") or "") == str(transfer_id)
            and str(row.get("zwiftId") or "") == str(zwift_id)
        )
    ]
    if any(is_real_finish(row, race) and str(row.get("zwiftId") or "") == str(zwift_id) for row in kept):
        return kept
    real_finishers = [row for row in kept if _counts_for_last_place(row, race)]
    index = len(real_finishers)
    points = finish_points_scheme[index] if index < len(finish_points_scheme) else 0
    kept.append(build_transfer_row(
        zwift_id=zwift_id,
        name=str(credit.get("name") or ""),
        club=str(credit.get("club") or ""),
        transfer_id=transfer_id,
        from_category=str(credit.get("category") or ""),
        place=index + 1,
        finish_points=points,
    ))
    return kept


def apply_credits_to_races(
    races: list[dict[str, Any]],
    *,
    zwift_id: str,
    to_category: str,
    credits: list[dict[str, Any]],
    transfer_id: str,
    finish_points_scheme: list[int],
) -> list[dict[str, Any]]:
    """Return a copy of ``races`` with last-place rows appended. Existing rows stay."""
    updated = copy.deepcopy(races)
    by_id = {str(race.get("id") or ""): race for race in updated}
    for credit in credits:
        race = by_id.get(str(credit.get("raceId") or ""))
        if race is None:
            continue
        results = race.setdefault("results", {})
        if not isinstance(results, dict):
            race["results"] = {}
            results = race["results"]
        current = results.get(to_category) or []
        if not isinstance(current, list):
            current = []
        results[to_category] = ensure_transfer_row(
            current,
            race,
            credit,
            zwift_id=zwift_id,
            transfer_id=transfer_id,
            finish_points_scheme=finish_points_scheme,
        )
    return updated


def strip_transfer_rows(races: list[dict[str, Any]], transfer_id: str) -> list[dict[str, Any]]:
    updated = copy.deepcopy(races)
    token = str(transfer_id)
    for race in updated:
        results = race.get("results") or {}
        if not isinstance(results, dict):
            continue
        for category, rows in list(results.items()):
            if not isinstance(rows, list):
                continue
            results[category] = [
                row for row in rows
                if str((row or {}).get("transferId") or "") != token
            ]
    return updated


def merge_transfer_credits(
    results: dict[str, Any],
    race: dict[str, Any],
    transfers: list[dict[str, Any]],
    finish_points_scheme: list[int],
) -> dict[str, Any]:
    """Re-append credits for one race after a results rewrite. Real rows are not moved."""
    merged = copy.deepcopy(results) if isinstance(results, dict) else {}
    race_id = str(race.get("id") or "")
    race_view = {**race, "id": race_id, "results": merged}
    for transfer in transfers:
        if str(transfer.get("status") or STATUS_APPLIED) != STATUS_APPLIED:
            continue
        credited = {str(item) for item in (transfer.get("creditedRaceIds") or [])}
        if race_id not in credited:
            continue
        zwift_id = str(transfer.get("zwiftId") or "").strip()
        to_category = str(transfer.get("toCategory") or "").strip()
        if not zwift_id or not to_category:
            continue
        real = next(
            (item for item in collect_real_finishes([race_view], zwift_id) if item["raceId"] == race_id),
            None,
        )
        if real is None or real["category"] == to_category:
            continue
        current = merged.get(to_category) or []
        if not isinstance(current, list):
            current = []
        merged[to_category] = ensure_transfer_row(
            current,
            race_view,
            real,
            zwift_id=zwift_id,
            transfer_id=str(transfer.get("id") or ""),
            finish_points_scheme=finish_points_scheme,
        )
        race_view["results"] = merged
    return merged


def protected_ids_for_race(transfers: list[dict[str, Any]], race_id: str) -> set[str]:
    """Riders whose real result on this race must stay in the division where they finished."""
    token = str(race_id)
    protected: set[str] = set()
    for transfer in transfers:
        if str(transfer.get("status") or STATUS_APPLIED) != STATUS_APPLIED:
            continue
        credited = {str(item) for item in (transfer.get("creditedRaceIds") or [])}
        if token in credited:
            zid = str(transfer.get("zwiftId") or "").strip()
            if zid:
                protected.add(zid)
    return protected


def preexisting_destination_race_ids(
    races: list[dict[str, Any]],
    zwift_id: str,
    to_category: str,
) -> list[str]:
    ids: list[str] = []
    for race in races:
        rows = (race.get("results") or {}).get(to_category) or []
        if not isinstance(rows, list):
            continue
        if any(is_real_finish(row, race) and str(row.get("zwiftId") or "") == str(zwift_id) for row in rows):
            race_id = str(race.get("id") or "")
            if race_id:
                ids.append(race_id)
    return ids


def undo_blocked_by_later_result(
    races: list[dict[str, Any]],
    *,
    zwift_id: str,
    to_category: str,
    preexisting_race_ids: list[str],
) -> bool:
    known = set(preexisting_race_ids)
    for race in races:
        race_id = str(race.get("id") or "")
        if race_id in known:
            continue
        rows = (race.get("results") or {}).get(to_category) or []
        if not isinstance(rows, list):
            continue
        if any(is_real_finish(row, race) and str(row.get("zwiftId") or "") == str(zwift_id) for row in rows):
            return True
    return False


def latest_applied_transfer(transfers: list[dict[str, Any]], zwift_id: str) -> dict[str, Any] | None:
    applied = [
        item for item in transfers
        if str(item.get("zwiftId") or "") == str(zwift_id)
        and str(item.get("status") or "") == STATUS_APPLIED
    ]
    if not applied:
        return None
    return max(applied, key=lambda item: str(item.get("createdAtIso") or ""))


def _season_points_for_race(
    race: dict[str, Any],
    stage_races: list[dict[str, Any]],
    settings: dict[str, Any],
    place: int,
) -> int:
    if str(race.get("resultsPhase") or "").lower() != "finalized":
        return 0
    event_id = str(race.get("stageRaceId") or "")
    event = next((item for item in stage_races if str(item.get("id") or "") == event_id), None)
    if event is None:
        return 0
    season_class = str(event.get("seasonClass") or "").strip().lower()
    tables = (settings or {}).get("seasonRankPoints") or {}
    if season_class == "tour":
        scheme = tables.get("tour_stage") or {}
    elif season_class in {"monument", "wt_classic"}:
        scheme = tables.get(season_class) or {}
    else:
        scheme = {}
    return points_for_place(scheme, place)


def describe_credits(
    races: list[dict[str, Any]],
    *,
    zwift_id: str,
    to_category: str,
    credits: list[dict[str, Any]],
    transfer_id: str,
    finish_points_scheme: list[int],
    league_rank_points: list[int],
    stage_races: list[dict[str, Any]],
    settings: dict[str, Any],
) -> list[dict[str, Any]]:
    """Place and points in the destination after the credit is appended."""
    from services.results.league_engine import LeagueEngine

    projected = apply_credits_to_races(
        races,
        zwift_id=zwift_id,
        to_category=to_category,
        credits=credits,
        transfer_id=transfer_id,
        finish_points_scheme=finish_points_scheme,
    )
    by_id = {str(race.get("id") or ""): race for race in projected}
    engine = LeagueEngine({
        "leagueRankPoints": league_rank_points,
        "finishPoints": finish_points_scheme,
        "bestRacesCount": 99,
    })
    described: list[dict[str, Any]] = []
    for credit in credits:
        race = by_id.get(str(credit.get("raceId") or ""))
        if race is None:
            continue
        rows = (race.get("results") or {}).get(to_category) or []
        real_count = len([row for row in rows if _counts_for_last_place(row, race)])
        places = engine.get_race_places(
            rows if isinstance(rows, list) else [],
            race,
            to_category,
            str(race.get("type") or "scratch"),
            _id_set(race, "manualDQs"),
            _id_set(race, "manualDeclassifications"),
            _id_set(race, "manualExclusions"),
        )
        place = int(places.get(str(zwift_id)) or (real_count + 1))
        league_points = league_rank_points[place - 1] if 0 < place <= len(league_rank_points) else 0
        described.append({
            "raceId": credit["raceId"],
            "raceName": credit.get("raceName") or credit["raceId"],
            "fromCategory": credit.get("category"),
            "destinationFinishers": real_count,
            "assignedPlace": place,
            "leaguePoints": league_points,
            "seasonPoints": _season_points_for_race(race, stage_races, settings, place),
            "countsNow": str(race.get("resultsPhase") or "").lower() == "finalized",
        })
    return described


def score_standings(
    races: list[dict[str, Any]],
    stage_races: list[dict[str, Any]],
    settings: dict[str, Any],
) -> dict[str, list[dict[str, Any]]]:
    """Season standings when events exist, otherwise flat league standings. In-memory only."""
    from services.results.league_engine import LeagueEngine
    from services.results.season_engine import SeasonEngine, season_mode_enabled
    from services.results.stage_race_ops import calculate_event_gc, stages_for_event

    races_by_id = {str(race.get("id") or ""): copy.deepcopy(race) for race in races}
    events = [copy.deepcopy(event) for event in stage_races]
    for event in events:
        event_id = str(event.get("id") or "")
        stages = stages_for_event(races_by_id, event_id)
        event["standings"] = calculate_event_gc(settings, stages, int(event.get("bestRacesCount") or 1))
    if season_mode_enabled(settings, len(events)):
        return SeasonEngine(settings).calculate_standings(events, races_by_id)
    return LeagueEngine(settings).calculate_standings(list(races_by_id.values()))


def rider_standing(standings: dict[str, Any], category: str, zwift_id: str) -> dict[str, Any]:
    rows = standings.get(category) or []
    if not isinstance(rows, list):
        return {"rank": None, "points": 0}
    for index, row in enumerate(rows):
        if str((row or {}).get("zwiftId") or "") == str(zwift_id):
            return {"rank": index + 1, "points": int(row.get("totalPoints") or 0)}
    return {"rank": None, "points": 0}


def standings_delta(
    before: dict[str, Any],
    after: dict[str, Any],
    *,
    zwift_id: str,
    from_category: str,
    to_category: str,
) -> dict[str, Any]:
    return {
        "fromCategory": {
            "category": from_category,
            "before": rider_standing(before, from_category, zwift_id),
            "after": rider_standing(after, from_category, zwift_id),
        },
        "toCategory": {
            "category": to_category,
            "before": rider_standing(before, to_category, zwift_id),
            "after": rider_standing(after, to_category, zwift_id),
        },
    }
