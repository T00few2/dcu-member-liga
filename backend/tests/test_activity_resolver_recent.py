"""Stored Zwift activities are read newest-id first, not oldest-document first."""
from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.dual_recording.activity_resolver import _iter_activities_for_user_ids


class _Doc:
    def __init__(self, doc_id: str):
        self.id = doc_id

    def to_dict(self):
        return {"activityId": self.id}


class _Query:
    def __init__(self, docs: list[_Doc]):
        self._docs = docs

    def stream(self):
        return list(self._docs)


class _Collection:
    def __init__(self, docs: list[_Doc]):
        self._docs = docs

    def where(self, *_args, **_kwargs):
        return _Query(self._docs)


class _Db:
    def __init__(self, docs: list[_Doc]):
        self._docs = docs

    def collection(self, name: str):
        assert name == "zwift_activities"
        return _Collection(self._docs)


def test_keeps_newest_numeric_activity_ids_when_limited():
    # Stream order matches Firestore's default: lowest document id first.
    # "999" sorts after "1000" as text, and would win a lexicographic cap.
    docs = [_Doc(activity_id) for activity_id in ("100", "999", "1000", "1001", "legacy-id")]
    chosen = [doc.id for doc in _iter_activities_for_user_ids(_Db(docs), ["rider-uuid"], limit=2)]
    assert chosen == ["1001", "1000"]


def test_dedupes_string_and_int_user_id_queries():
    docs = [_Doc("10"), _Doc("20"), _Doc("30")]
    chosen = [doc.id for doc in _iter_activities_for_user_ids(_Db(docs), ["190507"], limit=10)]
    assert chosen == ["30", "20", "10"]
