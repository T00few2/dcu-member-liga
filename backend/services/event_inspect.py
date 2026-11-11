"""Read one Zwift event the way the organizer account sees it.

The public events API hides unlisted races unless a secret is sent. The
events-core document is what Zwift stores: tags, rules, bike, and categories.
"""
from __future__ import annotations

import copy
import os
import re
from typing import Any

import requests

from services.zwift_drop_levels import DropLevelAuthError, game_client_access_token

ZWIFT_API_BASE = os.environ.get("ZWIFT_API_BASE_URL", "https://us-or-rly101.zwift.com").rstrip("/")

WORLD_LABELS = {
    "WATOPIA": "Watopia",
    "RICHMOND": "Richmond",
    "LONDON": "London",
    "NEWYORK": "New York",
    "INNSBRUCK": "Innsbruck",
    "BOLOGNA": "Bologna",
    "YORKSHIRE": "Yorkshire",
    "CRIT_CITY": "Crit City",
    "MAKURI_ISLANDS": "Makuri Islands",
    "FRANCE": "France",
    "PARIS": "Paris",
    "SCOTLAND": "Scotland",
}
WORLD_IDS = {
    1: "Watopia",
    2: "Richmond",
    3: "London",
    4: "New York",
    5: "Innsbruck",
    6: "Bologna",
    7: "Yorkshire",
    8: "Crit City",
    9: "Makuri Islands",
    10: "France",
    11: "Paris",
    13: "Scotland",
}

UNLOCK_TAGS = {"jerseyunlock"}
UNLOCK_PREFIXES = ("completionprize", "head_gear=", "socks=", "running_shirts=")

GEAR_SECTIONS = {
    "bike": ("BIKEFRAMES", "BIKEFRAME"),
    "frontWheel": ("BIKEFRONTWHEELS", "BIKEFRONTWHEEL"),
    "rearWheel": ("BIKEREARWHEELS", "BIKEREARWHEEL"),
    "jersey": ("JERSEYS", "JERSEY"),
}


class EventInspectError(Exception):
    def __init__(self, message: str, status_code: int = 502):
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def _folded(value: Any) -> str:
    return re.sub(r"[^A-Z]", "", str(value or "").upper())


def world_label(code: Any) -> str | None:
    folded = _folded(code)
    if not folded:
        return None
    for key, label in WORLD_LABELS.items():
        if _folded(key) == folded:
            return label
    return str(code)


def world_from_id(value: Any) -> str | None:
    try:
        return WORLD_IDS.get(int(value))
    except (TypeError, ValueError):
        return world_label(value)


def steering_from_tags(tags: Any) -> str:
    """Zwift writes steering_disabled only when steering is off."""
    for tag in tags or []:
        if str(tag).strip().lower() == "steering_disabled":
            return "disabled"
    return "enabled"


def _tag_value(tags: list[str], key: str) -> str | None:
    prefix = f"{key}="
    for tag in tags:
        if tag.startswith(prefix):
            return tag[len(prefix):]
    return None


def _has_tag(tags: list[str], key: str) -> bool:
    wanted = key.lower()
    return any(tag.lower() == wanted for tag in tags)


def _is_unlock(tag: str) -> bool:
    return tag in UNLOCK_TAGS or tag.startswith(UNLOCK_PREFIXES)


