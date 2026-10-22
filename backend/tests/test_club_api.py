"""Club API credentials and the current-season reads."""

from __future__ import annotations

import base64
import copy
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

import routes.club_api as club_routes
from services import club_api_auth


@pytest.fixture(autouse=True)
def fast_hash(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(club_api_auth, "PBKDF2_ITERATIONS", 1000)


def _dig(data: dict, field: str):
    current = data
    for part in field.split("."):
        if not isinstance(current, dict):
            return None
        current = current.get(part)
    return current


class _Doc:
    def __init__(self, doc_id: str, data: dict | None) -> None:
        self.id = doc_id
        self._data = data
        self.exists = data is not None

    def to_dict(self):
        if self._data is None:
            return None
        return copy.deepcopy(self._data)


class _Ref:
    def __init__(self, store: dict, collection: str, doc_id: str) -> None:
        self.store = store
        self.collection = collection
        self.id = doc_id

    def get(self) -> _Doc:
        data = self.store.setdefault(self.collection, {}).get(self.id)
        return _Doc(self.id, data)

    def set(self, data: dict, merge: bool = False) -> None:
        col = self.store.setdefault(self.collection, {})
        if merge and isinstance(col.get(self.id), dict):
            merged = copy.deepcopy(col[self.id])
            merged.update(data)
            col[self.id] = merged
            return
        col[self.id] = copy.deepcopy(data)

    def update(self, data: dict) -> None:
        self.store[self.collection][self.id].update(copy.deepcopy(data))


class _Query:
    def __init__(self, docs: list[_Doc]) -> None:
        self._docs = docs

    def where(self, field: str, op: str, value) -> "_Query":
        assert op == "=="
        matched = [doc for doc in self._docs if _dig(doc.to_dict() or {}, field) == value]
        return _Query(matched)

    def limit(self, count: int) -> "_Query":
        return _Query(self._docs[:count])

    def stream(self):
        return iter(self._docs)


class _Collection:
    def __init__(self, store: dict, name: str) -> None:
        self.store = store
        self.name = name

    def document(self, doc_id: str) -> _Ref:
        return _Ref(self.store, self.name, str(doc_id))

    def stream(self):
        col = self.store.get(self.name, {})
        return iter(_Doc(doc_id, data) for doc_id, data in col.items())

    def where(self, field: str, op: str, value) -> _Query:
        return _Query(list(self.stream())).where(field, op, value)


class MemoryDb:
    def __init__(self) -> None:
        self.store: dict = {}

    def collection(self, name: str) -> _Collection:
        return _Collection(self.store, name)


def _user(zwift_id: str, club: str, category: str, status: str = "complete") -> dict:
    return {
        "zwiftId": zwift_id,
        "club": club,
        "registration": {"status": status},
        "ligaCategory": {"locked": True, "category": category},
    }


def _seed(db: MemoryDb) -> None:
    db.collection("league").document("settings").set({
        "ligaCategories": [{"name": "A", "upper": None}, {"name": "B", "upper": 400}],
        "seasonBestResultsCount": 1,
    })
    db.collection("league").document("standings").set({
        "standings": {
            "A": [
                {
                    "zwiftId": "3",
                    "name": "Their Rider",
                    "totalPoints": 100,
                    "raceCount": 1,
                    "results": [{"raceId": "race-1", "points": 100, "source": "stage"}],
                },
                {
                    "zwiftId": "1",
                    "name": "Ours A",
                    "totalPoints": 40,
                    "raceCount": 2,
                    "results": [
                        {"raceId": "race-1", "points": 30, "source": "stage"},
                        {"raceId": "race-2", "points": 10, "source": "stage"},
                    ],
                },
                {
                    "zwiftId": "6",
                    "name": "Ours Six",
                    "totalPoints": 80,
                    "raceCount": 1,
                    "results": [{"raceId": "race-1", "points": 80, "source": "stage"}],
                },
                {
                    "zwiftId": "8",
                    "name": "Moved",
                    "totalPoints": 500,
                    "raceCount": 1,
                    "results": [{"raceId": "race-1", "points": 500, "source": "stage"}],
                },
            ],
            "B": [
                {
                    "zwiftId": "2",
                    "name": "Ours B",
                    "totalPoints": 10,
                    "raceCount": 1,
                    "results": [{"raceId": "race-1", "points": 10, "source": "stage"}],
                },
                {
                    "zwiftId": "8",
                    "name": "Moved",
                    "totalPoints": 5,
                    "raceCount": 1,
                    "results": [{"raceId": "race-2", "points": 5, "source": "stage"}],
                },
                {
                    "zwiftId": "10",
                    "name": "Third Rider",
                    "totalPoints": 1,
                    "raceCount": 1,
                    "results": [{"raceId": "race-1", "points": 1, "source": "stage"}],
                },
            ],
        }
    })
    db.collection("stageRaces").document("event-1").set({"name": "Tour de Test"})
    db.collection("races").document("race-1").set({
        "name": "Stage two",
        "date": "2026-05-02T15:00:00+00:00",
        "resultsPhase": "finalized",
        "stageRaceId": "event-1",
        "stageIndex": 2,
        "eventSecret": "do-not-leak",
        "results": {
            "B": [
                {"zwiftId": "2", "name": "Ours B", "club": "ours", "finishTime": 4000, "finishPoints": 5, "totalPoints": 5},
            ],
            "A": [
                {"zwiftId": "3", "name": "Their Rider", "club": "Theirs", "finishTime": 1000, "finishPoints": 10, "totalPoints": 10, "criticalP": {"5": 999}},
                {"zwiftId": "1", "name": "Ours A", "club": "Ours", "finishTime": 2000, "finishPoints": 8, "sprintPoints": 1, "totalPoints": 9, "sprintDetails": {"ban": 12.5}},
                {"zwiftId": "9", "name": "Stamped Other", "club": "Theirs", "finishTime": 2100},
                {"zwiftId": "5", "name": "Fallback", "finishTime": 3000, "finishPoints": 1, "totalPoints": 1},
                {"zwiftId": "11", "name": "Transfer", "club": "Ours", "raceStatus": "XFER", "categoryTransfer": True, "finishRank": 12, "finishTime": 0, "declassified": True},
            ],
        },
    })
    db.collection("races").document("race-2").set({
        "name": "Tuesday",
        "date": "2026-05-09T15:00:00+00:00",
    })
    db.collection("races").document("race-empty").set({"name": "No results", "date": "2026-05-01T15:00:00+00:00"})
    users = {
        "1": _user("1", "Ours", "A"),
        "2": _user("2", "Ours", "B"),
        "3": _user("3", "Theirs", "A"),
        "4": _user("4", "Ours", "A", status="draft"),
        "5": _user("5", "Ours", "A"),
        "6": _user("6", "Ours", "A"),
        "8": _user("8", "Ours", "B"),
        "9": _user("9", "Ours", "A"),
        "10": _user("10", "Third", "B"),
        "11": _user("11", "Ours", "A"),
    }
    for doc_id, data in users.items():
        db.collection("users").document(doc_id).set(data)


def _basic(username: str, secret: str) -> dict[str, str]:
    token = base64.b64encode(f"{username}:{secret}".encode()).decode()
    return {"Authorization": f"Basic {token}"}


@pytest.fixture
def api(monkeypatch: pytest.MonkeyPatch):
    database = MemoryDb()
    _seed(database)
    monkeypatch.setattr(club_routes, "db", database)
    monkeypatch.setattr(club_routes, "require_admin", lambda _request: {"admin": True})
    app = Flask(__name__)
    app.register_blueprint(club_routes.club_api_bp)
    return app.test_client(), database


def _create(client) -> tuple[str, str]:
    response = client.post("/admin/club-api/clients", json={"club": " ours ", "username": "ExampleClub"})
    assert response.status_code == 200
    body = response.get_json()
    return body["client"]["username"], body["secret"]


def test_create_rejects_a_colon_and_stores_only_a_hash(api) -> None:
    client, database = api
    rejected = client.post("/admin/club-api/clients", json={"club": "Ours", "username": "bad:name"})
    assert rejected.status_code == 400

    username, secret = _create(client)
    assert username == "exampleclub"
    stored = database.store["clubApiClients"][username]
    assert "secret" not in stored
    assert secret not in stored.values()
    assert club_api_auth.secrets_match(secret, stored["salt"], stored["secretHash"])

    duplicate = client.post("/admin/club-api/clients", json={"club": "Ours", "username": "another"})
    assert duplicate.status_code == 409

    listed = client.get("/admin/club-api/clients")
    listed_body = listed.get_data(as_text=True)
    assert secret not in listed_body
    assert "secretHash" not in listed_body
    assert "salt" not in listed_body

    rotated = client.post(f"/admin/club-api/clients/{username}/rotate")
    assert rotated.status_code == 200
    new_secret = rotated.get_json()["secret"]
    assert new_secret != secret
    assert client.get("/club-api", headers=_basic(username, secret)).status_code == 401
    assert client.get("/club-api", headers=_basic(username, new_secret)).status_code == 200


def test_wrong_secret_and_revoked_client(api) -> None:
    client, _database = api
    username, secret = _create(client)

    missing = client.get("/club-api")
    assert missing.status_code == 401
    assert "HTTP Basic" in missing.get_json()["message"]

    wrong = client.get("/club-api", headers=_basic(username, "not-the-secret"))
    assert wrong.status_code == 401

    described = client.get("/club-api", headers=_basic(username, secret))
    assert described.status_code == 200
    body = described.get_json()
    assert body["club"] == "Ours"
    assert body["version"] == 1
    assert body["limit"]["requests"] == 60
    assert body["limit"]["windowSeconds"] == 60
    assert any(row["path"] == "/club-api/standings" for row in body["reads"])
    assert "finishTime" in body["glossary"]
    assert "clubScore" in body["glossary"]

    revoked = client.post(f"/admin/club-api/clients/{username}/revoke")
    assert revoked.status_code == 200
    blocked = client.get("/club-api/races", headers=_basic(username, secret))
    assert blocked.status_code == 403

    restored = client.post(f"/admin/club-api/clients/{username}/restore")
    assert restored.status_code == 200
    assert client.get("/club-api/races", headers=_basic(username, secret)).status_code == 200


def test_race_index_names_a_stage_and_has_no_rider_rows(api) -> None:
    client, _database = api
    username, secret = _create(client)
    response = client.get("/club-api/races", headers=_basic(username, secret))
    assert response.status_code == 200
    races = response.get_json()["races"]
    assert [race["id"] for race in races] == ["race-1"]
    assert races[0]["stageRaceName"] == "Tour de Test"
    assert races[0]["stageIndex"] == 2
    assert "results" not in races[0]
    assert "riders" not in races[0]


def test_one_race_keeps_full_field_places_across_divisions(api) -> None:
    client, _database = api
    username, secret = _create(client)
    missing = client.get("/club-api/races/missing/results", headers=_basic(username, secret))
    assert missing.status_code == 404

    response = client.get("/club-api/races/race-1/results", headers=_basic(username, secret))
    assert response.status_code == 200
    body = response.get_json()
    assert "eventSecret" not in response.get_data(as_text=True)
    assert "criticalP" not in response.get_data(as_text=True)
    assert "glossary" not in body
    assert [division["category"] for division in body["divisions"]] == ["A", "B"]

    division_a, division_b = body["divisions"]
    assert division_b["fieldSize"] == 1
    assert division_b["winnerFinishTime"] == 4000
    assert [rider["zwiftId"] for rider in division_b["riders"]] == ["2"]
    assert division_b["riders"][0]["position"] == 1

    assert division_a["fieldSize"] == 5
    assert division_a["winnerFinishTime"] == 1000
    by_id = {rider["zwiftId"]: rider for rider in division_a["riders"]}
    assert set(by_id) == {"1", "5", "11"}
    assert by_id["1"]["position"] == 2
    assert by_id["1"]["sprintDetails"] == {"ban": 12.5}
    assert by_id["5"]["position"] == 4
    assert by_id["5"]["club"] == "Ours"
    assert by_id["11"]["position"] == 12
    assert by_id["11"]["categoryTransfer"] is True
    assert by_id["11"]["declassified"] is True


def test_season_position_is_the_full_division_place(api) -> None:
    client, _database = api
    username, secret = _create(client)
    response = client.get("/club-api/standings", headers=_basic(username, secret))
    assert response.status_code == 200
    divisions = {row["category"]: row["riders"] for row in response.get_json()["divisions"]}
    by_id = {rider["zwiftId"]: rider for rider in divisions["A"]}
    assert set(by_id) == {"8", "6", "1"}
    assert by_id["6"]["position"] == 3
    assert by_id["1"]["position"] == 4
    assert by_id["1"]["totalPoints"] == 40
    lines = {line["raceId"]: line for line in by_id["1"]["results"]}
    assert lines["race-1"]["raceName"] == "Stage two"
    assert lines["race-1"]["counting"] is True
    assert lines["race-2"]["raceName"] == "Tuesday"
    assert lines["race-2"]["counting"] is False
    assert divisions["B"][0]["zwiftId"] == "2"
    assert divisions["B"][0]["position"] == 1


def test_club_table_uses_the_top_three_rule(api) -> None:
    client, _database = api
    username, secret = _create(client)
    response = client.get("/club-api/club-standings", headers=_basic(username, secret))
    assert response.status_code == 200
    clubs = response.get_json()["clubs"]
    ours = next(row for row in clubs if row["yours"])
    assert ours["club"] == "Ours"
    assert ours["rank"] == 1
    assert ours["points"] == 130
    assert [rider["points"] for rider in ours["riders"]] == [80, 40, 10]
    assert clubs[1]["club"] == "Theirs"
    assert clubs[1]["points"] == 100
    assert clubs[1]["yours"] is False


def test_rate_limit_allows_sixty_calls_in_a_minute(api) -> None:
    client, database = api
    username, secret = _create(client)
    now = datetime.now(timezone.utc).replace(microsecond=0)
    database.store["clubApiClients"][username]["requestTimes"] = [
        (now - timedelta(seconds=index)).isoformat() for index in range(60)
    ]

    blocked = client.get("/club-api", headers=_basic(username, secret))
    assert blocked.status_code == 429
    assert "60" in blocked.get_json()["message"]
    assert int(blocked.headers["Retry-After"]) >= 1
    assert len(database.store["clubApiClients"][username]["requestTimes"]) == 60

    database.store["clubApiClients"][username]["requestTimes"] = [
        (now - timedelta(seconds=120)).isoformat()
    ]
    allowed = client.get("/club-api", headers=_basic(username, secret))
    assert allowed.status_code == 200
    assert len(database.store["clubApiClients"][username]["requestTimes"]) == 1


def test_decide_rate_limit_drops_a_call_from_a_minute_ago() -> None:
    now = datetime(2026, 10, 22, 20, 0, tzinfo=timezone.utc)
    expired = (now - timedelta(seconds=60)).isoformat()
    opened = club_api_auth.decide_rate_limit([expired], now)
    assert opened.allowed is True
    assert len(opened.times) == 1

    recent = [(now - timedelta(seconds=59 - index)).isoformat() for index in range(60)]
    blocked = club_api_auth.decide_rate_limit(recent, now)
    assert blocked.allowed is False
    assert blocked.retry_after == 1
