// Shared types, constants and pure helpers used across CategoryPredictor sub-components.
// Not a React file — no JSX.

import {
  ZR_CATEGORY_DEFAULTS,
  ZR_CATEGORY_STYLES,
  categoryFromVelo,
  veloForCategory as veloForCategoryFromCats,
  type LigaCategoryDef as CategoryDef,
} from '@/lib/ligaCategories';

export { ZR_CATEGORY_DEFAULTS, ZR_CATEGORY_STYLES, categoryFromVelo };
export type { CategoryDef };

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Participant {
  name: string;
  zwiftId: string;
  weightInGrams: number | null;
  cp5s:   number | null;
  cp1min: number | null;
  cp5min: number | null;
  cp20min: number | null;
  racingScore: number | string | null;
  /** Current ZwiftRacing vELO (`rating` / `currentRating` from /participants). */
  rating?: number | string | null;
  /** 30-day max ZwiftRacing vELO. */
  max30Rating: number | string | null;
  ligaCategory: { locked?: boolean; category?: string; manualAssignedCategory?: string } | null;
  /** Zwift activities in the CP window (typically 90d), if known. */
  zwiftActivityCount?: number | null;
}

export type CPField = 'cp5s' | 'cp1min' | 'cp5min' | 'cp20min' | 'racingScore';
export type FeatureKey = 'weight_kg' | 'zrs' | 'wkg5s' | 'wkg1m' | 'wkg5m' | 'wkg20m'
  | 'watts5s' | 'watts1m' | 'watts5m' | 'watts20m'
  | 'compound5s' | 'compound1m' | 'compound5m' | 'compound20m';

/** Feature metadata served by the backend predictor (`GET /admin/predictor/model`). */
export interface FeatureMeta {
  key: FeatureKey;
  label: string;
  description: string;
  requires: CPField[];
}

export interface ModelResult {
  coeffs: number[];
  r2: number;
  rmse: number;
  n: number;
  activeFeatureKeys: FeatureKey[];
  trainingPoints: { actual: number; predicted: number; name: string; category: string }[];
}

export interface Inputs {
  weightKg: number;
  wkg5s:   number;
  wkg1m:   number;
  wkg5m:   number;
  wkg20m:  number;
  racingScore: number;
}

export type PowerField = 'wkg5s' | 'wkg1m' | 'wkg5m' | 'wkg20m';
export type SharedField = 'weightKg' | 'racingScore';

export type PowerInputs = Pick<Inputs, PowerField>;
export type SharedInputs = Pick<Inputs, SharedField>;

export const EMPTY_POWER: PowerInputs = { wkg5s: 0, wkg1m: 0, wkg5m: 0, wkg20m: 0 };
export const EMPTY_SHARED: SharedInputs = { weightKg: 0, racingScore: 0 };

export interface StravaRiderCache {
  power: PowerInputs;
  activityCount: number | null;
  error?: string;
  /** Raw indoor/outdoor peak watts, so `power` can be re-corrected when the
   *  outdoor→indoor correction changes. Absent once the admin edits the values by hand. */
  curves?: StravaCurves;
  weightKg?: number;
}

/** A failed (re)load keeps whatever was loaded before (curves, weight, ride count) and
 *  only adds the error, so values already on screen are not blanked. */
export function withStravaError(prev: StravaRiderCache | undefined, error: string): StravaRiderCache {
  return { ...(prev ?? { power: EMPTY_POWER, activityCount: null }), error };
}

export type PowerScale = Partial<Record<PowerField, number>>;

/** Strava peak watts (w5/w60/w300/w1200...) split into indoor and outdoor rides. */
export interface StravaCurves {
  indoor: Record<string, number>;
  outdoor: Record<string, number>;
  /** Outdoor rides marked as a race on Strava (also part of `outdoor`). */
  race?: Record<string, number>;
  /** Indoor rides behind the indoor curve (for the indoor-first rule). */
  indoorRides?: number;
}

