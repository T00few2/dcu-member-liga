export interface CategoryDef {
  name: string;
  upper: number | null; // null = no upper limit (top category, must be first)
  /** Weight verification sampling + dual-recording reports when true. */
  requiresVerification?: boolean;
}

export interface LigaCategory {
  category: string;
  upperBoundary: number | null;
  graceLimit: number | null;
  assignedRating: number;
  status: 'ok' | 'grace' | 'over';
  lastCheckedRating: number;
  lastCheckedAt?: number;
  assignedAt?: number;
  locked?: boolean;
  autoAssignedCategory?: string;
  selfSelectedCategory?: string;
  manualAssignedCategory?: string;
  manualAssignedFrom?: string;
  predictedVelo?: number;
}

export interface RiderEntry {
  zwiftId: string;
  name: string;
  club: string;
  currentRating: number | string;
  max30Rating: number | string;
  max90Rating: number | string;
  effectiveRating: number | string;
  ligaCategory: LigaCategory | null;
}

export type FilterMode = 'all' | 'grace' | 'over' | 'manual';

export const ZR_CATEGORY_STYLES: Record<string, string> = {
  Diamond:  'bg-cyan-100 text-cyan-800',
  Ruby:     'bg-red-100 text-red-800',
  Emerald:  'bg-green-100 text-green-800',
  Sapphire: 'bg-blue-100 text-blue-800',
  Amethyst: 'bg-purple-100 text-purple-800',
  Platinum: 'bg-slate-100 text-slate-700',
  Gold:     'bg-yellow-100 text-yellow-800',
  Silver:   'bg-gray-100 text-gray-700',
  Bronze:   'bg-orange-100 text-orange-800',
  Copper:   'bg-amber-100 text-amber-800',
};

export const ZR_CATEGORY_DEFAULTS: CategoryDef[] = [
  { name: 'Diamond',  upper: null, requiresVerification: true },
  { name: 'Ruby',     upper: 2200, requiresVerification: true },
  { name: 'Emerald',  upper: 1900, requiresVerification: false },
  { name: 'Sapphire', upper: 1650, requiresVerification: false },
  { name: 'Amethyst', upper: 1450, requiresVerification: false },
  { name: 'Platinum', upper: 1300, requiresVerification: false },
  { name: 'Gold',     upper: 1150, requiresVerification: false },
  { name: 'Silver',   upper: 1000, requiresVerification: false },
  { name: 'Bronze',   upper:  850, requiresVerification: false },
  { name: 'Copper',   upper:  650, requiresVerification: false },
];
