import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.club_kits import (
    apply_auto_assignment,
    club_obtainable_intersection,
    drop_level_from_achievement,
    effective_drop_level,
    extract_level_fields,
    obtainable_signatures,
    pin_club_kit,
    preview_auto_assignment,
    rider_club_kit_payload,
    riders_below_kit_level,
    unpin_club_kit,
)


UNLOCKS = [
    {"jerseySignature": 6, "jerseyName": "Zwift Standard Orange", "minLevel": 1, "imageName": "std"},
    {"jerseySignature": 1, "jerseyName": "Level 5", "minLevel": 5, "imageName": "l5"},
    {"jerseySignature": 2, "jerseyName": "Level 50", "minLevel": 50, "imageName": "l50"},
    {
        "jerseySignature": 3,
        "jerseyName": "Working Code",
        "unlockCode": "WORKS",
        "codeStatus": "working",
        "imageName": "code",
    },
    {
        "jerseySignature": 4,
        "jerseyName": "Dead Code",
        "unlockCode": "DEAD",
        "codeStatus": "expired",
        "imageName": "dead",
    },
    {
        "jerseySignature": 5,
        "jerseyName": "Both",
        "minLevel": 10,
        "unlockCode": "BOTH",
        "codeStatus": "expired",
        "imageName": "both",
    },
]


def test_drop_level_from_unofficial_hundredths():
    assert drop_level_from_achievement(11202) == 112
    assert drop_level_from_achievement(42) == 42
    assert drop_level_from_achievement(None) is None


def test_extract_level_fields_official_nested_and_unofficial_flat():
    official = extract_level_fields({"achievements": {"achievementLevel": 42, "totalExperiencePoints": 9}})
    assert official["dropLevel"] == 42
    assert official["achievementLevel"] == 42
    unofficial = extract_level_fields({"achievementLevel": 11202, "totalExperiencePoints": 1047591})
    assert unofficial["dropLevel"] == 112


def test_unknown_drop_level_counts_as_starter_level():
    assert effective_drop_level(None) == 1
    assert effective_drop_level(0) == 1
    assert effective_drop_level(12) == 12


def test_obtainable_set_level_and_working_code_only():
    low = obtainable_signatures(UNLOCKS, 8)
    assert low == {6, 1, 3}
    high = obtainable_signatures(UNLOCKS, 50)
    assert high == {6, 1, 2, 3, 5}
    unknown = obtainable_signatures(UNLOCKS, None)
    assert unknown == {6, 3}
    assert 4 not in high


def test_club_intersection_unknown_level_keeps_starter_kits():
    members = [{"dropLevel": 80}, {"dropLevel": None}]
    assert club_obtainable_intersection(members, UNLOCKS) == {6, 3}


def test_riders_below_kit_level_lists_low_and_unknown():
    kit = {"club": "A", "jerseySignature": 2, "minLevel": 50, "assignment": "auto"}
    members = [
        {"name": "High", "dropLevel": 80},
        {"name": "Low", "dropLevel": 12},
        {"name": "Unknown", "dropLevel": None},
    ]
    gap = riders_below_kit_level(members, kit, UNLOCKS)
    assert gap["kitMinLevel"] == 50
    assert gap["belowKitLevelCount"] == 2
    assert [row["name"] for row in gap["belowKitLevel"]] == ["Low", "Unknown"]


def test_riders_below_kit_level_ignores_working_code_kits():
    kit = {"club": "A", "jerseySignature": 3, "assignment": "auto"}
    members = [{"name": "Low", "dropLevel": 1}]
    gap = riders_below_kit_level(members, kit, UNLOCKS)
    assert gap["belowKitLevelCount"] == 0


def test_empty_unlock_index_has_empty_pool():
    riders = [{"club": "DZR", "dropLevel": 80}]
    preview = preview_auto_assignment(unlocks=[], club_kits=[], riders=riders)
    assert preview["emptyPools"][0]["club"] == "DZR"
    assert "Unlock-index er tomt" in preview["emptyPools"][0]["reason"]


