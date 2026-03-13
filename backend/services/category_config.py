"""
CategoryConfigResolver — centralised per-category configuration lookup.

Eliminates the triplication of category-config logic that previously existed
in ResultsProcessor._get_category_config(), LeagueEngine._get_category_sprints(),
and LeagueEngine._get_category_segment_type().

Usage:
    from services.category_config import CategoryConfigResolver

    config = CategoryConfigResolver.get_race_config(race_data, 'A')
    sprints = CategoryConfigResolver.get_sprints(race_data, 'B')
    seg_type = CategoryConfigResolver.get_segment_type(race_data, 'C')
"""
from __future__ import annotations

from typing import Any

from models import RaceConfig, SegmentType, SprintConfig

# Default segment type used when none is specified.
DEFAULT_SEGMENT_TYPE: SegmentType = 'sprint'


class CategoryConfigResolver:
    """
    Stateless helper that extracts per-category sprint/segment configuration
    from a race data document.

    Race data may configure categories in two ways:
      - Multi-event mode: race_data['eventConfiguration'] with 'customCategory' keys.
      - Single-event mode: race_data['singleModeCategories'] with 'category' keys.

    Falls back to top-level race_data fields when no per-category override exists.
    """

    @staticmethod
    def _find_category_cfg(
        race_data: dict[str, Any], category: str
    ) -> dict[str, Any] | None:
        """Return the per-category config block, or None if not found."""
        # Multi-event mode
        if race_data.get('eventMode') == 'multi' and race_data.get('eventConfiguration'):
            for cfg in race_data['eventConfiguration']:
                if cfg.get('customCategory') == category:
                    return cfg

        # Single-event mode
        if race_data.get('singleModeCategories'):
            for cfg in race_data['singleModeCategories']:
                if cfg.get('category') == category:
                    return cfg

        return None

    @classmethod
    def get_sprints(cls, race_data: dict[str, Any], category: str) -> list[SprintConfig]:
        """Return the sprint/segment list for a category.

        Per-category sprints take precedence; falls back to the global sprint list.
        """
        cat_cfg = cls._find_category_cfg(race_data, category)
        if cat_cfg:
            per_cat = cat_cfg.get('sprints')
            if per_cat:
                return per_cat
        return race_data.get('sprints', [])

    @classmethod
    def get_segment_type(cls, race_data: dict[str, Any], category: str) -> SegmentType:
        """Return the segment type ('sprint' or 'split') for a category."""
        cat_cfg = cls._find_category_cfg(race_data, category)
        if cat_cfg:
            return cat_cfg.get('segmentType') or race_data.get('segmentType', DEFAULT_SEGMENT_TYPE)
        return race_data.get('segmentType', DEFAULT_SEGMENT_TYPE)

    @classmethod
    def get_race_config(cls, race_data: dict[str, Any], category: str) -> RaceConfig:
        """Build a full RaceConfig for a category, merging per-category overrides."""
        config: RaceConfig = {
            'manualDQs': race_data.get('manualDQs', []),
            'manualDeclassifications': race_data.get('manualDeclassifications', []),
            'manualExclusions': race_data.get('manualExclusions', []),
            'segmentType': cls.get_segment_type(race_data, category),
            'sprints': cls.get_sprints(race_data, category),
        }
        return config
