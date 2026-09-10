import { describe, expect, it } from 'vitest';
import type { RiderEntry } from '@/components/admin/category-manager/types';
import {
  assignedCategoryCount,
  countAssignedToCategory,
} from '@/components/admin/category-manager/utils';

function rider(partial: Partial<RiderEntry> & Pick<RiderEntry, 'zwiftId' | 'name'>): RiderEntry {
  return {
    club: 'Test CC',
    currentRating: 'N/A',
    max30Rating: 'N/A',
    max90Rating: 'N/A',
    effectiveRating: 'N/A',
    ligaCategory: null,
    ...partial,
  };
}

function assigned(category: string, extra: Partial<NonNullable<RiderEntry['ligaCategory']>> = {}) {
  return {
    category,
    upperBoundary: null,
    graceLimit: null,
    assignedRating: 0,
    status: 'ok' as const,
    lastCheckedRating: 0,
    ...extra,
  };
}

describe('countAssignedToCategory', () => {
  it('counts assigned category names, including manuals, not current vELO', () => {
    const riders: RiderEntry[] = [
      rider({
        zwiftId: '1',
        name: 'High vELO in 2. Division',
        effectiveRating: 2300,
        ligaCategory: assigned('2. Division', { manualAssignedCategory: '2. Division' }),
      }),
      rider({
        zwiftId: '2',
        name: 'No rating still 1. Division',
        ligaCategory: assigned('1. Division', { locked: true }),
      }),
      rider({
        zwiftId: '3',
        name: 'Unassigned',
        effectiveRating: 2500,
      }),
      rider({
        zwiftId: '4',
        name: 'Auto 1. Division',
        effectiveRating: 2210,
        ligaCategory: assigned('1. Division'),
      }),
    ];

    expect(countAssignedToCategory(riders, '1. Division')).toBe(2);
    expect(countAssignedToCategory(riders, '2. Division')).toBe(1);
    expect(assignedCategoryCount(riders)).toBe(3);
  });
});
