export type LigaCategoryDef = {
  name: string;
  upper?: number | null;
  requiresVerification?: boolean;
  /** Badge background as #RRGGBB. */
  color?: string;
};

export type CategoryBadgeColors = {
  backgroundColor: string;
  color: string;
};

export const ZR_CATEGORY_DEFAULTS: LigaCategoryDef[] = [
  { name: 'Diamond', upper: null, requiresVerification: true, color: '#b9f2ff' },
  { name: 'Ruby', upper: 2200, requiresVerification: true, color: '#ff4e6a' },
  { name: 'Emerald', upper: 1900, requiresVerification: false, color: '#50c878' },
  { name: 'Sapphire', upper: 1650, requiresVerification: false, color: '#0f52ba' },
  { name: 'Amethyst', upper: 1450, requiresVerification: false, color: '#9b59b6' },
  { name: 'Platinum', upper: 1300, requiresVerification: false, color: '#e5e4e2' },
  { name: 'Gold', upper: 1150, requiresVerification: false, color: '#ffd700' },
  { name: 'Silver', upper: 1000, requiresVerification: false, color: '#c0c0c0' },
  { name: 'Bronze', upper: 850, requiresVerification: false, color: '#cd7f32' },
  { name: 'Copper', upper: 650, requiresVerification: false, color: '#b87333' },
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

/** Official Zwift A–E badge colors (white letter on the category disc). */
export const ZWIFT_CATEGORY_COLORS: Record<string, CategoryBadgeColors> = {
  A: { backgroundColor: '#e53935', color: '#ffffff' },
  B: { backgroundColor: '#43a047', color: '#ffffff' },
  C: { backgroundColor: '#00bcd4', color: '#ffffff' },
  D: { backgroundColor: '#fbc02d', color: '#ffffff' },
  E: { backgroundColor: '#8e24aa', color: '#ffffff' },
};

export const CATEGORY_COLOR_PRESETS = [
  '#1d4ed8',
  '#0f766e',
  '#7c3aed',
  '#c2410c',
  '#a16207',
  '#334155',
  '#be123c',
  '#0369a1',
  '#4d7c0f',
  '#6d28d9',
];

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

export function parseCategoryHex(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(s)) {
    return `#${s[1]}${s[1]}${s[2]}${s[2]}${s[3]}${s[3]}`.toLowerCase();
  }
  return null;
}

export function contrastTextColor(bg: string): string {
  const hex = parseCategoryHex(bg);
  if (!hex) return '#1f2937';
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 150 ? '#1f2937' : '#ffffff';
}

export function zwiftCategoryColors(name: string): CategoryBadgeColors | null {
  const key = name.trim().toUpperCase();
  if (key.length === 1 && ZWIFT_CATEGORY_COLORS[key]) return ZWIFT_CATEGORY_COLORS[key];
  return null;
}

export function fallbackCategoryHex(index: number): string {
  return CATEGORY_COLOR_PRESETS[index % CATEGORY_COLOR_PRESETS.length];
}

export function editorColorForCategory(cat: LigaCategoryDef, index: number): string {
  return parseCategoryHex(cat.color) ?? fallbackCategoryHex(index);
}

export function categoryColors(
  name: string,
  cats?: LigaCategoryDef[] | null,
): CategoryBadgeColors | null {
  const zwift = zwiftCategoryColors(name);
  if (zwift) return zwift;

  const trimmed = name.trim();
  const idx = cats?.findIndex((c) => c.name === trimmed) ?? -1;
  const def = idx >= 0 ? cats![idx] : undefined;
  const stored = parseCategoryHex(def?.color);
  if (stored) return { backgroundColor: stored, color: contrastTextColor(stored) };

  const gem = ZR_CATEGORY_GEMS[trimmed];
  if (gem) return { backgroundColor: gem.color, color: gem.textColor };

  if (idx >= 0) {
    const fallback = fallbackCategoryHex(idx);
    return { backgroundColor: fallback, color: contrastTextColor(fallback) };
  }
  return null;
}

export function categoryBadgeAppearance(
  name: string,
  cats?: LigaCategoryDef[] | null,
): { className: string; style?: CategoryBadgeColors } {
  const colors = categoryColors(name, cats);
  if (colors) return { className: '', style: colors };
  return { className: ZR_CATEGORY_STYLES[name] ?? 'bg-slate-100 text-slate-800' };
}

export function categoryStyle(name: string, cats?: LigaCategoryDef[] | null): string {
  const zwift = name.trim().toUpperCase();
  if (zwift.length === 1 && ZWIFT_CATEGORY_COLORS[zwift]) {
    const tw: Record<string, string> = {
      A: 'bg-red-600 text-white',
      B: 'bg-green-600 text-white',
      C: 'bg-cyan-500 text-white',
      D: 'bg-yellow-400 text-white',
      E: 'bg-purple-700 text-white',
    };
    return tw[zwift];
  }
  return categoryBadgeAppearance(name, cats).className || 'bg-slate-100 text-slate-800';
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