def test_greedy_prefers_unique_then_least_doubles_and_skips_pins():
    riders = [
        {"club": "A", "dropLevel": 80},
        {"club": "B", "dropLevel": 80},
        {"club": "C", "dropLevel": 80},
        {"club": "Pinned Club", "dropLevel": 80},
    ]
    pinned = [{
        "club": "Pinned Club",
        "jerseySignature": 2,
        "jerseyName": "Level 50",
        "assignment": "pinned",
        "source": "club",
    }]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=pinned, riders=riders)
    auto_sigs = {row["jerseySignature"] for row in preview["auto"]}
    assert 2 not in auto_sigs
    assert preview["coverage"]["pinnedCount"] == 1
    applied = apply_auto_assignment(unlocks=UNLOCKS, club_kits=pinned, riders=riders)
    pinned_row = next(row for row in applied if row["club"] == "Pinned Club")
    assert pinned_row["assignment"] == "pinned"
    assert pinned_row["jerseySignature"] == 2


def test_auto_never_assigns_pinned_jersey_when_it_is_the_only_option():
    unlocks = [{"jerseySignature": 2, "jerseyName": "Level 50", "minLevel": 50}]
    riders = [
        {"club": "Pinned Club", "dropLevel": 80},
        {"club": "A", "dropLevel": 80},
    ]
    pinned = [{
        "club": "Pinned Club",
        "jerseySignature": 2,
        "jerseyName": "Level 50",
        "assignment": "pinned",
    }]
    preview = preview_auto_assignment(unlocks=unlocks, club_kits=pinned, riders=riders)
    assert preview["coverage"]["autoCount"] == 0
    assert preview["emptyPools"][0]["club"] == "A"
    assert "pinnede" in preview["emptyPools"][0]["reason"]


def test_auto_doubles_unpinned_kits_instead_of_reusing_pin():
    unlocks = [
        {"jerseySignature": 1, "jerseyName": "Level 5", "minLevel": 5},
        {"jerseySignature": 2, "jerseyName": "Level 50", "minLevel": 50},
    ]
    riders = [
        {"club": "Pinned Club", "dropLevel": 80},
        {"club": "A", "dropLevel": 80},
        {"club": "B", "dropLevel": 80},
    ]
    pinned = [{
        "club": "Pinned Club",
        "jerseySignature": 2,
        "jerseyName": "Level 50",
        "assignment": "pinned",
    }]
    preview = preview_auto_assignment(unlocks=unlocks, club_kits=pinned, riders=riders)
    auto_sigs = [row["jerseySignature"] for row in preview["auto"]]
    assert auto_sigs == [1, 1]
    assert 2 not in auto_sigs
    assert preview["coverage"]["sharedJerseyCount"] == 1


def test_unknown_level_clubs_share_starter_then_working_code():
    riders = [
        {"club": "A", "dropLevel": None},
        {"club": "B", "dropLevel": None},
    ]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=[], riders=riders)
    assert preview["coverage"]["autoCount"] == 2
    assert preview["coverage"]["sharedJerseyCount"] == 0
    assert {row["jerseySignature"] for row in preview["auto"]} == {3, 6}


def test_empty_pool_when_no_working_codes_and_low_levels():
    level_only = [u for u in UNLOCKS if u["jerseySignature"] in (1, 2, 5)]
    riders = [{"club": "Tiny", "dropLevel": 1}, {"club": "Tiny", "dropLevel": 2}]
    preview = preview_auto_assignment(unlocks=level_only, club_kits=[], riders=riders)
    assert preview["emptyPools"][0]["club"] == "Tiny"
    assert preview["coverage"]["autoCount"] == 0


