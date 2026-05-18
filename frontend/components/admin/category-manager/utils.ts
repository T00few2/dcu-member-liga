import type { CategoryDef, RiderEntry } from './types';

/** Lower bound of category at index i (derived from next entry's upper, or 0). */
export function getCatLower(cats: CategoryDef[], i: number): number {
  if (i + 1 >= cats.length) return 0;
  return cats[i + 1].upper ?? 0;
}

/** Count riders whose effective rating falls within [lower, upper). */
export function countInRange(riders: RiderEntry[], lower: number, upper: number | null): number {
  return riders.filter(r => {
    const effective = parseFloat(String(r.effectiveRating));
    if (isNaN(effective)) return false;
    if (effective < lower) return false;
    if (upper !== null && effective >= upper) return false;
    return true;
  }).length;
}
