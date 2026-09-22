import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.club_kits import (
    assign_auto_club_kit,
    apply_auto_assignment,
    club_obtainable_intersection,
    drop_level_from_achievement,
    effective_drop_level,
    extract_game_client_fields,
    extract_level_fields,
    obtainable_signatures,
    parse_game_client_platform,
    pin_club_kit,
    preview_auto_assignment,
    rider_assigned_kit_coverage,
    rider_club_kit_payload,
    riders_below_kit_level,
    riders_blocked_from_code_kit,
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


def test_parse_game_client_platform():
    assert parse_game_client_platform("CNL/3.82.11 (Windows 10) zwift/1.0") == "windows"
    assert parse_game_client_platform("CNL (Macintosh; Intel Mac OS X)") == "mac"
    assert parse_game_client_platform("CNL tvOS Apple TV") == "tvos"
    assert parse_game_client_platform("Zwift iPhone") == "ios"
    assert parse_game_client_platform("okhttp Android") == "android"
    assert parse_game_client_platform("") == "unknown"


def test_extract_game_client_fields():
    fields = extract_game_client_fields({
        "userAgent": "CNL/3.82.11 (Windows 10) zwift/1.0.165303 game/1.121.0",
    })
    assert fields["gameClientPlatform"] == "windows"
    assert fields["canEnterUnlockCode"] is True
    assert extract_game_client_fields({}) == {}


def test_obtainable_set_level_and_working_code_only():
    low = obtainable_signatures(UNLOCKS, 8, can_enter_code=True)
    assert low == {6, 1, 3}
    high = obtainable_signatures(UNLOCKS, 50, can_enter_code=True)
    assert high == {6, 1, 2, 3, 5}
    unknown = obtainable_signatures(UNLOCKS, None, can_enter_code=True)
    assert unknown == {6, 3}
    assert 4 not in high
    assert obtainable_signatures(UNLOCKS, 8) == {6, 1}


def test_club_intersection_unknown_level_keeps_starter_kits():
    members = [
        {"dropLevel": 80, "canEnterUnlockCode": True},
        {"dropLevel": None, "canEnterUnlockCode": True},
    ]
    assert club_obtainable_intersection(members, UNLOCKS) == {6, 3}


def test_club_intersection_excludes_codes_without_pc_mac():
    members = [
        {"dropLevel": 8, "gameClientPlatform": "windows", "canEnterUnlockCode": True},
        {"dropLevel": 8, "gameClientPlatform": "tvos", "canEnterUnlockCode": False},
    ]
    assert club_obtainable_intersection(members, UNLOCKS) == {6, 1}


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
    assert gap["atKitLevelCount"] == 1
    assert [row["name"] for row in gap["belowKitLevel"]] == ["Low", "Unknown"]


def test_at_kit_level_count_all_members():
    kit = {"club": "A", "jerseySignature": 2, "minLevel": 50, "assignment": "auto"}
    members = [{"name": f"R{i}", "dropLevel": 50 + i} for i in range(8)]
    gap = riders_below_kit_level(members, kit, UNLOCKS)
    assert gap["atKitLevelCount"] == 8
    assert gap["belowKitLevelCount"] == 0


def test_at_kit_level_count_for_level_jersey():
    kit = {"club": "A", "jerseySignature": 5, "minLevel": 10, "assignment": "auto"}
    members = [
        {"name": "High", "dropLevel": 20},
        {"name": "Low", "dropLevel": 5},
    ]
    gap = riders_below_kit_level(members, kit, UNLOCKS)
    assert gap["kitMinLevel"] == 10
    assert gap["atKitLevelCount"] == 1
    assert gap["belowKitLevelCount"] == 1


def test_at_kit_level_count_even_with_working_code():
    unlocks = [{
        "jerseySignature": 9,
        "jerseyName": "Level And Code",
        "minLevel": 10,
        "unlockCode": "OK",
        "codeStatus": "working",
    }]
    kit = {"club": "A", "jerseySignature": 9, "minLevel": 10, "assignment": "auto"}
    members = [
        {"name": "High", "dropLevel": 20},
        {"name": "Low", "dropLevel": 5},
    ]
    gap = riders_below_kit_level(members, kit, unlocks)
    assert gap["atKitLevelCount"] == 1
    assert gap["belowKitLevelCount"] == 0


def test_rider_coverage_counts_who_can_obtain_assigned_kit():
    riders = [
        {"club": "MTB Randers", "dropLevel": 66},
        {"club": "MTB Randers", "dropLevel": 43},
        {"club": "Low Club", "dropLevel": 12},
        {"club": "Low Club", "dropLevel": 8},
        {"club": "Code Club", "dropLevel": 1, "canEnterUnlockCode": True},
        {"club": "No Kit", "dropLevel": 80},
    ]
    kits = [
        {"club": "MTB Randers", "jerseySignature": 2, "minLevel": 50, "assignment": "auto"},
        {"club": "Low Club", "jerseySignature": 2, "minLevel": 50, "assignment": "auto"},
        {"club": "Code Club", "jerseySignature": 3, "assignment": "auto"},
    ]
    coverage = rider_assigned_kit_coverage(riders, kits, UNLOCKS)
    assert coverage["total"] == 5
    assert coverage["skipped"] == 1
    # MTB: 66 yes, 43 no (level 50); Low Club: 0; Code Club: 1; No Kit excluded
    assert coverage["canObtain"] == 2
    assert coverage["percent"] == 40.0


def test_rider_coverage_skips_custom_and_club_kits():
    riders = [
        {"club": "DZR", "dropLevel": 1},
        {"club": "DZR", "dropLevel": 12},
        {"club": "Custom Pin", "dropLevel": 5},
        {"club": "MTB Randers", "dropLevel": 66},
        {"club": "MTB Randers", "dropLevel": 43},
    ]
    kits = [
        {"club": "DZR", "jerseySignature": 99, "source": "club", "assignment": "pinned"},
        {"club": "Custom Pin", "jerseySignature": 88, "assignment": "pinned"},
        {"club": "MTB Randers", "jerseySignature": 40, "minLevel": 40, "source": "level", "assignment": "auto"},
    ]
    unlocks = [{"jerseySignature": 40, "jerseyName": "Level 40", "minLevel": 40}]
    coverage = rider_assigned_kit_coverage(riders, kits, unlocks)
    assert coverage["skipped"] == 3
    assert coverage["total"] == 2
    assert coverage["canObtain"] == 2
    assert coverage["percent"] == 100.0


def test_rider_coverage_level_40_both_riders():
    riders = [
        {"club": "MTB Randers", "dropLevel": 66},
        {"club": "MTB Randers", "dropLevel": 43},
    ]
    unlocks = [{"jerseySignature": 40, "jerseyName": "Level 40", "minLevel": 40}]
    kits = [{"club": "MTB Randers", "jerseySignature": 40, "minLevel": 40, "assignment": "auto"}]
    coverage = rider_assigned_kit_coverage(riders, kits, unlocks)
    assert coverage["canObtain"] == 2
    assert coverage["percent"] == 100.0


def test_riders_below_kit_level_ignores_working_code_kits():
    kit = {"club": "A", "jerseySignature": 3, "assignment": "auto"}
    members = [{"name": "Low", "dropLevel": 1}]
    gap = riders_below_kit_level(members, kit, UNLOCKS)
    assert gap["belowKitLevelCount"] == 0
    assert gap["atKitLevelCount"] is None


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
        {"club": "A", "dropLevel": None, "canEnterUnlockCode": True},
        {"club": "B", "dropLevel": None, "canEnterUnlockCode": True},
    ]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=[], riders=riders)
    assert preview["coverage"]["autoCount"] == 2
    assert preview["coverage"]["sharedJerseyCount"] == 0
    assert {row["jerseySignature"] for row in preview["auto"]} == {3, 6}


