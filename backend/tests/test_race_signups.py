"""Tests for race signup intent persistence and Zwift sync."""

from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

import pytest
from flask import Flask

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import races  # noqa: E402
from services import race_signups as rs  # noqa: E402


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
        {
            "name": "Low End",
            "eventId": "5593353",
            "eventSecret": "secret",
            "categories": [
                {"category": "Platinum"},
                {"category": "Gold"},
                {"category": "Silver"},
                {"category": "Copper"},
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
            {"id": "7158674", "subgroupLabel": "B", "label": 2},
            {"id": "7158675", "subgroupLabel": "A", "label": 1},
            {"id": "7158676", "subgroupLabel": "C", "label": 3},
        ]
    },
    "5593353": {
        "eventSubgroups": [
            {"id": "7158677", "subgroupLabel": "B", "label": 2},
            {"id": "7158678", "subgroupLabel": "C", "label": 3},
            {"id": "7158679", "subgroupLabel": "A", "label": 1},
            {"id": "7158680", "subgroupLabel": "D", "label": 4},
        ]
    },
}


class FakeZwiftService:
    def get_public_event_info(self, event_id: str, event_secret: str | None = None):
        return ZWIFT_EVENT_PAYLOADS.get(str(event_id))


class MemDoc:
    def __init__(self, doc_id: str, data: dict | None, exists: bool = True, race_id: str | None = None):
        self.id = doc_id
        self._data = dict(data or {})
        self.exists = exists
        self.reference = MagicMock()
        if race_id:
            self.reference.parent.parent.id = race_id

    def to_dict(self):
        return dict(self._data)

    def set(self, data, merge=False):
        if merge:
            self._data.update(data)
        else:
            self._data = dict(data)
        self.exists = True

    def update(self, data):
        self._data.update(data)
        self.exists = True

    def delete(self):
        self.exists = False
        self._data = {}

    def get(self):
        return self


class MemCol:
    def __init__(self, store: dict[str, MemDoc], race_id: str | None = None):
        self._store = store
        self._race_id = race_id

    def document(self, doc_id: str):
        if doc_id not in self._store:
            self._store[doc_id] = MemDoc(doc_id, {}, exists=False, race_id=self._race_id)
        return self._store[doc_id]

    def stream(self):
        return [d for d in self._store.values() if d.exists]

    def where(self, field, op, value):
        assert op == "=="
        matches = []
        for d in self._store.values():
            if d.exists and str(d.to_dict().get(field)) == str(value):
                matches.append(d)
        col = MagicMock()
        col.stream.return_value = matches
        return col


class FakeDB:
    def __init__(self):
        self.races: dict[str, dict] = {}
        self.users: dict[str, dict] = {}
        self.signups: dict[str, dict[str, MemDoc]] = {}
        self.race_docs: dict[str, MemDoc] = {}
        self.user_docs: dict[str, MemDoc] = {}

    def add_race(self, race_id: str, data: dict):
        self.races[race_id] = data
        self.race_docs[race_id] = MemDoc(race_id, data, exists=True)
        self.signups.setdefault(race_id, {})

    def add_user(self, user_id: str, data: dict):
        self.users[user_id] = data
        self.user_docs[user_id] = MemDoc(user_id, data, exists=True)

    def add_signup(self, race_id: str, zwift_id: str, data: dict):
        self.signups.setdefault(race_id, {})
        payload = {"zwiftId": zwift_id, "raceId": race_id, **data}
        self.signups[race_id][zwift_id] = MemDoc(zwift_id, payload, exists=True, race_id=race_id)

    def collection(self, name: str):
        if name == "races":
            return self._races_col()
        if name == "users":
            return MemCol(self.user_docs)
        raise AssertionError(f"unexpected collection {name}")

    def collection_group(self, name: str):
        assert name == "signups"
        all_docs: dict[str, MemDoc] = {}
        for race_id, docs in self.signups.items():
            for zid, doc in docs.items():
                all_docs[f"{race_id}:{zid}"] = doc
        return MemCol(all_docs)

    def _races_col(self):
        parent = self

        class RacesCol(MemCol):
            def document(self, race_id: str):
                if race_id not in parent.race_docs:
                    parent.race_docs[race_id] = MemDoc(race_id, {}, exists=False)
                    parent.signups.setdefault(race_id, {})
                doc = parent.race_docs[race_id]

                def collection(sub: str):
                    assert sub == "signups"
                    parent.signups.setdefault(race_id, {})
                    return MemCol(parent.signups[race_id], race_id=race_id)

                doc.collection = collection  # type: ignore[attr-defined]
                return doc

        return RacesCol(parent.race_docs)


def _future_date() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=14)).strftime("%Y-%m-%dT19:00")


def _past_date() -> str:
    return (datetime.now(timezone.utc) - timedelta(days=2)).strftime("%Y-%m-%dT19:00")


