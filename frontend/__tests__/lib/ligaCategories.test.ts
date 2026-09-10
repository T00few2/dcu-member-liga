import { describe, expect, it } from 'vitest';
import {
  categoryBadgeAppearance,
  categoryColors,
  parseCategoryHex,
  ratingMatchingCategoryBounds,
  zwiftCategoryColors,
} from '@/lib/ligaCategories';

describe('ratingMatchingCategoryBounds', () => {
  it('uses last checked vELO when there is no manual hold', () => {
    expect(ratingMatchingCategoryBounds({
      assignedRating: 1775,
      lastCheckedRating: 1964,
    })).toBe(1964);
  });

  it('falls back to assigned rating before the first nightly check', () => {
    expect(ratingMatchingCategoryBounds({
      assignedRating: 1964,
    })).toBe(1964);
  });

  it('uses the hold rating while a manual category is set', () => {
    expect(ratingMatchingCategoryBounds({
      assignedRating: 1775,
      lastCheckedRating: 1964,
      manualAssignedCategory: 'Division 3',
    })).toBe(1775);
  });
});

describe('category colors', () => {
  it('parses 3- and 6-digit hex', () => {
    expect(parseCategoryHex('#1D4ED8')).toBe('#1d4ed8');
    expect(parseCategoryHex('#abc')).toBe('#aabbcc');
    expect(parseCategoryHex('red')).toBeNull();
  });

  it('uses official Zwift A–E disc colors', () => {
    expect(zwiftCategoryColors('C')).toEqual({ backgroundColor: '#00bcd4', color: '#ffffff' });
    expect(categoryBadgeAppearance('A').style).toEqual({ backgroundColor: '#e53935', color: '#ffffff' });
  });

  it('uses stored liga category hex when provided', () => {
    const cats = [
      { name: '1. Division', upper: null, color: '#1D4ED8' },
      { name: '6. Division', upper: 500, color: '#334155' },
    ];
    expect(categoryColors('6. Division', cats)).toEqual({
      backgroundColor: '#334155',
      color: '#ffffff',
    });
  });
});