const CURVE_KEY_FOR: Record<PowerField, string> = { wkg5s: 'w5', wkg1m: 'w60', wkg5m: 'w300', wkg20m: 'w1200' };

/** Curves from the strava-power-curve response; curves cached before the split count as outdoor. */
export function stravaCurvesFromResponse(data: {
  curve?: Record<string, number> | null;
  curveIndoor?: Record<string, number> | null;
  curveOutdoor?: Record<string, number> | null;
  curveOutdoorRace?: Record<string, number> | null;
  indoorCount?: number | null;
}): StravaCurves {
  if (data.curveIndoor || data.curveOutdoor) {
    return {
      indoor: data.curveIndoor ?? {}, outdoor: data.curveOutdoor ?? {}, race: data.curveOutdoorRace ?? {},
      indoorRides: data.indoorCount ?? 0,
    };
  }
  return { indoor: {}, outdoor: data.curve ?? {} };
}

/** Indoor-equivalent peak watts: per duration the strongest of the indoor best, the
 *  outdoor best times the outdoor→indoor correction, and the outdoor race best times its
 *  own correction when the settings have one. With the indoor-first rule on
 *  (`indoorFirstMinRides` > 0), a rider with that many indoor rides is rated on the indoor
 *  best alone (same rules as the backend). */
export function correctedStravaCurve(
  curves: StravaCurves,
  scale: PowerScale | undefined,
  raceScale?: PowerScale | null,
  indoorFirstMinRides = 0,
): Record<string, number> {
  const out: Record<string, number> = {};
  const indoorOnly = indoorFirstMinRides > 0 && (curves.indoorRides ?? 0) >= indoorFirstMinRides;
  for (const [field, key] of Object.entries(CURVE_KEY_FOR) as [PowerField, string][]) {
    const indoor = curves.indoor[key] ?? 0;
    if (indoorOnly && indoor > 0) {
      out[key] = indoor;
      continue;
    }
    const outdoor = (curves.outdoor[key] ?? 0) * (scale?.[field] ?? 1);
    const race = (curves.race?.[key] ?? 0) * ((raceScale ?? scale)?.[field] ?? 1);
    const best = Math.max(indoor, outdoor, race);
    if (best > 0) out[key] = best;
  }
  return out;
}

export function combineInputs(shared: SharedInputs, power: PowerInputs): Inputs {
  return { ...shared, ...power };
}

/** Convert a Strava 90d peak-power curve (watts keyed w5/w60/w300/w1200) to W/kg inputs. */
export function powerFromStravaCurve(
  curve: Record<string, number>,
  weightKg: number,
  prev: PowerInputs = EMPTY_POWER,
): PowerInputs {
  const wkg = (watts: number, fallback: number) =>
    weightKg > 0 && watts > 0 ? parseFloat((watts / weightKg).toFixed(2)) : fallback;
  return {
    wkg5s: wkg(curve['w5'] ?? 0, prev.wkg5s),
    wkg1m: wkg(curve['w60'] ?? 0, prev.wkg1m),
    wkg5m: wkg(curve['w300'] ?? 0, prev.wkg5m),
    wkg20m: wkg(curve['w1200'] ?? 0, prev.wkg20m),
  };
}

export function inputsFromParticipant(p: Participant): Inputs {
  const kg = (p.weightInGrams ?? 0) / 1000;
  const wkg = (w: number | null) => (kg > 0 && w && w > 0) ? parseFloat((w / kg).toFixed(2)) : 0;
  const rs = typeof p.racingScore === 'number' ? p.racingScore : parseFloat(String(p.racingScore ?? '')) || 0;
  return {
    weightKg: kg,
    wkg5s: wkg(p.cp5s),
    wkg1m: wkg(p.cp1min),
    wkg5m: wkg(p.cp5min),
    wkg20m: wkg(p.cp20min),
    racingScore: rs,
  };
}