def test_tvos_club_does_not_get_p_code_jersey():
    riders = [
        {"club": "TV Club", "dropLevel": 1, "gameClientPlatform": "tvos", "canEnterUnlockCode": False},
        {"club": "TV Club", "dropLevel": 2, "gameClientPlatform": "ios"},
    ]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=[], riders=riders)
    assert preview["coverage"]["autoCount"] == 1
    assert preview["auto"][0]["jerseySignature"] == 6
    saved = [{
        "club": "TV Club",
        "jerseySignature": 3,
        "jerseyName": "Working Code",
        "assignment": "auto",
        "unlockCode": "WORKS",
        "codeStatus": "working",
    }]
    kept = preview_auto_assignment(unlocks=UNLOCKS, club_kits=saved, riders=riders, mode="new")
    assert kept["auto"][0]["jerseySignature"] == 3
    assert kept["changes"] == []
    reshuffle = preview_auto_assignment(unlocks=UNLOCKS, club_kits=saved, riders=riders, mode="minimal")
    assert reshuffle["auto"][0]["jerseySignature"] == 6
    assert reshuffle["changes"][0]["toSignature"] == 6


def test_assign_auto_rejects_code_kit_for_non_pc_mac():
    try:
        assign_auto_club_kit(
            club="TV Club",
            signature=3,
            club_kits=[],
            unlocks=UNLOCKS,
            members=[{"name": "Apple TV", "dropLevel": 1, "gameClientPlatform": "tvos"}],
        )
        raise AssertionError("expected P-code rejection")
    except ValueError as exc:
        assert "PC/Mac" in str(exc)


