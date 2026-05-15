from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock

from flask import Flask
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from routes import admin_liga_categories_refresh_routes as refresh_routes  # noqa: E402


def _doc(doc_id: str, data: dict) -> MagicMock:
    doc = MagicMock()
    doc.id = doc_id
    doc.to_dict.return_value = data
    return doc


@pytest.fixture
def app() -> Flask:
    return Flask(__name__)


def test_weight_history_backfill_counts_written_and_skipped(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(refresh_routes, "require_scheduler", lambda _req: None)
    monkeypatch.setattr(refresh_routes, "require_admin", lambda _req: None)

    db = MagicMock()
    monkeypatch.setattr(refresh_routes, "db", db)

    users_query = MagicMock()
    users_query.limit.return_value.stream.return_value = [
        _doc("u1", {"registration": {"status": "complete"}, "zwiftProfile": {"weightInGrams": 75000}}),
        _doc("u2", {"registration": {"status": "complete"}, "zwiftProfile": {"weightInGrams": 76000}}),
    ]
    users_col = MagicMock()
    users_col.order_by.return_value = users_query
    db.collection.return_value = users_col

    write_results = iter(
        [
            {"written": True, "reason": "created"},
            {"written": False, "reason": "deduped"},
        ]
    )
    monkeypatch.setattr(
        refresh_routes,
        "append_weight_history_entry",
        lambda *args, **kwargs: next(write_results),
    )

    with app.test_request_context("/admin/weight-history/backfill", method="POST", json={"chunkSize": 2}):
        response, status = refresh_routes.backfill_weight_history()

    assert status == 200
    body = response.get_json()
    assert body["processed"] == 2
    assert body["written"] == 1
    assert body["skipped"] == 1
    assert body["errors"] == 0
    assert body["done"] is True
    assert body["nextCursor"] is None


def test_weight_history_backfill_cursor_resume_sets_next_cursor(
    app: Flask,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(refresh_routes, "require_scheduler", lambda _req: None)
    monkeypatch.setattr(refresh_routes, "require_admin", lambda _req: None)

    db = MagicMock()
    monkeypatch.setattr(refresh_routes, "db", db)

    users_query = MagicMock()
    users_query.limit.return_value.stream.return_value = [
        _doc("u2", {"registration": {"status": "complete"}, "zwiftProfile": {"weightInGrams": 77000}}),
        _doc("u3", {"registration": {"status": "complete"}, "zwiftProfile": {"weightInGrams": 78000}}),
    ]
    users_query.where.return_value = users_query
    users_col = MagicMock()
    users_col.order_by.return_value = users_query
    db.collection.return_value = users_col

    monkeypatch.setattr(
        refresh_routes,
        "append_weight_history_entry",
        lambda *args, **kwargs: {"written": True, "reason": "created"},
    )

    with app.test_request_context(
        "/admin/weight-history/backfill",
        method="POST",
        json={"chunkSize": 1, "cursor": "u1"},
    ):
        response, status = refresh_routes.backfill_weight_history()

    assert status == 200
    body = response.get_json()
    assert body["processed"] == 1
    assert body["written"] == 1
    assert body["done"] is False
    assert body["nextCursor"] == "u2"