/** Maps a power duration to the feature keys that need that W/kg input. */
export const POWER_ROW_DEFS: {
  field: PowerField;
  label: string;
  step: string;
  featureKeys: FeatureKey[];
  wattsKey: FeatureKey;
  wattsLabel: string;
  compoundKey: FeatureKey;
  compoundLabel: string;
}[] = [
  { field: 'wkg5s',  label: '5s W/kg',    step: '0.01', featureKeys: ['wkg5s', 'watts5s', 'compound5s'],     wattsKey: 'watts5s',  wattsLabel: '5s watts (auto)',    compoundKey: 'compound5s',  compoundLabel: '5s²/kg (auto)' },
  { field: 'wkg1m',  label: '1min W/kg',  step: '0.01', featureKeys: ['wkg1m', 'watts1m', 'compound1m'],     wattsKey: 'watts1m',  wattsLabel: '1min watts (auto)',  compoundKey: 'compound1m',  compoundLabel: '1m²/kg (auto)' },
  { field: 'wkg5m',  label: '5min W/kg',  step: '0.01', featureKeys: ['wkg5m', 'watts5m', 'compound5m'],     wattsKey: 'watts5m',  wattsLabel: '5min watts (auto)',  compoundKey: 'compound5m',  compoundLabel: '5m²/kg (auto)' },
  { field: 'wkg20m', label: '20min W/kg', step: '0.01', featureKeys: ['wkg20m', 'watts20m', 'compound20m'], wattsKey: 'watts20m', wattsLabel: '20min watts (auto)', compoundKey: 'compound20m', compoundLabel: '20m²/kg (auto)' },
];

export interface PredictorFormLayout {
  showWeight: boolean;
  showZrs: boolean;
  powerRows: {
    field: PowerField;
    label: string;
    step: string;
    wattsLabel: string | null;
    compoundLabel: string | null;
  }[];
  usesPower: boolean;
}

/** Which Predict & Assign fields the current regressor set actually needs. */
export function predictorFormLayout(activeKeys: FeatureKey[]): PredictorFormLayout {
  const enabled = new Set(activeKeys);
  const powerRows = POWER_ROW_DEFS
    .filter(row => row.featureKeys.some(k => enabled.has(k)))
    .map(row => ({
      field: row.field,
      label: row.label,
      step: row.step,
      wattsLabel: enabled.has(row.wattsKey) ? row.wattsLabel : null,
      compoundLabel: enabled.has(row.compoundKey) ? row.compoundLabel : null,
    }));
  return {
    showWeight: enabled.has('weight_kg') || powerRows.length > 0,
    showZrs: enabled.has('zrs'),
    powerRows,
    usesPower: powerRows.length > 0,
  };
}

/** Look up a feature label; falls back to the key when metadata has not loaded yet. */
export function featureLabel(defs: FeatureMeta[], key: FeatureKey): string {
  return defs.find(f => f.key === key)?.label ?? key;
}

export const SCATTER_COLORS: Record<string, string> = {
  Diamond: '#06b6d4',
  Ruby: '#ef4444',
  Emerald: '#22c55e',
  Sapphire: '#3b82f6',
  Amethyst: '#a855f7',
  Platinum: '#94a3b8',
  Gold: '#eab308',
  Silver: '#6b7280',
  Bronze: '#f97316',
  Copper: '#d97706',
};

// ---------------------------------------------------------------------------
// Category lookup
// ---------------------------------------------------------------------------

export function veloForCategory(catName: string, cats: CategoryDef[] = ZR_CATEGORY_DEFAULTS): number | null {
  return veloForCategoryFromCats(catName, cats);
}

// ---------------------------------------------------------------------------
// Predictions (computed by the backend predictor; this file holds no model code)
// ---------------------------------------------------------------------------

export interface PredictionSnapshot {
  velo: number | null;
  category: string | null;
  low: number | null;
  high: number | null;
  catLow: string | null;
  catHigh: string | null;
  /** high = whole ±RMSE band in one division; low = too few Strava rides. */
  confidence?: 'high' | 'medium' | 'low' | null;
}