def _user(category: str | None = "Gold", **extra) -> dict:
    data = {
        "zwiftId": extra.pop("zwiftId", "100001"),
        "zwiftUserId": extra.pop("zwiftUserId", "uuid-100001"),
        "name": "Rider",
        "club": "Club",
        "registration": {"status": "complete"},
        "ligaCategory": {"locked": False, "autoAssigned": {"category": category}} if category else {},
    }
    data.update(extra)
    return data


@pytest.fixture
def fake_db(monkeypatch: pytest.MonkeyPatch) -> FakeDB:
    store = FakeDB()
    monkeypatch.setattr(rs, "db", store)
    return store


@pytest.fixture
def zwift(monkeypatch: pytest.MonkeyPatch) -> FakeZwiftService:
    svc = FakeZwiftService()
    svc.batch_register_participants = MagicMock(return_value=(200, {"unknownPublicIds": []}))
    svc.batch_unregister_participants = MagicMock(return_value=(200, {}))
    monkeypatch.setattr(rs, "get_zwift_service", lambda: svc)
    return svc


def test_flag_off_no_event_rejected(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race("r1", {"name": "Race", "date": _future_date(), "eventMode": "single", "preRegisterAllowed": False})
    fake_db.add_user("100001", _user())
    with pytest.raises(rs.SignupError) as exc:
        rs.signup_rider("r1", "100001", _user())
    assert exc.value.status_code == 400
    zwift.batch_register_participants.assert_not_called()


def test_flag_on_no_event_writes_pending(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race("r1", {"name": "Race", "date": _future_date(), "eventMode": "single", "preRegisterAllowed": True})
    fake_db.add_user("100001", _user())
    result = rs.signup_rider("r1", "100001", _user())
    assert result["status"] == "pending"
    zwift.batch_register_participants.assert_not_called()
    stored = fake_db.signups["r1"]["100001"].to_dict()
    assert stored["status"] == "pending"
    assert stored["zwiftUserId"] == "uuid-100001"


def test_event_present_registers_immediately(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race(
        "r1",
        {
            "name": "Race",
            "date": _future_date(),
            "eventMode": "single",
            "preRegisterAllowed": False,
            "eventId": "555",
            "subgroupId": "sg-1",
        },
    )
    fake_db.add_user("100001", _user())
    result = rs.signup_rider("r1", "100001", _user())
    assert result["status"] == "registered"
    zwift.batch_register_participants.assert_called_once()
    assert fake_db.signups["r1"]["100001"].to_dict()["status"] == "registered"


def test_past_race_rejected(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race("r1", {"name": "Race", "date": _past_date(), "eventMode": "single", "preRegisterAllowed": True})
    with pytest.raises(rs.SignupError) as exc:
        rs.signup_rider("r1", "100001", _user())
    assert "past" in exc.value.message.lower()
    zwift.batch_register_participants.assert_not_called()


def test_grouped_without_category_and_event_fails(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    race = {**THE_CLASSIC_RACE, "name": "Classic", "date": _future_date(), "preRegisterAllowed": True}
    fake_db.add_race("r1", race)
    user = _user(category=None)
    fake_db.add_user("100001", user)
    with pytest.raises(rs.SignupError):
        rs.signup_rider("r1", "100001", user)
    assert fake_db.signups["r1"]["100001"].to_dict()["status"] == "failed"


def test_grouped_without_category_pending_when_no_event(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race(
        "r1",
        {"name": "Classic", "date": _future_date(), "eventMode": "grouped", "raceGroups": [], "preRegisterAllowed": True},
    )
    user = _user(category=None)
    fake_db.add_user("100001", user)
    result = rs.signup_rider("r1", "100001", user)
    assert result["status"] == "pending"
    zwift.batch_register_participants.assert_not_called()


def test_sync_groups_diamond_and_gold(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    race = {**THE_CLASSIC_RACE, "name": "Classic", "date": _future_date(), "preRegisterAllowed": True}
    fake_db.add_race("r1", race)
    fake_db.add_user("1", _user(category="Diamond", zwiftId="1", zwiftUserId="uuid-d"))
    fake_db.add_user("2", _user(category="Gold", zwiftId="2", zwiftUserId="uuid-g"))
    fake_db.add_signup("r1", "1", {"status": "pending", "zwiftUserId": "uuid-d"})
    fake_db.add_signup("r1", "2", {"status": "pending", "zwiftUserId": "uuid-g"})

    summary = rs.sync_race_signups("r1")
    assert summary["registered"] == 2
    assert summary["failed"] == 0
    calls = zwift.batch_register_participants.call_args_list
    by_sg = {str(c.kwargs["event_subgroup_id"]): c.kwargs["public_ids"] for c in calls}
    assert by_sg["7158672"] == ["uuid-d"]
    assert by_sg["7158677"] == ["uuid-g"]


def test_sync_moves_registered_when_category_changes(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    race = {**THE_CLASSIC_RACE, "name": "Classic", "date": _future_date(), "preRegisterAllowed": True}
    fake_db.add_race("r1", race)
    fake_db.add_user("1", _user(category="Diamond", zwiftId="1", zwiftUserId="uuid-d"))
    fake_db.add_signup(
        "r1",
        "1",
        {"status": "registered", "zwiftUserId": "uuid-d", "subgroupId": "7158677", "eventId": "5593353"},
    )
    summary = rs.sync_race_signups("r1", include_reroutes=True)
    assert summary["moved"] == 1
    zwift.batch_unregister_participants.assert_called()
    stored = fake_db.signups["r1"]["1"].to_dict()
    assert stored["subgroupId"] == "7158672"
    assert stored["status"] == "registered"


def test_sync_skips_registered_when_subgroup_unchanged(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    race = {**THE_CLASSIC_RACE, "name": "Classic", "date": _future_date()}
    fake_db.add_race("r1", race)
    fake_db.add_user("1", _user(category="Diamond", zwiftId="1", zwiftUserId="uuid-d"))
    fake_db.add_signup(
        "r1",
        "1",
        {"status": "registered", "zwiftUserId": "uuid-d", "subgroupId": "7158672", "eventId": "5593351"},
    )
    summary = rs.sync_race_signups("r1", include_reroutes=True)
    assert summary["skipped"] == 1
    zwift.batch_register_participants.assert_not_called()


def test_unsignup_unregister_failure_keeps_doc(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race("r1", {"name": "Race", "date": _future_date(), "eventMode": "single"})
    fake_db.add_user("100001", _user())
    fake_db.add_signup(
        "r1",
        "100001",
        {"status": "registered", "zwiftUserId": "uuid-100001", "subgroupId": "sg-1"},
    )
    zwift.batch_unregister_participants.return_value = (502, {"message": "down"})
    with pytest.raises(rs.SignupError):
        rs.unsignup_rider("r1", "100001", _user())
    assert fake_db.signups["r1"]["100001"].exists
    assert fake_db.signups["r1"]["100001"].to_dict()["status"] == "failed"


def test_unsignup_pending_deletes_without_zwift(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race("r1", {"name": "Race", "date": _future_date(), "eventMode": "single"})
    fake_db.add_user("100001", _user())
    fake_db.add_signup("r1", "100001", {"status": "pending", "zwiftUserId": "uuid-100001"})
    rs.unsignup_rider("r1", "100001", _user())
    assert not fake_db.signups["r1"]["100001"].exists
    zwift.batch_unregister_participants.assert_not_called()


def test_sync_without_event_is_400(fake_db: FakeDB, zwift: FakeZwiftService) -> None:
    fake_db.add_race("r1", {"name": "Race", "date": _future_date(), "eventMode": "single"})
    with pytest.raises(rs.SignupError) as exc:
        rs.sync_race_signups("r1")
    assert exc.value.status_code == 400


def test_count_signups_by_race_skips_failed(fake_db: FakeDB) -> None:
    fake_db.add_race("r1", {"name": "Race 1", "date": _future_date()})
    fake_db.add_race("r2", {"name": "Race 2", "date": _future_date()})
    fake_db.add_signup("r1", "1", {"status": "pending"})
    fake_db.add_signup("r1", "2", {"status": "registered"})
    fake_db.add_signup("r1", "3", {"status": "failed"})
    fake_db.add_signup("r2", "1", {"status": "registered"})
    assert rs.count_signups_by_race() == {"r1": 2, "r2": 1}


def test_signup_counts_route(monkeypatch: pytest.MonkeyPatch) -> None:
    db = FakeDB()
    db.add_race("r1", {"name": "Race", "date": _future_date()})
    db.add_signup("r1", "1", {"status": "pending"})
    monkeypatch.setattr(races, "db", db)
    monkeypatch.setattr(rs, "db", db)

    app = Flask(__name__)
    with app.test_request_context("/races/signup-counts", method="GET"):
        response, status = races.get_race_signup_counts()
    assert status == 200
    assert response.get_json()["counts"] == {"r1": 1}


def test_signup_route_returns_pending(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(races, "verify_user_token", lambda _req: {"uid": "auth1"})
    monkeypatch.setattr(races, "resolve_user_doc_id_from_auth_uid", lambda _uid: "100001")

    db = FakeDB()
    db.add_race("r1", {"name": "Race", "date": _future_date(), "eventMode": "single", "preRegisterAllowed": True})
    db.add_user("100001", _user())
    monkeypatch.setattr(races, "db", db)
    monkeypatch.setattr(rs, "db", db)
    svc = FakeZwiftService()
    svc.batch_register_participants = MagicMock(return_value=(200, {"unknownPublicIds": []}))
    monkeypatch.setattr(rs, "get_zwift_service", lambda: svc)

    app = Flask(__name__)
    with app.test_request_context("/races/r1/signup", method="POST"):
        response, status = races.signup_race("r1")
    assert status == 200
    assert response.get_json()["status"] == "pending"