def test_riders_blocked_from_code_kit_skips_level_grant():
    kit = {"club": "A", "jerseySignature": 3, "assignment": "auto"}
    members = [
        {"name": "TV", "dropLevel": 1, "gameClientPlatform": "tvos"},
        {"name": "PC", "dropLevel": 1, "canEnterUnlockCode": True},
    ]
    gap = riders_blocked_from_code_kit(members, kit, UNLOCKS)
    assert gap["cannotEnterCodeCount"] == 1
    assert gap["cannotEnterCode"][0]["name"] == "TV"


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


def test_assign_auto_leaves_other_clubs_and_allows_doubles():
    existing = [
        {"club": "Børkop Motion Cyklister", "jerseySignature": 3, "assignment": "auto"},
        {"club": "DZR", "jerseySignature": 99, "assignment": "pinned"},
    ]
    next_rows = assign_auto_club_kit(
        club="Viborg MTB",
        signature=3,
        club_kits=existing,
        unlocks=UNLOCKS,
    )
    by_club = {row["club"]: row for row in next_rows}
    assert by_club["Børkop Motion Cyklister"]["jerseySignature"] == 3
    assert by_club["DZR"]["assignment"] == "pinned"
    assert by_club["Viborg MTB"]["assignment"] == "auto"
    assert by_club["Viborg MTB"]["jerseySignature"] == 3
    assert by_club["Viborg MTB"]["jerseyName"] == "Working Code"


def test_assign_auto_rejects_jersey_pinned_elsewhere():
    existing = [{"club": "DZR", "jerseySignature": 99, "assignment": "pinned"}]
    try:
        assign_auto_club_kit(club="Viborg MTB", signature=99, club_kits=existing, unlocks=UNLOCKS)
        raise AssertionError("expected pin collision")
    except ValueError as exc:
        assert "pinned" in str(exc).lower()


def test_preview_keeps_saved_auto_and_only_fills_missing():
    riders = [
        {"club": "Saved", "dropLevel": 80},
        {"club": "New", "dropLevel": 80},
    ]
    saved = [{"club": "Saved", "jerseySignature": 1, "jerseyName": "Level 5", "assignment": "auto"}]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=saved, riders=riders)
    by_club = {row["club"]: row for row in preview["proposedClubKits"]}
    assert by_club["Saved"]["jerseySignature"] == 1
    assert by_club["New"]["assignment"] == "auto"
    assert by_club["New"]["jerseySignature"] != 1
    reshuffle = preview_auto_assignment(
        unlocks=UNLOCKS, club_kits=saved, riders=riders, preserve_saved=False,
    )
    # Full reshuffle may pick a different unique kit for Saved; missing still assigned.
    assert {row["club"] for row in reshuffle["proposedClubKits"]} == {"Saved", "New"}


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


def test_rider_payload_hides_p_code_unless_pc_mac():
    settings = {
        "jerseyUnlocks": UNLOCKS,
        "clubKits": [{
            "club": "Code Club",
            "jerseySignature": 3,
            "jerseyName": "Working Code",
            "assignment": "auto",
        }],
    }
    blocked = rider_club_kit_payload(
        club="Code Club",
        settings=settings,
        drop_level=1,
        can_enter_unlock_code=False,
    )
    assert blocked is not None
    assert blocked["showCode"] is False
    assert blocked["codeBlocked"] is True
    assert blocked["unlockCode"] is None
    allowed = rider_club_kit_payload(
        club="Code Club",
        settings=settings,
        drop_level=1,
        can_enter_unlock_code=True,
    )
    assert allowed is not None
    assert allowed["showCode"] is True
    assert allowed["unlockCode"] == "WORKS"


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