/** Predictions keyed by Zwift ID (or any row id sent to `/admin/predictor/predict`). */
export type PredictionMap = Record<string, PredictionSnapshot>;

export const EMPTY_PREDICTION: PredictionSnapshot = {
  velo: null, category: null, low: null, high: null, catLow: null, catHigh: null, confidence: null,
};

export function predictionFor(map: PredictionMap | undefined, id: string): PredictionSnapshot {
  return map?.[id] ?? EMPTY_PREDICTION;
}

export function formatVeloValue(value: number | string | null | undefined): string | null {
  if (value == null || value === 'N/A' || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value));
  return Number.isFinite(n) ? String(Math.round(n)) : null;
}

export function parseVeloField(value: number | string | null | undefined): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value == null || value === 'N/A' || value === '') return null;
  const n = parseFloat(String(value));
  return Number.isFinite(n) ? n : null;
}

export function parseParticipantVelo(p: Participant): number | null {
  return parseVeloField(p.max30Rating);
}

export function actualVeloFromParticipant(p: Participant): number | null {
  const n = parseParticipantVelo(p);
  return n != null && n > 0 ? n : null;
}

/** True when current ZwiftRacing vELO (`rating`) is 0, missing, or N/A. */
export function hasZeroVelo(p: Participant): boolean {
  const n = parseVeloField(p.rating);
  return n == null || n === 0;
}

/** True when 30-day max vELO (`max30Rating`) is 0, missing, or N/A. */
export function hasNo30dVelo(p: Participant): boolean {
  const n = parseVeloField(p.max30Rating);
  return n == null || n === 0;
}

export function impliedCategoryFromParticipant(
  p: Participant,
  cats: CategoryDef[] = ZR_CATEGORY_DEFAULTS,
): string | null {
  const velo = actualVeloFromParticipant(p);
  return velo == null ? null : categoryFromVelo(velo, cats);
}

/** True when the Zwift-power predicted category differs from the category implied by actual vELO. */
export function hasPredictedVsImpliedMismatch(
  p: Participant,
  zwiftPredictions: PredictionMap | undefined,
  cats: CategoryDef[] = ZR_CATEGORY_DEFAULTS,
): boolean {
  const predicted = predictionFor(zwiftPredictions, p.zwiftId).category;
  const implied = impliedCategoryFromParticipant(p, cats);
  return predicted != null && implied != null && predicted !== implied;
}

export function riderAssignedCategory(
  p: Participant,
  assignedOverlay?: Record<string, string>,
): string | undefined {
  return assignedOverlay?.[p.zwiftId] || p.ligaCategory?.category || undefined;
}

/** Riders shown in Predict & Assign — dropdown and overview table share this list. */
export function filterPredictorRiders(
  participants: Participant[],
  zwiftPredictions: PredictionMap | undefined,
  opts: {
    unassignedOnly: boolean;
    mismatchOnly: boolean;
    zeroVeloOnly?: boolean;
    no30dVeloOnly?: boolean;
    assignedOverlay?: Record<string, string>;
  },
): Participant[] {
  return participants
    .filter(p => {
      if (opts.unassignedOnly && riderAssignedCategory(p, opts.assignedOverlay)) return false;
      if (opts.mismatchOnly && !hasPredictedVsImpliedMismatch(p, zwiftPredictions)) return false;
      if (opts.zeroVeloOnly && !hasZeroVelo(p)) return false;
      if (opts.no30dVeloOnly && !hasNo30dVelo(p)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Predictor inputs for a rider's loaded Strava power (weight and ZRS from their profile). */
export function stravaInputsForRider(p: Participant, cached: StravaRiderCache | undefined): Inputs | null {
  if (!cached || cached.error) return null;
  const filled = inputsFromParticipant(p);
  return combineInputs({ weightKg: filled.weightKg, racingScore: filled.racingScore }, cached.power);
}
