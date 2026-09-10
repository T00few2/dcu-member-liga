"""Tests for Zwift-only stream dummy riders."""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import live_race  # noqa: E402
from services import stream_riders as sr  # noqa: E402


THE_CLASSIC_RACE = {
    "eventMode": "grouped",
    "raceGroups": [
        {
            "name": "High End",
            "eventId": "5593351",
            "eventSecret": "secret",
            "categories": [{"category": "Diamond"}, {"category": "Ruby"}],
        },
        {
            "name": "Mid",
            "eventId": "5593352",
            "eventSecret": "secret",
            "categories": [
                {"category": "Emerald"},
                {"category": "Sapphire"},
                {"category": "Amethyst"},
            ],
        },
    ],
}

ZWIFT_EVENT_PAYLOADS = {
    "5593351": {
        "eventSubgroups": [
            {"id": "7158672", "subgroupLabel": "A", "label": 1},
            {"id": "7158673", "subgroupLabel": "B", "label": 2},
        ]
    },
    "5593352": {
        "eventSubgroups": [
            {"id": "7158675", "subgroupLabel": "A", "label": 1},
            {"id": "7158674", "subgroupLabel": "B", "label": 2},
            {"id": "7158676", "subgroupLabel": "C", "label": 3},
        ]
    },
}


class FakeZwift:
    def __init__(self):
        self.registered: list[tuple[str, list[str]]] = []
        self.unregistered: list[tuple[str, list[str]]] = []
        self.unknown: list[str] = []

    def get_public_event_info(self, event_id: str, event_secret: str | None = None):
        return ZWIFT_EVENT_PAYLOADS.get(str(event_id))

    def batch_register_participants(self, event_subgroup_id, public_ids, row_id=None):
        self.registered.append((str(event_subgroup_id), list(public_ids)))
        return 200, {"unknownPublicIds": list(self.unknown)}

    def batch_unregister_participants(self, event_subgroup_id, public_ids, row_id=None):
        self.unregistered.append((str(event_subgroup_id), list(public_ids)))
        return 200, {}

    def get_live_riders(self, subgroup_id, limit=100, page_delay=0, max_pages=10):
        return []


class MemDoc:
    def __init__(self, doc_id: str, data: dict | None, exists: bool = True):
        self.id = doc_id
        self._data = dict(data or {})
        self.exists = exists

    def to_dict(self):
        return dict(self._data)

    def set(self, data, merge=False):
        if merge:
            self._data.update(data)
        else:
            self._data = dict(data)
        self.exists = True

    def delete(self):
        self.exists = False
        self._data = {}

    def get(self):
        return self


class MemCol:
    def __init__(self, store: dict[str, MemDoc]):
        self._store = store

    def document(self, doc_id: str):
        if doc_id not in self._store:
            self._store[doc_id] = MemDoc(doc_id, {}, exists=False)
        return self._store[doc_id]

    def stream(self):
        return [d for d in self._store.values() if d.exists]


class FakeDB:
    def __init__(self):
        self.race_docs: dict[str, MemDoc] = {}
        self.user_docs: dict[str, MemDoc] = {}
        self.stream_riders: dict[str, dict[str, MemDoc]] = {}
        self.league_settings: dict = {}

    def add_race(self, race_id: str, data: dict):
        self.race_docs[race_id] = MemDoc(race_id, data, exists=True)
        self.stream_riders.setdefault(race_id, {})

    def add_user(self, user_id: str, data: dict):
        self.user_docs[user_id] = MemDoc(user_id, data, exists=True)

    def collection(self, name: str):
        if name == "users":
            return MemCol(self.user_docs)
        if name == "league":
            col = MagicMock()
            settings = MemDoc("settings", self.league_settings, exists=bool(self.league_settings))
            col.document.return_value.get.return_value = settings
            return col
        if name == "races":
            parent = self

            class RacesCol:
                def document(self, race_id: str):
                    if race_id not in parent.race_docs:
                        parent.race_docs[race_id] = MemDoc(race_id, {}, exists=False)
                        parent.stream_riders.setdefault(race_id, {})
                    doc = parent.race_docs[race_id]

                    def collection(sub: str):
                        assert sub == "streamRiders"
                        parent.stream_riders.setdefault(race_id, {})
                        return MemCol(parent.stream_riders[race_id])

                    doc.collection = collection  # type: ignore[attr-defined]
                    return doc

            return RacesCol()
        raise AssertionError(f"unexpected collection {name}")


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch) -> FakeDB:
    store = FakeDB()
    monkeypatch.setattr(sr, "db", store)
    return store


def test_default_category_uses_first_liga_band(fake_db: FakeDB) -> None:
    fake_db.league_settings = {
        "ligaCategories": [
            {"name": "1. Division", "upper": None},
            {"name": "2. Division", "upper": 2200},
        ]
    }
    assert sr.default_stream_category(fake_db) == "1. Division"