def _number(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _tags(raw: Any) -> list[str]:
    return [str(tag).strip() for tag in (raw or []) if str(tag).strip()]


def event_dump(event: dict) -> dict:
    dumped = copy.deepcopy(event) if isinstance(event, dict) else {}
    dumped.pop("eventSecret", None)
    return dumped


def _signature_name(dictionary: dict | None, section: str, item_key: str, signature: Any) -> str | None:
    try:
        wanted = int(signature)
    except (TypeError, ValueError):
        return None
    items = ((dictionary or {}).get(section) or {}).get(item_key) or []
    for item in items:
        try:
            if int(item.get("signature")) == wanted:
                name = item.get("name")
                return str(name) if name else None
        except (TypeError, ValueError, AttributeError):
            continue
    return None


def _route(dictionary: dict | None, route_id: Any) -> dict | None:
    try:
        wanted = int(route_id)
    except (TypeError, ValueError):
        return None
    for route in ((dictionary or {}).get("ROUTES") or {}).get("ROUTE") or []:
        signature = route.get("signature") or route.get("routeSignature")
        try:
            if int(signature) == wanted:
                return route
        except (TypeError, ValueError):
            continue
    return None


def _physics(tags: list[str]) -> dict[str, str | None]:
    return {
        "frameGrams": _tag_value(tags, "bike_grams"),
        "frameCdaBias": _tag_value(tags, "bike_cda_bias"),
        "frontWheelGrams": _tag_value(tags, "front_wheel_grams"),
        "frontWheelCdaBias": _tag_value(tags, "front_wheel_cda_bias"),
        "frontWheelCrr": _tag_value(tags, "front_wheel_crr"),
        "rearWheelGrams": _tag_value(tags, "rear_wheel_grams"),
        "rearWheelCdaBias": _tag_value(tags, "rear_wheel_cda_bias"),
        "rearWheelCrr": _tag_value(tags, "rear_wheel_crr"),
    }


def _unlocks(tags: list[str], dictionary: dict | None) -> list[dict[str, str | None]]:
    named = []
    for tag in tags:
        if not _is_unlock(tag):
            continue
        name = None
        if "=" in tag:
            name = _signature_name(dictionary, *GEAR_SECTIONS["jersey"], tag.split("=", 1)[1])
        named.append({"tag": tag, "name": name})
    return named


def _course(source: dict, dictionary: dict | None, fallback_world: Any = None) -> dict[str, Any]:
    route = _route(dictionary, source.get("routeId")) or {}
    world_id = source.get("worldId")
    if world_id is None:
        world_id = fallback_world
    return {
        "routeId": source.get("routeId"),
        "routeName": route.get("name"),
        "routeMap": route.get("map"),
        "routeWorld": world_label(route.get("map")),
        "routeDistanceInMeters": _number(route.get("distanceInMeters")),
        "routeAscentInMeters": _number(route.get("ascentInMeters")),
        "leadInDistanceInMeters": _number(route.get("leadinDistanceInMeters")),
        "leadInAscentInMeters": _number(route.get("leadinAscentInMeters")),
        "mapId": source.get("mapId"),
        "worldId": source.get("worldId"),
        "world": world_from_id(world_id) or world_from_id(source.get("mapId")),
        "laps": source.get("laps"),
        "distanceInMeters": source.get("distanceInMeters"),
        "durationInSeconds": source.get("durationInSeconds"),
    }


def _equipment(tags: list[str], bike_hash: Any, dictionary: dict | None) -> dict[str, Any]:
    front = _tag_value(tags, "fwheel_override")
    rear = _tag_value(tags, "rwheel_override")
    return {
        "bikeHash": bike_hash,
        "bikeName": _signature_name(dictionary, *GEAR_SECTIONS["bike"], bike_hash),
        "frontWheelHash": front,
        "frontWheelName": _signature_name(dictionary, *GEAR_SECTIONS["frontWheel"], front),
        "rearWheelHash": rear,
        "rearWheelName": _signature_name(dictionary, *GEAR_SECTIONS["rearWheel"], rear),
        "upgradePhysicsDisabled": _has_tag(tags, "disable_bike_upgrade_physics"),
        "physics": _physics(tags),
        "steering": steering_from_tags(tags),
        "brakingDisabled": _has_tag(tags, "nobraking"),
    }


def _subgroup(subgroup: dict, dictionary: dict | None, fallback_world: Any) -> dict[str, Any]:
    tags = _tags(subgroup.get("tags"))
    return {
        "id": subgroup.get("id"),
        "name": subgroup.get("name"),
        "label": subgroup.get("subgroupLabel"),
        "eventStart": subgroup.get("eventSubgroupStart"),
        "registrationStart": subgroup.get("registrationStart"),
        "registrationEnd": subgroup.get("registrationEnd"),
        "lineUpStart": subgroup.get("lineUpStart"),
        "lineUpEnd": subgroup.get("lineUpEnd"),
        "startLocation": subgroup.get("startLocation"),
        "lateJoinInMinutes": subgroup.get("lateJoinInMinutes"),
        "rangeAccessLabel": subgroup.get("rangeAccessLabel"),
        "rulesId": subgroup.get("rulesId"),
        "rules": list(subgroup.get("rulesSet") or []),
        "signedUpCount": subgroup.get("totalSignedUpCount"),
        "joinedCount": subgroup.get("totalJoinedCount"),
        "unlocks": _unlocks(tags, dictionary),
        "tags": [tag for tag in tags if not _is_unlock(tag)],
        **_equipment(tags, subgroup.get("bikeHash"), dictionary),
        **_course(subgroup, dictionary, fallback_world),
    }


def inspect_document(event: dict, dictionary: dict | None = None) -> dict[str, Any]:
    """Fields the admin modal shows, plus Zwift's document without the join secret."""
    tags = _tags(event.get("tags"))
    event_id = event.get("id")
    return {
        "id": event_id,
        "name": event.get("name"),
        "description": event.get("description") or "",
        "type": event.get("type") or event.get("eventType"),
        "sport": event.get("sport"),
        "eventStart": event.get("eventStart"),
        "imageUrl": event.get("imageUrl"),
        "rulesId": event.get("rulesId"),
        "rules": list(event.get("rulesSet") or []),
        "cullingType": event.get("cullingType"),
        "lateJoinInMinutes": event.get("lateJoinInMinutes"),
        "visible": event.get("visible"),
        "privateEvent": event.get("privateEvent"),
        "unlisted": event.get("unlisted"),
        "restricted": event.get("restricted"),
        "invisibleToNonParticipants": event.get("invisibleToNonParticipants"),
        "categoryEnforcement": event.get("categoryEnforcement"),
        "accessExpression": event.get("accessExpression"),
        "rangeAccessLabel": event.get("rangeAccessLabel"),
        "partnerClientId": event.get("partnerClientId"),
        "signedUpCount": event.get("totalSignedUpCount"),
        "joinedCount": event.get("totalJoinedCount"),
        "unlocks": _unlocks(tags, dictionary),
        "tags": [tag for tag in tags if not _is_unlock(tag)],
        "url": f"https://www.zwift.com/events/view/{int(event_id)}" if event_id else None,
        "subgroups": [
            _subgroup(subgroup, dictionary, event.get("worldId"))
            for subgroup in event.get("eventSubgroups") or []
        ],
        "raw": event_dump(event),
        **_equipment(tags, event.get("bikeHash"), dictionary),
        **_course(event, dictionary),
    }


def load_event(event_id: int) -> dict:
    """Organizer event document. Raises EventInspectError when Zwift cannot be read."""
    try:
        token = game_client_access_token()
    except DropLevelAuthError as exc:
        raise EventInspectError(str(exc), 502) from exc
    try:
        response = requests.get(
            f"{ZWIFT_API_BASE}/api/events-core/events/{int(event_id)}",
            headers={"Authorization": f"Bearer {token}", "Accept": "application/json"},
            params={"skipDefaults": "true"},
            timeout=30,
        )
    except requests.RequestException as exc:
        raise EventInspectError("Zwift did not answer", 502) from exc
    if response.status_code == 404:
        raise EventInspectError(f"Zwift has no event {event_id}", 404)
    if response.status_code != 200:
        raise EventInspectError(f"Zwift could not read event {event_id} ({response.status_code})", 502)
    try:
        payload = response.json()
    except ValueError as exc:
        raise EventInspectError("Zwift returned an unreadable event", 502) from exc
    event = payload.get("eventData") if isinstance(payload, dict) and "eventData" in payload else payload
    if not isinstance(event, dict):
        raise EventInspectError("Zwift returned an unreadable event", 502)
    return event
