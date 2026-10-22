"""Club API credentials and the current-season reads those credentials unlock.

The plaintext secret is returned once to an admin. Firestore stores only a
PBKDF2-SHA256 hash. Every club read sends the username and secret again with
HTTP Basic auth.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import logging
import re
import secrets
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from firebase_admin import firestore as admin_firestore

from services.category_engine import cats_from_defs, effective_liga_category_name
from services.schema_validation import (
    log_schema_issues,
    validate_club_api_client_doc,
    with_schema_version,
)
from utils.datetime_utils import parse_dt

logger = logging.getLogger(__name__)

COLLECTION = "clubApiClients"
PBKDF2_ITERATIONS = 200_000
API_VERSION = 1
RATE_LIMIT = 60
RATE_WINDOW_SECONDS = 60
AUTH_HINT = "Send the club username and secret with HTTP Basic authentication."
RATE_LIMIT_MESSAGE = "Too many requests. A club login can make 60 requests per minute."
USERNAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")

READS = [
    {
        "method": "GET",
        "path": "/club-api",
        "purpose": "This description: the club for these credentials, the read paths, and the field glossary.",
    },
    {
        "method": "GET",
        "path": "/club-api/races",
        "purpose": "Current-season races that have results, without rider rows. Use the id to request one race.",
    },
    {
        "method": "GET",
        "path": "/club-api/races/{race_id}/results",
        "purpose": "One race. This club's riders in every division, with their place in the full field.",
    },
    {
        "method": "GET",
        "path": "/club-api/standings",
        "purpose": "Season standings for this club's riders in each division.",
    },
    {
        "method": "GET",
        "path": "/club-api/club-standings",
        "purpose": "Club classification for the current season. Each club's score is its best three riders.",
    },
]

GLOSSARY = {
    "position": "1-based place in the full division, in the same order as the public results table. Club riders are not re-ranked among themselves.",
    "resultsPhase": "provisional while results can still change, or finalized once the race is closed.",
    "finishTime": "Elapsed time in milliseconds. 0 means the rider has no finish time.",
    "counting": "True when this season line is one of the best results that make up totalPoints. A missing or zero best-results setting counts every line.",
    "clubScore": "A club's score is the sum of its three riders with the most season points, taken across every division. Each rider counts once.",
    "fieldSize": "Number of riders in that division's published result.",
    "winnerFinishTime": "finishTime in milliseconds of the first rider in that division who has a finish time.",
    "yours": "True on the club-standings row that belongs to the authenticated club.",
    "disqualified": "True when the rider was disqualified.",
    "declassified": "True when the rider was declassified.",
}


class ClubApiError(Exception):
    def __init__(self, message: str, status_code: int, retry_after: int | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.retry_after = retry_after


@dataclass(frozen=True)
class _RateDecision:
    allowed: bool
    times: list[str]
    now_iso: str
    retry_after: int


def club_key(club: str) -> str:
    return (club or "").strip().casefold()


def clubs_match(left: str | None, right: str | None) -> bool:
    key = club_key(left or "")
    return bool(key) and key == club_key(right or "")


def normalize_username(raw: str | None) -> str:
    username = (raw or "").strip().lower()
    if ":" in (raw or "") or not USERNAME_RE.fullmatch(username):
        raise ClubApiError(
            "Username must start with a letter or number and contain only lowercase letters, numbers, dots, underscores, or hyphens. It cannot contain a colon.",
            400,
        )
    return username


def hash_secret(secret: str, salt: bytes | None = None) -> tuple[str, str]:
    salt_bytes = salt if salt is not None else secrets.token_bytes(16)
    digest = hashlib.pbkdf2_hmac("sha256", secret.encode("utf-8"), salt_bytes, PBKDF2_ITERATIONS)
    return digest.hex(), salt_bytes.hex()


def secrets_match(secret: str, salt_hex: str, hash_hex: str) -> bool:
    try:
        salt = bytes.fromhex(salt_hex or "")
    except ValueError:
        return False
    digest, _ = hash_secret(secret, salt)
    try:
        return hmac.compare_digest(digest, hash_hex or "")
    except TypeError:
        return False


def generate_secret() -> str:
    return secrets.token_urlsafe(24)


def describe_api(club: str) -> dict[str, Any]:
    return {
        "version": API_VERSION,
        "club": club,
        "auth": AUTH_HINT,
        "limit": {
            "requests": RATE_LIMIT,
            "windowSeconds": RATE_WINDOW_SECONDS,
            "description": RATE_LIMIT_MESSAGE,
        },
        "reads": READS,
        "glossary": GLOSSARY,
    }


def authenticate_header(db: Any, authorization: str | None) -> dict[str, str]:
    username, secret = _parse_basic(authorization)
    doc = db.collection(COLLECTION).document(username).get()
    data = doc.to_dict() if getattr(doc, "exists", False) else None
    if not isinstance(data, dict) or not secrets_match(secret, str(data.get("salt") or ""), str(data.get("secretHash") or "")):
        raise ClubApiError(AUTH_HINT, 401)
    if data.get("revoked") is True:
        raise ClubApiError("Club API access is revoked.", 403)
    _record_use(db, username)
    club = str(data.get("club") or "").strip()
    return {"username": username, "club": club}


def list_clients(db: Any) -> dict[str, Any]:
    clients = []
    for doc in db.collection(COLLECTION).stream():
        data = doc.to_dict() or {}
        clients.append(_public_client(doc.id, data))
    clients.sort(key=lambda row: (row["club"].casefold(), row["username"]))
    return {"clients": clients, "clubs": list_profile_clubs(db)}


def list_profile_clubs(db: Any) -> list[str]:
    return sorted(_canonical_clubs(db).values(), key=str.casefold)


def create_client(db: Any, club: str, username_raw: str) -> dict[str, Any]:
    username = normalize_username(username_raw)
    canonical = _canonical_clubs(db).get(club_key(club))
    if not canonical:
        raise ClubApiError("Choose a club that is on a registered rider's profile.", 400)
    if db.collection(COLLECTION).document(username).get().exists:
        raise ClubApiError("That username is already in use.", 409)
    existing = list(db.collection(COLLECTION).where("clubKey", "==", club_key(canonical)).limit(1).stream())
    if existing:
        raise ClubApiError("That club already has an API login.", 409)
    secret = generate_secret()
    secret_hash, salt = hash_secret(secret)
    now = _now_iso()
    payload = with_schema_version({
        "username": username,
        "club": canonical,
        "clubKey": club_key(canonical),
        "secretHash": secret_hash,
        "salt": salt,
        "revoked": False,
        "createdAt": now,
        "updatedAt": now,
        "lastUsedAt": None,
    })
    log_schema_issues(logger, "clubApiClients (create)", validate_club_api_client_doc(payload))
    db.collection(COLLECTION).document(username).set(payload)
    return {"client": _public_client(username, payload), "secret": secret, "docsPath": "/club-api"}


def rotate_client(db: Any, username_raw: str) -> dict[str, Any]:
    username = normalize_username(username_raw)
    ref = db.collection(COLLECTION).document(username)
    doc = ref.get()
    if not doc.exists:
        raise ClubApiError("Club API login not found.", 404)
    data = doc.to_dict() or {}
    secret = generate_secret()
    secret_hash, salt = hash_secret(secret)
    now = _now_iso()
    data.update({"secretHash": secret_hash, "salt": salt, "updatedAt": now})
    log_schema_issues(logger, "clubApiClients (rotate)", validate_club_api_client_doc(data))
    ref.update({"secretHash": secret_hash, "salt": salt, "updatedAt": now})
    return {"client": _public_client(username, data), "secret": secret, "docsPath": "/club-api"}


def set_revoked(db: Any, username_raw: str, revoked: bool) -> dict[str, Any]:
    username = normalize_username(username_raw)
    ref = db.collection(COLLECTION).document(username)
    doc = ref.get()
    if not doc.exists:
        raise ClubApiError("Club API login not found.", 404)
    now = _now_iso()
    ref.update({"revoked": revoked, "updatedAt": now})
    data = doc.to_dict() or {}
    data.update({"revoked": revoked, "updatedAt": now})
    return {"client": _public_client(username, data)}


def race_index(db: Any) -> dict[str, Any]:
    snapshot = _snapshot(db)
    return {"races": build_race_index(snapshot["races"], snapshot["stageRaces"])}


def race_results(db: Any, client: dict[str, str], race_id: str) -> dict[str, Any]:
    snapshot = _snapshot(db)
    race = next((row for row in snapshot["races"] if row.get("id") == race_id), None)
    if race is None:
        raise ClubApiError("Race not found.", 404)
    return build_race_results(
        race,
        snapshot["stageRaces"],
        client["club"],
        snapshot["clubByZwiftId"],
        snapshot["categoryOrder"],
    )


def season_standings(db: Any, client: dict[str, str]) -> dict[str, Any]:
    snapshot = _snapshot(db)
    return {
        "divisions": build_season_standings(
            snapshot["standings"],
            snapshot["races"],
            snapshot["stageRaces"],
            client["club"],
            snapshot["clubByZwiftId"],
            snapshot["categoryOrder"],
            snapshot["bestCount"],
        )
    }


def club_standings(db: Any, client: dict[str, str]) -> dict[str, Any]:
    snapshot = _snapshot(db)
    return {
        "clubs": build_club_standings(
            snapshot["standings"],
            client["club"],
            snapshot["clubByZwiftId"],
            snapshot["categoryByZwiftId"],
        )
    }


def build_race_index(races: list[dict[str, Any]], stage_races: list[dict[str, Any]]) -> list[dict[str, Any]]:
    events = {str(row.get("id") or ""): row for row in stage_races}
    rows = []
    for race in races:
        results = race.get("results")
        if not isinstance(results, dict) or not results:
            continue
        row: dict[str, Any] = {
            "id": race.get("id"),
            "name": race.get("name") or "",
            "date": to_iso(race.get("date")),
            "resultsPhase": _phase(race),
        }
        stage_id = str(race.get("stageRaceId") or "").strip()
        if stage_id:
            row["stageRaceId"] = stage_id
            if race.get("stageIndex") is not None:
                row["stageIndex"] = _as_int(race.get("stageIndex"))
            event = events.get(stage_id) or {}
            name = str(event.get("name") or "").strip()
            if name:
                row["stageRaceName"] = name
        rows.append(row)
    rows.sort(key=lambda row: parse_dt(row.get("date")) or datetime.max)
    return rows


def build_race_results(
    race: dict[str, Any],
    stage_races: list[dict[str, Any]],
    club: str,
    club_by_zwift: dict[str, str],
    category_order: list[str],
) -> dict[str, Any]:
    events = {str(row.get("id") or ""): row for row in stage_races}
    payload: dict[str, Any] = {
        "id": race.get("id"),
        "name": race.get("name") or "",
        "date": to_iso(race.get("date")),
        "resultsPhase": _phase(race),
        "divisions": [],
    }
    stage_id = str(race.get("stageRaceId") or "").strip()
    if stage_id:
        payload["stageRaceId"] = stage_id
        if race.get("stageIndex") is not None:
            payload["stageIndex"] = _as_int(race.get("stageIndex"))
        event_name = str((events.get(stage_id) or {}).get("name") or "").strip()
        if event_name:
            payload["stageRaceName"] = event_name

    results = race.get("results") if isinstance(race.get("results"), dict) else {}
    categories = sorted(results.keys(), key=lambda name: _category_sort_key(str(name), category_order))
    divisions = []
    for category in categories:
        riders = results.get(category)
        if not isinstance(riders, list):
            riders = []
        winner = next((_as_int(rider.get("finishTime")) for rider in riders if isinstance(rider, dict) and (_as_int(rider.get("finishTime")) or 0) > 0), None)
        kept = []
        for index, rider in enumerate(riders):
            if not isinstance(rider, dict) or not _result_rider_in_club(rider, club, club_by_zwift):
                continue
            kept.append(_public_result_rider(rider, index, club_by_zwift))
        divisions.append({
            "category": str(category),
            "fieldSize": len(riders),
            "winnerFinishTime": winner,
            "riders": kept,
        })
    payload["divisions"] = divisions
    return payload


def build_season_standings(
    standings: dict[str, Any],
    races: list[dict[str, Any]],
    stage_races: list[dict[str, Any]],
    club: str,
    club_by_zwift: dict[str, str],
    category_order: list[str],
    best_count: int | None,
) -> list[dict[str, Any]]:
    races_by_id = {str(race.get("id") or ""): race for race in races}
    events = {str(row.get("id") or ""): row for row in stage_races}
    divisions = []
    categories = sorted((standings or {}).keys(), key=lambda name: _category_sort_key(str(name), category_order))
    for category in categories:
        riders = standings.get(category)
        if not isinstance(riders, list):
            continue
        ordered = sorted(
            [rider for rider in riders if isinstance(rider, dict)],
            key=lambda rider: _as_int(rider.get("totalPoints")) or 0,
            reverse=True,
        )
        kept = []
        for index, rider in enumerate(ordered):
            zwift_id = str(rider.get("zwiftId") or "").strip()
            profile_club = club_by_zwift.get(zwift_id) or ""
            if not clubs_match(profile_club, club):
                continue
            lines = rider.get("results") if isinstance(rider.get("results"), list) else []
            counting = _counting_indexes(lines, best_count)
            kept.append({
                "position": index + 1,
                "zwiftId": zwift_id,
                "name": rider.get("name") or zwift_id,
                "club": profile_club,
                "raceCount": _as_int(rider.get("raceCount")) or 0,
                "totalPoints": _as_int(rider.get("totalPoints")) or 0,
                "results": [
                    _public_standing_line(line, line_index in counting, races_by_id, events, races)
                    for line_index, line in enumerate(lines)
                    if isinstance(line, dict)
                ],
            })
        if kept:
            divisions.append({"category": str(category), "riders": kept})
    return divisions


def build_club_standings(
    standings: dict[str, Any],
    club: str,
    club_by_zwift: dict[str, str],
    category_by_zwift: dict[str, str],
) -> list[dict[str, Any]]:
    """Same top-three rule as the public Klubber table."""
    best_by_rider: dict[str, dict[str, Any]] = {}
    for category, riders in (standings or {}).items():
        if not isinstance(riders, list):
            continue
        for rider in riders:
            if not isinstance(rider, dict):
                continue
            zwift_id = str(rider.get("zwiftId") or "").strip()
            if not zwift_id:
                continue
            points = _as_int(rider.get("totalPoints")) or 0
            current_category = category_by_zwift.get(zwift_id)
            if current_category:
                if str(category) != current_category:
                    continue
                best_by_rider[zwift_id] = {"name": rider.get("name") or zwift_id, "points": points}
                continue
            current = best_by_rider.get(zwift_id)
            if current is None or points > int(current["points"]):
                best_by_rider[zwift_id] = {"name": rider.get("name") or zwift_id, "points": points}

    by_club: dict[str, list[dict[str, Any]]] = {}
    for zwift_id, rider in best_by_rider.items():
        profile_club = (club_by_zwift.get(zwift_id) or "").strip()
        if not profile_club:
            continue
        by_club.setdefault(profile_club, []).append({
            "zwiftId": zwift_id,
            "name": rider["name"],
            "points": rider["points"],
        })

    rows = []
    for profile_club, members in by_club.items():
        counting = sorted(members, key=lambda rider: (-int(rider["points"]), str(rider["name"]).casefold()))[:3]
        rows.append({
            "club": profile_club,
            "points": sum(int(rider["points"]) for rider in counting),
            "riders": counting,
            "yours": clubs_match(profile_club, club),
        })
    rows.sort(key=lambda row: (-int(row["points"]), str(row["club"]).casefold()))
    for index, row in enumerate(rows):
        row["rank"] = index + 1
    return rows


def decide_rate_limit(existing: Any, now: datetime) -> _RateDecision:
    """Keep calls from the last minute. The 61st call in that minute waits."""
    now_utc = now.astimezone(timezone.utc).replace(tzinfo=None) if now.tzinfo else now
    window_start = now_utc - timedelta(seconds=RATE_WINDOW_SECONDS)
    recent: list[datetime] = []
    if isinstance(existing, list):
        for value in existing:
            parsed = parse_dt(value)
            if parsed is not None and parsed > window_start:
                recent.append(parsed)
    recent.sort()
    now_iso = now_utc.replace(microsecond=0).replace(tzinfo=timezone.utc).isoformat()
    if len(recent) >= RATE_LIMIT:
        oldest = recent[0]
        retry_after = int((oldest + timedelta(seconds=RATE_WINDOW_SECONDS) - now_utc).total_seconds())
        return _RateDecision(
            allowed=False,
            times=[stamp.replace(tzinfo=timezone.utc).isoformat() for stamp in recent],
            now_iso=now_iso,
            retry_after=max(retry_after, 1),
        )
    recent.append(now_utc.replace(microsecond=0))
    return _RateDecision(
        allowed=True,
        times=[stamp.replace(tzinfo=timezone.utc).isoformat() for stamp in recent],
        now_iso=now_iso,
        retry_after=0,
    )


def to_iso(value: Any) -> str | None:
    if value is None or value == "":
        return None
    parsed = parse_dt(value)
    if parsed is None:
        return value if isinstance(value, str) else None
    return parsed.replace(tzinfo=timezone.utc).isoformat()


def _snapshot(db: Any) -> dict[str, Any]:
    settings_doc = db.collection("league").document("settings").get()
    settings = settings_doc.to_dict() if getattr(settings_doc, "exists", False) else {}
    if not isinstance(settings, dict):
        settings = {}
    standings_doc = db.collection("league").document("standings").get()
    standings_wrap = standings_doc.to_dict() if getattr(standings_doc, "exists", False) else {}
    standings = standings_wrap.get("standings") if isinstance(standings_wrap, dict) else {}
    if not isinstance(standings, dict):
        standings = {}

    races = []
    for doc in db.collection("races").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        races.append(data)
    stage_races = []
    for doc in db.collection("stageRaces").stream():
        data = doc.to_dict() or {}
        data["id"] = doc.id
        stage_races.append(data)

    defs = settings.get("ligaCategories") if isinstance(settings.get("ligaCategories"), list) else []
    category_order = [str(row.get("name")).strip() for row in defs if isinstance(row, dict) and str(row.get("name") or "").strip()]
    try:
        rank_cats = cats_from_defs(defs) if defs else None
    except Exception:
        logger.warning("Could not parse ligaCategories for the club API; using category names only")
        rank_cats = None

    club_by_zwift: dict[str, str] = {}
    category_by_zwift: dict[str, str] = {}
    for doc in db.collection("users").where("registration.status", "==", "complete").stream():
        data = doc.to_dict() or {}
        zwift_id = str(data.get("zwiftId") or "").strip()
        if not zwift_id:
            continue
        profile_club = str(data.get("club") or "").strip()
        if profile_club:
            club_by_zwift[zwift_id] = profile_club
        category = effective_liga_category_name(data.get("ligaCategory") if isinstance(data.get("ligaCategory"), dict) else None, rank_cats)
        if category:
            category_by_zwift[zwift_id] = category

    return {
        "races": races,
        "stageRaces": stage_races,
        "standings": standings,
        "clubByZwiftId": club_by_zwift,
        "categoryByZwiftId": category_by_zwift,
        "categoryOrder": category_order,
        "bestCount": _best_count(settings),
    }


def _canonical_clubs(db: Any) -> dict[str, str]:
    found: dict[str, str] = {}
    for doc in db.collection("users").where("registration.status", "==", "complete").stream():
        data = doc.to_dict() or {}
        profile_club = str(data.get("club") or "").strip()
        if not profile_club:
            continue
        found.setdefault(club_key(profile_club), profile_club)
    return found


def _public_client(username: str, data: dict[str, Any]) -> dict[str, Any]:
    return {
        "username": str(data.get("username") or username),
        "club": str(data.get("club") or ""),
        "revoked": data.get("revoked") is True,
        "createdAt": data.get("createdAt"),
        "updatedAt": data.get("updatedAt"),
        "lastUsedAt": data.get("lastUsedAt"),
    }


def _parse_basic(authorization: str | None) -> tuple[str, str]:
    header = authorization or ""
    if not header.startswith("Basic "):
        raise ClubApiError(AUTH_HINT, 401)
    encoded = header.split(" ", 1)[1].strip()
    try:
        decoded = base64.b64decode(encoded, validate=True).decode("utf-8")
    except Exception:
        raise ClubApiError(AUTH_HINT, 401) from None
    if ":" not in decoded:
        raise ClubApiError(AUTH_HINT, 401)
    username, secret = decoded.split(":", 1)
    try:
        username = normalize_username(username)
    except ClubApiError:
        raise ClubApiError(AUTH_HINT, 401) from None
    if not secret:
        raise ClubApiError(AUTH_HINT, 401)
    return username, secret


def _result_rider_in_club(rider: dict[str, Any], club: str, club_by_zwift: dict[str, str]) -> bool:
    stamped = str(rider.get("club") or "").strip()
    if stamped:
        return clubs_match(stamped, club)
    zwift_id = str(rider.get("zwiftId") or "").strip()
    return clubs_match(club_by_zwift.get(zwift_id), club)


def _public_result_rider(rider: dict[str, Any], index: int, club_by_zwift: dict[str, str]) -> dict[str, Any]:
    status = str(rider.get("raceStatus") or "").strip()
    is_transfer = status.upper() == "XFER" or rider.get("categoryTransfer") is True
    finish_rank = _as_int(rider.get("finishRank"))
    position = finish_rank if is_transfer and finish_rank else index + 1
    zwift_id = str(rider.get("zwiftId") or "").strip()
    stamped = str(rider.get("club") or "").strip()
    row: dict[str, Any] = {
        "position": position,
        "zwiftId": zwift_id,
        "name": rider.get("name") or zwift_id,
        "club": stamped or club_by_zwift.get(zwift_id) or "",
        "finishTime": _as_int(rider.get("finishTime")),
        "finishRank": finish_rank,
        "finishPoints": _as_int(rider.get("finishPoints")) or 0,
        "sprintPoints": _as_int(rider.get("sprintPoints")) or 0,
        "totalPoints": _as_int(rider.get("totalPoints")) or 0,
        "raceStatus": status or None,
        "disqualified": rider.get("disqualified") is True,
        "declassified": rider.get("declassified") is True,
        "categoryTransfer": is_transfer,
    }
    transfer_from = str(rider.get("transferFromCategory") or "").strip()
    if transfer_from:
        row["transferFromCategory"] = transfer_from
    splits = _sprint_details(rider.get("sprintDetails"))
    if splits:
        row["sprintDetails"] = splits
    return row


def _public_standing_line(
    line: dict[str, Any],
    counting: bool,
    races_by_id: dict[str, dict[str, Any]],
    events: dict[str, dict[str, Any]],
    races: list[dict[str, Any]],
) -> dict[str, Any]:
    race_id = str(line.get("raceId") or "").strip() or None
    stage_id = str(line.get("stageRaceId") or "").strip() or None
    race_name = None
    date = None
    if race_id and race_id in races_by_id:
        race = races_by_id[race_id]
        race_name = race.get("name") or race_id
        date = to_iso(race.get("date"))
    elif stage_id and stage_id in events:
        race_name = events[stage_id].get("name") or stage_id
        stage_dates = [
            parse_dt(race.get("date"))
            for race in races
            if str(race.get("stageRaceId") or "") == stage_id and parse_dt(race.get("date"))
        ]
        if stage_dates:
            date = min(stage_dates).replace(tzinfo=timezone.utc).isoformat()
    row: dict[str, Any] = {
        "raceId": race_id,
        "raceName": race_name,
        "date": date,
        "points": _as_int(line.get("points")) or 0,
        "source": line.get("source") or None,
        "counting": counting,
    }
    if stage_id:
        row["stageRaceId"] = stage_id
    return row


def _counting_indexes(lines: list[Any], best_count: int | None) -> set[int]:
    usable = [(index, line) for index, line in enumerate(lines) if isinstance(line, dict)]
    usable.sort(key=lambda pair: _as_int(pair[1].get("points")) or 0, reverse=True)
    take = len(usable) if best_count is None else max(best_count, 0)
    return {index for index, _line in usable[:take]}


def _best_count(settings: dict[str, Any]) -> int | None:
    raw = settings.get("seasonBestResultsCount")
    if raw in (None, "", 0):
        return None
    try:
        count = int(raw)
    except (TypeError, ValueError):
        return None
    return count if count > 0 else None


def _category_sort_key(name: str, order: list[str]) -> tuple[int, int | str]:
    try:
        return (0, order.index(name))
    except ValueError:
        return (1, name.casefold())


def _phase(race: dict[str, Any]) -> str | None:
    phase = race.get("resultsPhase")
    return phase if isinstance(phase, str) and phase else None


def _sprint_details(raw: Any) -> dict[str, int | float] | None:
    if not isinstance(raw, dict):
        return None
    out: dict[str, int | float] = {}
    for key, value in raw.items():
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        out[str(key)] = value
    return out or None


def _as_int(value: Any) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _record_use(db: Any, username: str) -> None:
    ref = db.collection(COLLECTION).document(username)
    now = datetime.now(timezone.utc)
    transaction_factory = getattr(db, "transaction", None)
    if callable(transaction_factory):
        try:
            _record_use_transaction(transaction_factory(), ref, now)
            return
        except ClubApiError:
            raise
        except Exception as exc:
            logger.warning("Could not record club API use for %s: %s", username, exc)
            return
    try:
        data = ref.get().to_dict() or {}
        decision = decide_rate_limit(data.get("requestTimes"), now)
        if not decision.allowed:
            raise ClubApiError(RATE_LIMIT_MESSAGE, 429, retry_after=decision.retry_after)
        ref.update({"lastUsedAt": decision.now_iso, "requestTimes": decision.times})
    except ClubApiError:
        raise
    except Exception as exc:
        logger.warning("Could not record club API use for %s: %s", username, exc)


@admin_firestore.transactional
def _record_use_transaction(transaction: Any, ref: Any, now: datetime) -> None:
    snapshot = ref.get(transaction=transaction)
    data = snapshot.to_dict() if getattr(snapshot, "exists", False) else {}
    decision = decide_rate_limit((data or {}).get("requestTimes"), now)
    if not decision.allowed:
        raise ClubApiError(RATE_LIMIT_MESSAGE, 429, retry_after=decision.retry_after)
    transaction.update(ref, {"lastUsedAt": decision.now_iso, "requestTimes": decision.times})
