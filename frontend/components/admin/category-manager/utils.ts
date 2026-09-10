import type { CategoryDef, RiderEntry } from './types';

/** Lower bound of category at index i (derived from next entry's upper, or 0). */
export function getCatLower(cats: CategoryDef[], i: number): number {
  if (i + 1 >= cats.length) return 0;
  return cats[i + 1].upper ?? 0;
}

/** Count riders whose assigned liga category (auto, manual, locked, self-selected) matches `categoryName`. */
export function countAssignedToCategory(riders: RiderEntry[], categoryName: string): number {
  return riders.filter(r => r.ligaCategory?.category === categoryName).length;
}

export function assignedCategoryCount(riders: RiderEntry[]): number {
  return riders.filter(r => Boolean(r.ligaCategory?.category)).length;
}
