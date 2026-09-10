import { describe, expect, it } from 'vitest';
import { ratingMatchingCategoryBounds } from '@/lib/ligaCategories';

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