def test_numeric_id_requires_public_uuid() -> None:
    with pytest.raises(sr.StreamRiderError) as exc:
        sr.resolve_public_id("15690", None)
    assert exc.value.status_code == 400


def test_uuid_zwift_id_is_accepted_as_public_id() -> None:
    pid = "094e4781-af17-4bde-b7bb-88692d5a8a2a"
    assert sr.resolve_public_id(pid, None) == pid


def test_add_routes_to_category_pen(fake_db: FakeDB) -> None:
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    zwift = FakeZwift()
    payload = sr.add_stream_rider(
        "r1",
        zwift_id="9990001",
        public_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        category="Diamond",
        zwift_service=zwift,
    )
    assert payload["status"] == "registered"
    assert payload["subgroupId"] == "7158672"
    assert zwift.registered == [("7158672", ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"])]
    assert "9990001" in fake_db.stream_riders["r1"]
    assert fake_db.stream_riders["r1"]["9990001"].exists


def test_add_defaults_to_top_liga_category(fake_db: FakeDB) -> None:
    fake_db.league_settings = {
        "ligaCategories": [
            {"name": "Diamond", "upper": None},
            {"name": "Ruby", "upper": 2200},
        ]
    }
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    zwift = FakeZwift()
    payload = sr.add_stream_rider(
        "r1",
        zwift_id="9990002",
        public_id="11111111-1111-1111-1111-111111111111",
        zwift_service=zwift,
    )
    assert payload["category"] == "Diamond"
    assert payload["subgroupId"] == "7158672"


def test_refuse_complete_liga_member(fake_db: FakeDB) -> None:
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    fake_db.add_user("15690", {"registration": {"status": "complete"}})
    with pytest.raises(sr.StreamRiderError) as exc:
        sr.add_stream_rider(
            "r1",
            zwift_id="15690",
            public_id="094e4781-af17-4bde-b7bb-88692d5a8a2a",
            category="Diamond",
            zwift_service=FakeZwift(),
        )
    assert exc.value.status_code == 403
    assert fake_db.stream_riders["r1"] == {} or not any(
        d.exists for d in fake_db.stream_riders["r1"].values()
    )


def test_unknown_public_id_fails(fake_db: FakeDB) -> None:
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    zwift = FakeZwift()
    zwift.unknown = ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"]
    with pytest.raises(sr.StreamRiderError):
        sr.add_stream_rider(
            "r1",
            zwift_id="9990001",
            public_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
            category="Diamond",
            zwift_service=zwift,
        )
    stored = fake_db.stream_riders["r1"]["9990001"].to_dict()
    assert stored["status"] == "failed"


def test_remove_unregisters_and_deletes(fake_db: FakeDB) -> None:
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    zwift = FakeZwift()
    sr.add_stream_rider(
        "r1",
        zwift_id="9990001",
        public_id="aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
        category="Diamond",
        zwift_service=zwift,
    )
    result = sr.remove_stream_rider("r1", "9990001", zwift_service=zwift)
    assert result["status"] == "removed"
    assert zwift.unregistered == [("7158672", ["aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"])]
    assert not fake_db.stream_riders["r1"]["9990001"].exists


def test_hide_ids_include_public_and_numeric(fake_db: FakeDB) -> None:
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    sr.add_stream_rider(
        "r1",
        zwift_id="9990001",
        public_id="AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE",
        category="Diamond",
        zwift_service=FakeZwift(),
    )
    hidden = sr.stream_rider_hide_ids("r1")
    assert "9990001" in hidden
    assert "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" in hidden


def test_live_riders_omits_stream_public_ids(
    monkeypatch: pytest.MonkeyPatch,
    fake_db: FakeDB,
) -> None:
    live_race._LIVE_RIDERS_CACHE.clear()
    fake_db.add_race("r1", THE_CLASSIC_RACE)
    monkeypatch.setattr(live_race, "db", fake_db)
    monkeypatch.setattr(sr, "db", fake_db)
    monkeypatch.setattr(
        live_race,
        "stream_rider_hide_ids",
        lambda _rid: {"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"},
    )
    monkeypatch.setattr(
        live_race,
        "resolve_signup_subgroup_id",
        lambda *_a, **_k: ("7158672", None),
    )
    monkeypatch.setattr(live_race, "_get_registered_riders", lambda _rid: {})
    zwift = FakeZwift()
    zwift.get_live_riders = MagicMock(
        return_value=[
            {"userId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "asOf": 1},
            {"userId": "bbbbbbbb-cccc-dddd-eeee-ffffffffffff", "asOf": 2},
        ]
    )
    monkeypatch.setattr(live_race, "get_zwift_service", lambda: zwift)

    app = Flask(__name__)
    with app.test_request_context("/races/r1/live-riders?cat=Diamond"):
        response, status = live_race.get_live_riders_for_race("r1")

    assert status == 200
    body = response.get_json()
    ids = [r["userId"] for r in body["riders"]]
    assert "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee" not in ids
    assert ids == ["bbbbbbbb-cccc-dddd-eeee-ffffffffffff"]
