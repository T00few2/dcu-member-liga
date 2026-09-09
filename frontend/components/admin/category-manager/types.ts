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

export type { LigaCategoryDef as CategoryDef } from '@/lib/ligaCategories';
export {
  ZR_CATEGORY_DEFAULTS,
  ZR_CATEGORY_STYLES,
} from '@/lib/ligaCategories';

export type CategoryChangelogOp =
  | { op: 'mergeUp'; from: string; into: string }
  | { op: 'rename'; from: string; to: string }
  | { op: 'split'; from: string; into: [string, string]; mid: number };
