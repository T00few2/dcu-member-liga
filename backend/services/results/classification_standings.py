"""
Season sprint and KOM totals.

Scored banners keep a single points scale. Which competition they feed comes
from the route profile segment type stored on elevation_cache (sprint or climb).
Totals are the sum of every finalized season race, not best-X.
"""
from __future__ import annotations

import logging
import re
import unicodedata
from typing import Any

from services.category_config import CategoryConfigResolver
from services.results.constants import RESULTS_PHASE_FINALIZED

logger = logging.getLogger(__name__)

# sprintDetails stores split world-times as large integers. Points are small.
_SPLIT_TIME_FLOOR = 1_000_000
_CLASS_TYPES = {"sprint", "climb", "segment"}


def normalize_profile_name(name: str | None) -> str:
    """Match frontend normalizeProfileSegmentName."""
    text = unicodedata.normalize("NFD", name or "")
    text = "".join(ch for ch in text if unicodedata.category(ch) != "Mn")
    text = text.strip().lower()
    text = text.replace("'", " ").replace("’", " ").replace("`", " ")
    text = re.sub(r"\s+\(.*\)\s*$", "", text)
    text = re.sub(r"\s+(reverse|rev\.?)$", "", text)
    text = re.sub(r"[-_]+", " ", text)
    text = re.sub(r"[^a-z0-9\s]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def normalize_profile_direction(direction: str | None, name: str | None = None) -> str:
    d = (direction or "").strip().lower()
    if d in ("reverse", "rev", "r"):
        return "reverse"
    if d in ("forward", "f"):
        return "forward"
    n = (name or "").lower()
    if "reverse" in n or " rev" in n:
        return "reverse"
    return "forward"


def index_profile_segments(segments: list[dict[str, Any]] | None) -> dict[tuple[str, str], str]:
    indexed: dict[tuple[str, str], str] = {}
    for seg in segments or []:
        if not isinstance(seg, dict):
            continue
        name = normalize_profile_name(seg.get("name"))
        seg_type = str(seg.get("type") or "").strip().lower()
        if not name or seg_type not in _CLASS_TYPES:
            continue
        direction = normalize_profile_direction(seg.get("direction"), seg.get("name"))
        indexed[(name, direction)] = seg_type
    return indexed


def choose_profile_index(
    scored_sprints: list[dict[str, Any]],
    catalogs: list[list[dict[str, Any]]],
) -> dict[tuple[str, str], str]:
    """Pick the elevation profile whose segment names overlap this race the most."""
    names = {
        normalize_profile_name(s.get("name"))
        for s in scored_sprints
        if isinstance(s, dict) and normalize_profile_name(s.get("name"))
    }
    if not names or not catalogs:
        return {}
    best: dict[tuple[str, str], str] = {}
    best_score = 0
    for catalog in catalogs:
        indexed = index_profile_segments(catalog)
        catalog_names = {key[0] for key in indexed}
        score = len(names & catalog_names)
        if score > best_score:
            best = indexed
            best_score = score
    return best


def banner_class(sprint: dict[str, Any], index: dict[tuple[str, str], str]) -> str | None:
    """Return 'sprint', 'kom', or None (segment / unmatched)."""
    name = normalize_profile_name(sprint.get("name"))
    if not name or not index:
        return None
    direction = normalize_profile_direction(sprint.get("direction"), sprint.get("name"))
    seg_type = index.get((name, direction))
    if seg_type is None:
        hits = [typ for (seg_name, _direction), typ in index.items() if seg_name == name]
        unique = set(hits)
        if len(unique) == 1:
            seg_type = hits[0]
    if seg_type == "sprint":
        return "sprint"
    if seg_type == "climb":
        return "kom"
    return None


def _sprint_keys(sprint: dict[str, Any]) -> list[str]:
    keys: list[str] = []
    if sprint.get("key"):
        keys.append(str(sprint["key"]))
    if sprint.get("id") is not None and sprint.get("count") is not None:
        keys.append(f"{sprint['id']}_{sprint['count']}")
    if sprint.get("id") is not None:
        keys.append(str(sprint["id"]))
    return keys


def _points_value(raw: Any) -> int:
    if isinstance(raw, bool) or not isinstance(raw, (int, float)):
        return 0
    if raw <= 0 or raw > _SPLIT_TIME_FLOOR:
        return 0
    return int(raw)


def points_for_rider(
    rider: dict[str, Any],
    sprints: list[dict[str, Any]],
    index: dict[tuple[str, str], str],
) -> tuple[int, int]:
    details = rider.get("sprintDetails") or {}
    if not isinstance(details, dict) or not index:
        return 0, 0
    key_class: dict[str, str | None] = {}
    for sprint in sprints:
        if not isinstance(sprint, dict):
            continue
        cls = banner_class(sprint, index)
        for key in _sprint_keys(sprint):
            key_class.setdefault(key, cls)
    sprint_points = 0
    kom_points = 0
    for key, raw in details.items():
        points = _points_value(raw)
        if points <= 0:
            continue
        cls = key_class.get(str(key))
        if cls == "sprint":
            sprint_points += points
        elif cls == "kom":
            kom_points += points
    return sprint_points, kom_points


def _blank_entry(zwift_id: str, name: str) -> dict[str, Any]:
    return {
        "zwiftId": zwift_id,
        "name": name,
        "totalPoints": 0,
        "raceCount": 0,
        "results": [],
        "lastRacePoints": 0,
        "lastRaceDate": None,
        "sprintPoints": 0,
        "komPoints": 0,
        "sprintResults": [],
        "komResults": [],
    }


def _ensure_classification_fields(entry: dict[str, Any]) -> None:
    entry["sprintPoints"] = int(entry.get("sprintPoints") or 0)
    entry["komPoints"] = int(entry.get("komPoints") or 0)
    entry["sprintResults"] = list(entry.get("sprintResults") or [])
    entry["komResults"] = list(entry.get("komResults") or [])


def _race_counts(race: dict[str, Any], *, season_mode: bool, stage_race_ids: set[str]) -> bool:
    phase = str(race.get("resultsPhase") or "").strip().lower()
    if season_mode:
        parent = str(race.get("stageRaceId") or "")
        if parent not in stage_race_ids:
            return False
        return phase == RESULTS_PHASE_FINALIZED
    if phase and phase != RESULTS_PHASE_FINALIZED:
        return False
    return bool(race.get("results"))


def _skipped_ids(race: dict[str, Any]) -> set[str]:
    skipped: set[str] = set()
    for field in ("manualDQs", "manualDeclassifications", "manualExclusions"):
        for value in race.get(field) or []:
            skipped.add(str(value))
    return skipped


def apply_classification_standings(
    standings: dict[str, list[dict[str, Any]]],
    races_by_id: dict[str, dict[str, Any]],
    *,
    season_mode: bool,
    stage_race_ids: set[str],
    catalogs: list[list[dict[str, Any]]],
) -> dict[str, list[dict[str, Any]]]:
    """Attach sprintPoints / komPoints onto a freshly built standings table.

    Rider order from the prestige table is kept. Riders who only scored
    sprint or KOM points are appended.
    """
    order_by_category: dict[str, list[dict[str, Any]]] = {}
    riders_by_category: dict[str, dict[str, dict[str, Any]]] = {}
    for category, riders in (standings or {}).items():
        if not isinstance(riders, list):
            continue
        riders_by_category[category] = {}
        order_by_category[category] = []
        for rider in riders:
            if not isinstance(rider, dict):
                continue
            zid = str(rider.get("zwiftId") or "")
            if not zid or zid in riders_by_category[category]:
                continue
            _ensure_classification_fields(rider)
            riders_by_category[category][zid] = rider
            order_by_category[category].append(rider)

    for race_id, race in races_by_id.items():
        if not isinstance(race, dict):
            continue
        if not _race_counts(race, season_mode=season_mode, stage_race_ids=stage_race_ids):
            continue
        results = race.get("results") or {}
        if not isinstance(results, dict):
            continue
        skipped = _skipped_ids(race)
        for category, riders in results.items():
            if not isinstance(riders, list):
                continue
            if CategoryConfigResolver.get_segment_type(race, str(category)) == "split":
                continue
            sprints = CategoryConfigResolver.get_sprints(race, str(category)) or []
            index = choose_profile_index(sprints, catalogs)
            if not index:
                continue
            if category not in riders_by_category:
                riders_by_category[category] = {}
                order_by_category[category] = []
            for rider in riders:
                if not isinstance(rider, dict):
                    continue
                zid = str(rider.get("zwiftId") or "")
                if not zid or zid in skipped:
                    continue
                sprint_points, kom_points = points_for_rider(rider, sprints, index)
                if sprint_points <= 0 and kom_points <= 0:
                    continue
                entry = riders_by_category[category].get(zid)
                if entry is None:
                    entry = _blank_entry(zid, str(rider.get("name") or ""))
                    riders_by_category[category][zid] = entry
                    order_by_category[category].append(entry)
                elif rider.get("name") and not entry.get("name"):
                    entry["name"] = rider.get("name")
                if sprint_points > 0:
                    entry["sprintPoints"] = int(entry.get("sprintPoints") or 0) + sprint_points
                    entry["sprintResults"].append({"raceId": str(race.get("id") or race_id), "points": sprint_points})
                if kom_points > 0:
                    entry["komPoints"] = int(entry.get("komPoints") or 0) + kom_points
                    entry["komResults"].append({"raceId": str(race.get("id") or race_id), "points": kom_points})

    final: dict[str, list[dict[str, Any]]] = {}
    for category, ordered in order_by_category.items():
        final[category] = ordered
    return final


def load_profile_catalogs(db: Any) -> list[list[dict[str, Any]]]:
    catalogs: list[list[dict[str, Any]]] = []
    if db is None:
        return catalogs
    try:
        docs = db.collection("elevation_cache").stream()
    except Exception as exc:
        logger.error("Could not load elevation_cache for sprint/KOM classification: %s", exc)
        return catalogs
    for doc in docs:
        data = doc.to_dict() or {}
        segments = data.get("profileSegments")
        if isinstance(segments, list) and segments:
            catalogs.append(segments)
    return catalogs
