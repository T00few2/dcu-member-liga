"""Event inspection shaping and the admin route."""
from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.event_inspect import event_dump, inspect_document, steering_from_tags  # noqa: E402


DICTIONARY = {
    "ROUTES": {"ROUTE": [{
        "signature": 3600776267,
        "name": "Neon Shore Loop",
        "map": "MAKURIISLANDS",
        "distanceInMeters": "32951",
        "ascentInMeters": "253",
        "leadinDistanceInMeters": "1124",
        "leadinAscentInMeters": "5",
    }]},
    "BIKEFRAMES": {"BIKEFRAME": [{"signature": 3371227947, "name": "Specialized S-Works Tarmac SL9"}]},
    "BIKEFRONTWHEELS": {"BIKEFRONTWHEEL": []},
    "BIKEREARWHEELS": {"BIKEREARWHEEL": []},
    "JERSEYS": {"JERSEY": [{"signature": 1287196397, "name": "Danish Cycling Member"}]},
}


def _event(**extra):
    base = {
        "id": 5780631,
        "name": "DCU race",
        "description": "Mass start",
        "eventStart": "2026-11-11T18:00:00.000+00:00",
        "sport": "CYCLING",
        "type": "EVENT_TYPE_RACE",
        "eventSecret": "secret-value",
        "worldId": 1,
        "mapId": 9,
        "routeId": 3600776267,
        "laps": 1,
        "distanceInMeters": 0,
        "bikeHash": 3371227947,
        "rulesSet": ["ENFORCE_HRM", "NO_POWERUPS"],
        "rulesId": 10305,
        "cullingType": "CULLING_SUBGROUP_ONLY",
        "lateJoinInMinutes": 30,
        "tags": ["showplacements", "completionprize1=1287196397", "bike_grams=1970"],
        "totalSignedUpCount": 10,
        "totalJoinedCount": 8,
        "eventSubgroups": [{
            "id": 7,
            "subgroupLabel": "A",
            "name": "1. Division",
            "eventSubgroupStart": "2026-11-11T18:00:00.000+00:00",
            "routeId": 3600776267,
            "laps": 1,
            "tags": ["showplacements"],
            "rulesSet": ["NO_POWERUPS"],
            "totalSignedUpCount": 4,
            "totalJoinedCount": 3,
        }],
    }
    base.update(extra)
    return base


def test_a_missing_steering_tag_means_steering_is_enabled():
    assert steering_from_tags(["showplacements"]) == "enabled"
    viewed = inspect_document(_event(), DICTIONARY)
    assert viewed["steering"] == "enabled"
    assert viewed["routeName"] == "Neon Shore Loop"
    assert viewed["routeWorld"] == "Makuri Islands"
    assert viewed["world"] == "Watopia"
    assert viewed["bikeName"] == "Specialized S-Works Tarmac SL9"
    assert viewed["unlocks"] == [{"tag": "completionprize1=1287196397", "name": "Danish Cycling Member"}]
    assert "eventSecret" not in viewed["raw"]
    assert viewed["subgroups"][0]["label"] == "A"


def test_steering_disabled_is_read_from_the_tag():
    viewed = inspect_document(_event(tags=["steering_disabled", "nobraking"]), None)
    assert viewed["steering"] == "disabled"
    assert viewed["brakingDisabled"] is True


def test_the_join_secret_is_left_out_of_the_dump():
    dumped = event_dump({"id": 1, "eventSecret": "abc", "name": "Race"})
    assert "eventSecret" not in dumped
    assert dumped["name"] == "Race"


def test_admin_route_returns_the_inspection(monkeypatch):
    from routes.admin import admin_bp
    import routes.admin_event_inspect_routes as route

    monkeypatch.setattr(route, "require_admin", lambda _req: {"admin": True})
    monkeypatch.setattr(route, "load_event", lambda event_id: _event(id=event_id))
    game = MagicMock()
    game.get_game_dictionary.return_value = DICTIONARY
    monkeypatch.setattr(route, "get_zwift_game_service", lambda: game)

    app = Flask(__name__)
    app.register_blueprint(admin_bp)
    response = app.test_client().get("/admin/zwift/events/5780631")
    assert response.status_code == 200
    body = response.get_json()
    assert body["id"] == 5780631
    assert body["steering"] == "enabled"
    assert "eventSecret" not in body["raw"]


def test_admin_route_reports_a_zwift_failure(monkeypatch):
    from services.event_inspect import EventInspectError
    import routes.admin_event_inspect_routes as route

    monkeypatch.setattr(route, "require_admin", lambda _req: {"admin": True})
    monkeypatch.setattr(route, "load_event", MagicMock(side_effect=EventInspectError("Zwift has no event 9", 404)))

    app = Flask(__name__)
    from routes.admin import admin_bp
    app.register_blueprint(admin_bp)
    response = app.test_client().get("/admin/zwift/events/9")
    assert response.status_code == 404
    assert response.get_json()["message"] == "Zwift has no event 9"
