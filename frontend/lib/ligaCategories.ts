export type LigaCategoryDef = {
  name: string;
  upper?: number | null;
  requiresVerification?: boolean;
};

export const ZR_CATEGORY_DEFAULTS: LigaCategoryDef[] = [
  { name: 'Diamond', upper: null, requiresVerification: true },
  { name: 'Ruby', upper: 2200, requiresVerification: true },
  { name: 'Emerald', upper: 1900, requiresVerification: false },
  { name: 'Sapphire', upper: 1650, requiresVerification: false },
  { name: 'Amethyst', upper: 1450, requiresVerification: false },
  { name: 'Platinum', upper: 1300, requiresVerification: false },
  { name: 'Gold', upper: 1150, requiresVerification: false },
  { name: 'Silver', upper: 1000, requiresVerification: false },
  { name: 'Bronze', upper: 850, requiresVerification: false },
  { name: 'Copper', upper: 650, requiresVerification: false },
];

export const ZR_CATEGORY_STYLES: Record<string, string> = {
  Diamond: 'bg-cyan-100 text-cyan-800',
  Ruby: 'bg-red-100 text-red-800',
  Emerald: 'bg-green-100 text-green-800',
  Sapphire: 'bg-blue-100 text-blue-800',
  Amethyst: 'bg-purple-100 text-purple-800',
  Platinum: 'bg-slate-100 text-slate-700',
  Gold: 'bg-yellow-100 text-yellow-800',
  Silver: 'bg-gray-100 text-gray-700',
  Bronze: 'bg-orange-100 text-orange-800',
  Copper: 'bg-amber-100 text-amber-800',
};

export const ZR_CATEGORY_GEMS: Record<string, { gem: string; color: string; textColor: string }> = {
  Diamond: { gem: '💎', color: '#b9f2ff', textColor: '#0e4f6b' },
  Ruby: { gem: '♦️', color: '#ff4e6a', textColor: '#fff' },
  Emerald: { gem: '💚', color: '#50c878', textColor: '#fff' },
  Sapphire: { gem: '💙', color: '#0f52ba', textColor: '#fff' },
  Amethyst: { gem: '💜', color: '#9b59b6', textColor: '#fff' },
  Platinum: { gem: '⬜', color: '#e5e4e2', textColor: '#374151' },
  Gold: { gem: '🥇', color: '#ffd700', textColor: '#374151' },
  Silver: { gem: '🥈', color: '#c0c0c0', textColor: '#374151' },
  Bronze: { gem: '🥉', color: '#cd7f32', textColor: '#fff' },
  Copper: { gem: '🔶', color: '#b87333', textColor: '#fff' },
};

const LETTER_CATS = ['A', 'B', 'C', 'D', 'E'];

export function effectiveLigaCategories(
  settings?: { ligaCategories?: LigaCategoryDef[] } | null,
): LigaCategoryDef[] {
  const cats = settings?.ligaCategories;
  if (Array.isArray(cats) && cats.length >= 2) return cats;
  return ZR_CATEGORY_DEFAULTS;
}

export function ligaCategoryNames(settings?: { ligaCategories?: LigaCategoryDef[] } | null): string[] {
  return effectiveLigaCategories(settings).map((c) => c.name).filter(Boolean);
}

export function categoryRankOrder(settings?: { ligaCategories?: LigaCategoryDef[] } | null): string[] {
  return [...ligaCategoryNames(settings), ...LETTER_CATS];
}

export function categoryFromVelo(rating: number | string, cats: LigaCategoryDef[]): string {
  const r = Number(rating);
  if (!Number.isFinite(r) || rating === 'N/A') return '-';
  for (let i = 0; i < cats.length; i++) {
    const upper = cats[i].upper;
    const lower = cats[i + 1]?.upper ?? 0;
    if (r >= lower && (upper == null || r < upper)) return cats[i].name;
  }
  return cats[cats.length - 1]?.name ?? '-';
}

export function veloForCategory(catName: string, cats: LigaCategoryDef[]): number | null {
  const idx = cats.findIndex((c) => c.name === catName);
  if (idx === -1) return null;
  const upper = cats[idx].upper;
  const lower = cats[idx + 1]?.upper ?? 0;
  return upper == null ? lower + 300 : Math.round((upper + lower) / 2);
}

export function categoryStyle(name: string): string {
  return ZR_CATEGORY_STYLES[name] ?? 'bg-slate-100 text-slate-800';
}

export function catLower(cats: LigaCategoryDef[], index: number): number {
  return cats[index + 1]?.upper ?? 0;
}

function asRating(value: unknown): number | null {
  if (value == null || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/** vELO shown next to live category bounds: hold rating if manual, else last nightly check. */
export function ratingMatchingCategoryBounds(lc: {
  assignedRating?: number | null;
  lastCheckedRating?: number | null;
  manualAssignedCategory?: string | null;
} | null | undefined): number | null {
  if (!lc) return null;
  if (lc.manualAssignedCategory) return asRating(lc.assignedRating);
  return asRating(lc.lastCheckedRating) ?? asRating(lc.assignedRating);
}
