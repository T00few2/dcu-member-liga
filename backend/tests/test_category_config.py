"""
Unit tests for CategoryConfigResolver.

Run with:  pytest backend/tests/test_category_config.py -v
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from services.category_config import CategoryConfigResolver


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def race_data_single_mode(sprints=None, segment_type='sprint', categories=None):
    """Build a race_data dict using single-event mode config."""
    return {
        'sprints': sprints or [],
        'segmentType': segment_type,
        'manualDQs': [],
        'manualDeclassifications': [],
        'manualExclusions': [],
        'singleModeCategories': categories or [],
    }


def race_data_multi_mode(event_configuration=None, sprints=None, segment_type='sprint'):
    """Build a race_data dict using multi-event mode config."""
    return {
        'eventMode': 'multi',
        'eventConfiguration': event_configuration or [],
        'sprints': sprints or [],
        'segmentType': segment_type,
        'manualDQs': [],
        'manualDeclassifications': [],
        'manualExclusions': [],
    }


SPRINT_A = {'id': 1, 'name': 'Sprint 1'}
SPRINT_B = {'id': 2, 'name': 'Sprint 2'}
SPRINT_GLOBAL = {'id': 99, 'name': 'Global Sprint'}


# ---------------------------------------------------------------------------
# get_sprints
# ---------------------------------------------------------------------------

class TestGetSprints:

    def test_returns_global_sprints_when_no_category_override(self):
        rd = race_data_single_mode(sprints=[SPRINT_GLOBAL])
        assert CategoryConfigResolver.get_sprints(rd, 'A') == [SPRINT_GLOBAL]

    def test_per_category_sprints_override_global_single_mode(self):
        rd = race_data_single_mode(
            sprints=[SPRINT_GLOBAL],
            categories=[
                {'category': 'A', 'sprints': [SPRINT_A]},
                {'category': 'B', 'sprints': [SPRINT_B]},
            ],
        )
        assert CategoryConfigResolver.get_sprints(rd, 'A') == [SPRINT_A]
        assert CategoryConfigResolver.get_sprints(rd, 'B') == [SPRINT_B]

    def test_per_category_sprints_override_global_multi_mode(self):
        rd = race_data_multi_mode(
            sprints=[SPRINT_GLOBAL],
            event_configuration=[
                {'customCategory': 'A', 'sprints': [SPRINT_A]},
                {'customCategory': 'B', 'sprints': [SPRINT_B]},
            ],
        )
        assert CategoryConfigResolver.get_sprints(rd, 'A') == [SPRINT_A]
        assert CategoryConfigResolver.get_sprints(rd, 'B') == [SPRINT_B]

    def test_falls_back_to_global_when_category_has_no_sprints(self):
        rd = race_data_single_mode(
            sprints=[SPRINT_GLOBAL],
            categories=[{'category': 'A', 'sprints': []}],
        )
        # Empty per-category list → fall back to global
        assert CategoryConfigResolver.get_sprints(rd, 'A') == [SPRINT_GLOBAL]

    def test_unknown_category_returns_global(self):
        rd = race_data_single_mode(sprints=[SPRINT_GLOBAL])
        assert CategoryConfigResolver.get_sprints(rd, 'Z') == [SPRINT_GLOBAL]

    def test_empty_race_data_returns_empty_list(self):
        assert CategoryConfigResolver.get_sprints({}, 'A') == []


# ---------------------------------------------------------------------------
# get_segment_type
# ---------------------------------------------------------------------------

class TestGetSegmentType:

    def test_returns_global_segment_type_by_default(self):
        rd = race_data_single_mode(segment_type='split')
        assert CategoryConfigResolver.get_segment_type(rd, 'A') == 'split'

    def test_per_category_segment_type_overrides_global(self):
        rd = race_data_single_mode(
            segment_type='sprint',
            categories=[{'category': 'A', 'segmentType': 'split'}],
        )
        assert CategoryConfigResolver.get_segment_type(rd, 'A') == 'split'
        # B has no override → falls back to global
        assert CategoryConfigResolver.get_segment_type(rd, 'B') == 'sprint'

    def test_defaults_to_sprint_when_no_segment_type(self):
        assert CategoryConfigResolver.get_segment_type({}, 'A') == 'sprint'

    def test_multi_mode_per_category_segment_type(self):
        rd = race_data_multi_mode(
            segment_type='sprint',
            event_configuration=[
                {'customCategory': 'A', 'segmentType': 'split'},
            ],
        )
        assert CategoryConfigResolver.get_segment_type(rd, 'A') == 'split'
        assert CategoryConfigResolver.get_segment_type(rd, 'B') == 'sprint'


# ---------------------------------------------------------------------------
# get_race_config
# ---------------------------------------------------------------------------

class TestGetRaceConfig:

    def test_includes_manual_overrides(self):
        rd = {
            'manualDQs': ['100'],
            'manualDeclassifications': ['200'],
            'manualExclusions': ['300'],
            'sprints': [],
            'segmentType': 'sprint',
        }
        config = CategoryConfigResolver.get_race_config(rd, 'A')
        assert config['manualDQs'] == ['100']
        assert config['manualDeclassifications'] == ['200']
        assert config['manualExclusions'] == ['300']

    def test_merges_per_category_sprints_and_segment_type(self):
        rd = race_data_single_mode(
            sprints=[SPRINT_GLOBAL],
            segment_type='sprint',
            categories=[{'category': 'A', 'sprints': [SPRINT_A], 'segmentType': 'split'}],
        )
        config = CategoryConfigResolver.get_race_config(rd, 'A')
        assert config['sprints'] == [SPRINT_A]
        assert config['segmentType'] == 'split'

    def test_defaults_for_missing_keys(self):
        config = CategoryConfigResolver.get_race_config({}, 'A')
        assert config['manualDQs'] == []
        assert config['manualDeclassifications'] == []
        assert config['manualExclusions'] == []
        assert config['sprints'] == []
        assert config['segmentType'] == 'sprint'