def test_scratch_reassigns_autos_and_keeps_pins():
    riders = [
        {"club": "Pinned Club", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "A", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "B", "dropLevel": 80, "canEnterUnlockCode": True},
    ]
    saved = [
        {"club": "Pinned Club", "jerseySignature": 2, "jerseyName": "Level 50", "assignment": "pinned"},
        {"club": "A", "jerseySignature": 1, "jerseyName": "Level 5", "assignment": "auto"},
        {"club": "B", "jerseySignature": 1, "jerseyName": "Level 5", "assignment": "auto"},
    ]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=saved, riders=riders, mode="scratch")
    by_club = {row["club"]: row for row in preview["proposedClubKits"]}
    assert by_club["Pinned Club"]["assignment"] == "pinned"
    assert by_club["Pinned Club"]["jerseySignature"] == 2
    assert by_club["A"]["jerseySignature"] == 3
    assert by_club["B"]["jerseySignature"] != 3
    assert 2 not in {by_club["A"]["jerseySignature"], by_club["B"]["jerseySignature"]}
    assert "Pinned Club" not in {row["club"] for row in preview["changes"]}


def test_scratch_assigns_code_jerseys_to_all_pc_clubs_before_level_kits():
    riders = [
        {"club": "PC Club", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "Console", "dropLevel": 80, "canEnterUnlockCode": False},
    ]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=[], riders=riders, mode="scratch")
    by_club = {row["club"]: row for row in preview["proposedClubKits"]}
    assert by_club["PC Club"]["jerseySignature"] == 3
    assert by_club["Console"]["jerseySignature"] != 3


def test_scratch_does_not_give_code_jersey_to_mixed_club():
    riders = [
        {"club": "Mixed", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "Mixed", "dropLevel": 80, "canEnterUnlockCode": False},
        {"club": "PC Club", "dropLevel": 8, "canEnterUnlockCode": True},
    ]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=[], riders=riders, mode="scratch")
    by_club = {row["club"]: row for row in preview["proposedClubKits"]}
    assert by_club["PC Club"]["jerseySignature"] == 3
    assert by_club["Mixed"]["jerseySignature"] != 3


def test_new_mode_keeps_existing_and_fills_missing():
    riders = [
        {"club": "Saved", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "New", "dropLevel": 80, "canEnterUnlockCode": True},
    ]
    saved = [{"club": "Saved", "jerseySignature": 1, "jerseyName": "Level 5", "assignment": "auto"}]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=saved, riders=riders, mode="new")
    by_club = {row["club"]: row for row in preview["proposedClubKits"]}
    assert by_club["Saved"]["jerseySignature"] == 1
    assert by_club["New"]["jerseySignature"] != 1
    assert [row["club"] for row in preview["changes"]] == ["New"]


def test_minimal_keeps_full_coverage_and_assigns_new_club():
    riders = [
        {"club": "Full", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "Full", "dropLevel": 80, "canEnterUnlockCode": True},
        {"club": "New", "dropLevel": 8, "canEnterUnlockCode": True},
    ]
    saved = [{"club": "Full", "jerseySignature": 1, "jerseyName": "Level 5", "assignment": "auto"}]
    preview = preview_auto_assignment(unlocks=UNLOCKS, club_kits=saved, riders=riders, mode="minimal")
    by_club = {row["club"]: row for row in preview["proposedClubKits"]}
    assert by_club["Full"]["jerseySignature"] == 1
    assert by_club["New"]["jerseySignature"] in {3, 6}
    assert all(row["club"] != "Full" for row in preview["changes"])


def test_commit_rejects_moved_pin():
    from services.club_kits import commit_club_kit_proposal

    existing = [{"club": "DZR", "jerseySignature": 2, "assignment": "pinned", "jerseyName": "Level 50"}]
    try:
        commit_club_kit_proposal(
            proposed=[{"club": "DZR", "jerseySignature": 1, "assignment": "pinned"}],
            existing=existing,
            unlocks=UNLOCKS,
        )
        raise AssertionError("expected pin lock")
    except ValueError as exc:
        assert "Pin" in str(exc)


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
