import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.zwift_drop_levels import ensure_drop_level_fields


def test_ensure_drop_level_keeps_hundredths(monkeypatch):
    def _should_not_fetch(*_args, **_kwargs):
        raise AssertionError("should not fetch")

    monkeypatch.setattr("services.zwift_drop_levels.fetch_json_profile", _should_not_fetch)
    out = ensure_drop_level_fields(123, {"dropLevel": 80, "achievementLevel": 8050})
    assert out["dropLevel"] == 80


def test_ensure_drop_level_overrides_official_xp_level(monkeypatch):
    monkeypatch.setattr("services.zwift_drop_levels.game_client_access_token", lambda: "token")
    monkeypatch.setattr(
        "services.zwift_drop_levels.fetch_json_profile",
        lambda _token, _zwift_id: {"achievementLevel": 4661, "totalExperiencePoints": 365605},
    )
    out = ensure_drop_level_fields(661768, {"dropLevel": 63, "achievementLevel": 63})
    assert out["dropLevel"] == 46
    assert out["achievementLevel"] == 4661
    assert out["totalExperiencePoints"] == 365605


def test_ensure_drop_level_fills_from_unofficial_json(monkeypatch):
    monkeypatch.setattr("services.zwift_drop_levels.game_client_access_token", lambda: "token")
    monkeypatch.setattr(
        "services.zwift_drop_levels.fetch_json_profile",
        lambda _token, _zwift_id: {"achievementLevel": 11202, "totalExperiencePoints": 9},
    )
    out = ensure_drop_level_fields(123, {"ftp": 200})
    assert out["dropLevel"] == 112
    assert out["ftp"] == 200
    assert out["achievementLevel"] == 11202


def test_ensure_drop_level_survives_auth_error(monkeypatch):
    from services.zwift_drop_levels import DropLevelAuthError

    def _missing_creds():
        raise DropLevelAuthError("missing")

    monkeypatch.setattr("services.zwift_drop_levels.game_client_access_token", _missing_creds)
    out = ensure_drop_level_fields(123, {})
    assert out == {}
