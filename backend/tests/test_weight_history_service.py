from __future__ import annotations

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.weight_history import append_weight_history_entry  # noqa: E402


def _build_mock_db():
    db = MagicMock()
    users_col = MagicMock()
    db.collection.return_value = users_col

    user_ref = MagicMock()
    users_col.document.return_value = user_ref

    history_ref = MagicMock()
    user_ref.collection.return_value = history_ref
    return db, history_ref


def test_append_weight_history_writes_entry_with_expiry():
    db, history_ref = _build_mock_db()

    history_ref.order_by.return_value.limit.return_value.stream.return_value = iter([])
    new_doc_ref = MagicMock()
    new_doc_ref.id = "entry-1"
    history_ref.document.return_value = new_doc_ref

    result = append_weight_history_entry(
        db,
        user_doc_id="100001",
        weight_grams=75000,
        source="racing_profile",
        trigger="oauth_callback",
        retention_days=30,
    )

    assert result["written"] is True
    assert result["entryId"] == "entry-1"
    assert new_doc_ref.set.called

    payload = new_doc_ref.set.call_args.args[0]
    assert payload["weightInGrams"] == 75000
    assert payload["weightKg"] == 75.0
    assert payload["expiresAt"] - payload["capturedAt"] >= timedelta(days=30)


def test_append_weight_history_dedupes_recent_same_weight():
    db, history_ref = _build_mock_db()

    latest_doc = MagicMock()
    latest_doc.id = "existing-entry"
    latest_doc.exists = True
    latest_doc.to_dict.return_value = {
        "weightInGrams": 75000,
        "capturedAt": datetime.now(timezone.utc) - timedelta(minutes=5),
    }
    history_ref.order_by.return_value.limit.return_value.stream.return_value = iter([latest_doc])

    result = append_weight_history_entry(
        db,
        user_doc_id="100001",
        weight_grams=75000,
        source="racing_profile",
        trigger="RacingScoreUpdated",
        dedupe_minutes=60,
    )

    assert result["written"] is False
    assert result["reason"] == "deduped"
    assert result["entryId"] == "existing-entry"
    assert not history_ref.document.return_value.set.called
