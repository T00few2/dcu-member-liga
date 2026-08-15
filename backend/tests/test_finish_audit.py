"""Unit tests for derived vs official finish-time audit."""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.results.finish_audit import (
    ISSUE_DURATION_MISMATCH,
    ISSUE_MISSING_IN_DERIVED,
    ISSUE_MISSING_IN_OFFICIAL,
    STATUS_ALIGNED,
    STATUS_MISMATCH,
    STATUS_UNAVAILABLE,
    collect_derived_finishers,
    compare_derived_to_official,
)


def test_collects_only_finishers():
    derived = collect_derived_finishers(
        {
            "Silver": [
                {
                    "zwiftId": "1",
                    "name": "Fin",
                    "raceStatus": "FIN",
                    "finishTime": 1000,
                    "activityId": "a1",
                },
                {
                    "zwiftId": "2",
                    "name": "Dnf",
                    "raceStatus": "DNF",
                    "finishTime": 0,
                    "activityId": None,
                },
            ]
        }
    )
    assert len(derived) == 1
    assert derived[0]["zwiftId"] == "1"


def test_aligned_when_durations_match():
    derived = [
        {
            "category": "Silver",
            "name": "Fin",
            "zwiftId": "1",
            "activityId": "act-1",
            "finishTime": 4459077,
            "raceStatus": "FIN",
        }
    ]
    official = [
        {
            "userId": "uuid-1",
            "rank": 1,
            "activityData": {"activityId": "act-1", "durationInMilliseconds": 4459077},
        }
    ]
    audit = compare_derived_to_official(derived, official, subgroup_count=1)
    assert audit["status"] == STATUS_ALIGNED
    assert audit["alignedCount"] == 1
    assert audit["issues"] == []
    assert "aligned" in audit["summary"].lower()


def test_duration_mismatch_and_missing_official_finisher():
    derived = [
        {
            "category": "Silver",
            "name": "Slow",
            "zwiftId": "1",
            "activityId": "act-1",
            "finishTime": 4000,
            "raceStatus": "FIN",
        }
    ]
    official = [
        {
            "userId": "uuid-1",
            "rank": 1,
            "activityData": {"activityId": "act-1", "durationInMilliseconds": 5000},
        },
        {
            "userId": "uuid-2",
            "rank": 2,
            "activityData": {"activityId": "act-2", "durationInMilliseconds": 5100},
        },
    ]
    registered = {
        "uuid-2": {"zwiftId": "2", "name": "Missing"},
    }
    audit = compare_derived_to_official(
        derived,
        official,
        registered_riders=registered,
        subgroup_count=1,
    )
    assert audit["status"] == STATUS_MISMATCH
    types = {issue["type"] for issue in audit["issues"]}
    assert ISSUE_DURATION_MISMATCH in types
    assert ISSUE_MISSING_IN_DERIVED in types


def test_derived_finisher_missing_from_official():
    derived = [
        {
            "category": "Silver",
            "name": "Ghost",
            "zwiftId": "1",
            "activityId": "act-missing",
            "finishTime": 1000,
            "raceStatus": "FIN",
        }
    ]
    audit = compare_derived_to_official(derived, [], subgroup_count=1)
    assert audit["status"] == STATUS_MISMATCH
    assert audit["issues"][0]["type"] == ISSUE_MISSING_IN_OFFICIAL


def test_ignores_unregistered_official_finishers():
    derived = [
        {
            "category": "Silver",
            "name": "Fin",
            "zwiftId": "1",
            "activityId": "act-1",
            "finishTime": 1000,
            "raceStatus": "FIN",
        }
    ]
    official = [
        {
            "userId": "uuid-1",
            "activityData": {"activityId": "act-1", "durationInMilliseconds": 1000},
        },
        {
            "userId": "uuid-stranger",
            "activityData": {"activityId": "act-other", "durationInMilliseconds": 1100},
        },
    ]
    audit = compare_derived_to_official(derived, official, registered_riders={})
    assert audit["status"] == STATUS_ALIGNED


def test_unavailable_when_all_fetches_fail():
    audit = compare_derived_to_official(
        [],
        [],
        fetch_errors=["7158678: 403"],
        subgroup_count=1,
    )
    assert audit["status"] == STATUS_UNAVAILABLE
