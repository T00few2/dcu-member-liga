import logging
import os
import sys

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.category_changelog import liga_categories_fingerprint
from services.category_engine import ZR_CATEGORY_DEFS
from services.liga_categories_config import ConfigApplyError, run_liga_categories_config, validate_submitted_shape


class _SettingsDoc:
    def __init__(self, data):
        self._data = data
        self.exists = True

    def to_dict(self):
        return self._data


class _SettingsRef:
    def __init__(self, data):
        self._data = data

    def get(self):
        return _SettingsDoc(self._data)


class _EmptyQuery:
    def stream(self):
        return iter([])

    def where(self, *_args, **_kwargs):
        return self


class _FakeDB:
    def __init__(self, settings):
        self._settings = settings

    def collection(self, name):
        if name == "league":
            return self
        return _EmptyQuery()

    def document(self, _id):
        return _SettingsRef(self._settings)


def test_stale_fingerprint_rejected_on_apply():
    db = _FakeDB({"ligaCategories": ZR_CATEGORY_DEFS, "gracePeriod": 35})
    with pytest.raises(ConfigApplyError) as ei:
        run_liga_categories_config(
            db,
            logging.getLogger("test"),
            submitted_raw=ZR_CATEGORY_DEFS,
            ops=[],
            dry_run=False,
            expected_fingerprint="stale",
        )
    assert ei.value.status_code == 409


def test_missing_fingerprint_rejected_on_apply():
    db = _FakeDB({"ligaCategories": ZR_CATEGORY_DEFS, "gracePeriod": 35})
    with pytest.raises(ConfigApplyError, match="expectedFingerprint"):
        run_liga_categories_config(
            db,
            logging.getLogger("test"),
            submitted_raw=ZR_CATEGORY_DEFS,
            ops=[],
            dry_run=False,
            expected_fingerprint=None,
        )


def test_matching_fingerprint_dry_run_is_noop_remap():
    defs = ZR_CATEGORY_DEFS
    db = _FakeDB({"ligaCategories": defs, "gracePeriod": 35})
    result = run_liga_categories_config(
        db,
        logging.getLogger("test"),
        submitted_raw=defs,
        ops=[],
        dry_run=True,
        expected_fingerprint=liga_categories_fingerprint(defs),
    )
    assert result["dryRun"] is True
    assert result["remap"] == {}
    assert result["counts"]["usersUpdated"] == 0
    assert result["counts"]["signupRewrite"] == 0


def test_assign_route_ignores_request_body_categories():
    path = os.path.join(os.path.dirname(__file__), "..", "routes", "admin_liga_categories_management_routes.py")
    with open(path, encoding="utf-8") as fh:
        src = fh.read()
    start = src.index("def assign_liga_categories")
    end = src.index("\n@admin_bp.route", start + 1)
    fn = src[start:end]
    assert 'body.get("categories")' not in fn
    assert 'settings.get("ligaCategories")' in fn


def test_submitted_categories_keep_valid_color():
    cats = [
        {"name": "1. Division", "upper": None, "color": "#1D4ED8", "requiresVerification": True},
        {"name": "2. Division", "upper": 900, "color": "not-a-color"},
    ]
    out = validate_submitted_shape(cats)
    assert out[0]["color"] == "#1d4ed8"
    assert "color" not in out[1]


def test_color_does_not_change_fingerprint():
    base = [{"name": "1. Division", "upper": None}, {"name": "2. Division", "upper": 900}]
    colored = [
        {"name": "1. Division", "upper": None, "color": "#1d4ed8"},
        {"name": "2. Division", "upper": 900, "color": "#0f766e"},
    ]
    assert liga_categories_fingerprint(base) == liga_categories_fingerprint(colored)