def test_pin_does_not_reuse_pinned_jersey_and_drops_auto_duplicate():
    existing = [
        {"club": "DZR", "jerseySignature": 99, "assignment": "pinned"},
        {"club": "Other", "jerseySignature": 3, "assignment": "auto"},
    ]
    try:
        pin_club_kit(club="Other", signature=99, club_kits=existing, unlocks=UNLOCKS)
        raise AssertionError("expected pin collision")
    except ValueError:
        pass
    next_rows = pin_club_kit(
        club="Other",
        signature=3,
        club_kits=existing,
        unlocks=UNLOCKS,
        notes="Chosen basic kit",
    )
    other = next(row for row in next_rows if row["club"] == "Other")
    assert other["assignment"] == "pinned"
    assert other["unlockCode"] == "WORKS"


def test_unpin_keeps_other_clubs():
    rows = [
        {"club": "DZR", "jerseySignature": 99, "assignment": "pinned"},
        {"club": "Other", "jerseySignature": 3, "assignment": "auto"},
    ]
    out = unpin_club_kit("DZR", rows)
    assert [row["club"] for row in out] == ["Other"]


def test_public_settings_view_strips_codes():
    from services.club_kits import public_settings_view
    view = public_settings_view({
        "jerseyUnlocks": [{"jerseySignature": 3, "unlockCode": "SECRET", "codeStatus": "working"}],
        "clubKits": [{"club": "A", "unlockCode": "SECRET"}],
    })
    assert "unlockCode" not in view["jerseyUnlocks"][0]
    assert "unlockCode" not in view["clubKits"][0]


def test_rider_payload_hides_expired_code_but_keeps_level_grant():
    settings = {
        "jerseyUnlocks": UNLOCKS,
        "clubKits": [{
            "club": "Danish Zwift Racers",
            "jerseySignature": 5,
            "jerseyName": "Both",
            "assignment": "auto",
            "source": "both",
            "minLevel": 10,
            "unlockCode": "BOTH",
            "codeStatus": "expired",
        }],
    }
    payload = rider_club_kit_payload(
        club="Danish Zwift Racers",
        settings=settings,
        drop_level=20,
    )
    assert payload is not None
    assert payload["unlockCode"] is None
    assert payload["showCode"] is False
    assert payload["hasLevelGrant"] is True
    assert payload["minLevel"] == 10


def test_rider_payload_matches_club_case_insensitively():
    settings = {
        "clubKits": [{
            "club": "Danish Zwift Racers",
            "jerseySignature": 1381648520,
            "jerseyName": "DZR 2025",
            "assignment": "pinned",
            "source": "club",
            "imageName": "DZR2025_thumb",
        }],
    }
    payload = rider_club_kit_payload(
        club="danish zwift racers",
        settings=settings,
        drop_level=112,
    )
    assert payload is not None
    assert payload["jerseyName"] == "DZR 2025"


def test_seed_matches_catalog_level_and_code():
    from services.jersey_unlock_seed import match_known_unlocks, merge_unlocks

    catalog = [
        {"signature": 1, "name": "Camo 1", "imageName": "camo1"},
        {"signature": 2, "name": "GCN", "imageName": "gcn"},
        {"signature": 3, "name": "Unknown Kit", "imageName": "x"},
        {"signature": 4, "name": "Level 50", "imageName": "l50"},
    ]
    seeded = match_known_unlocks(catalog)
    names = {row["jerseyName"] for row in seeded}
    assert names == {"Camo 1", "GCN", "Level 50"}
    camo = next(row for row in seeded if row["jerseyName"] == "Camo 1")
    assert camo["minLevel"] == 9
    assert camo.get("unlockCode") is None
    gcn = next(row for row in seeded if row["jerseyName"] == "GCN")
    assert gcn["unlockCode"] == "GOGCN"
    assert gcn["codeStatus"] == "unverified"
    level50 = next(row for row in seeded if row["jerseyName"] == "Level 50")
    assert level50["minLevel"] == 50

    existing = [{
        "jerseySignature": 2,
        "jerseyName": "GCN",
        "unlockCode": "GOGCN",
        "codeStatus": "working",
    }]
    merged = merge_unlocks(existing, seeded)
    gcn_merged = next(row for row in merged if row["jerseySignature"] == 2)
    assert gcn_merged["codeStatus"] == "working"
    assert any(row["jerseySignature"] == 1 for row in merged)
