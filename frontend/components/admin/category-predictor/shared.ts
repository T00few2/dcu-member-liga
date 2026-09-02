// Shared types, constants and pure helpers used across CategoryPredictor sub-components.
// Not a React file — no JSX.

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CategoryDef {
  name: string;
  upper: number | null;
}

export interface Participant {
  name: string;
  zwiftId: string;
  weightInGrams: number | null;
  cp5s:   number | null;
  cp1min: number | null;
  cp5min: number | null;
  cp20min: number | null;
  racingScore: number | string | null;
  max30Rating: number | string | null;
  ligaCategory: { locked?: boolean; category?: string } | null;
  /** Zwift activities in the CP window (typically 90d), if known. */
  zwiftActivityCount?: number | null;
}

export type CPField = 'cp5s' | 'cp1min' | 'cp5min' | 'cp20min' | 'racingScore';
export type FeatureKey = 'weight_kg' | 'zrs' | 'wkg5s' | 'wkg1m' | 'wkg5m' | 'wkg20m'
  | 'watts5s' | 'watts1m' | 'watts5m' | 'watts20m'
  | 'compound5s' | 'compound1m' | 'compound5m' | 'compound20m';

export interface FeatureDef {
  key: FeatureKey;
  label: string;
  description: string;
  requires: CPField[];
  // args: kg, cp5s, cp1min, cp5min, cp20min, racingScore
  fromCP: (kg: number, c5s: number, c1: number, c5: number, c20: number, zrs: number) => number;
  fromInputs: (inp: Inputs) => number;
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

// ---------------------------------------------------------------------------
// Feature definitions
// ---------------------------------------------------------------------------

export const FEATURE_DEFS: FeatureDef[] = [
  {
    key: 'weight_kg', label: 'Weight (kg)', requires: [],
    description: 'Raw rider weight. Lets the model reward heavier riders at the same W/kg — on flat terrain, absolute watts matter.',
    fromCP: (kg) => kg,
    fromInputs: (inp) => inp.weightKg,
  },
  {
    key: 'zrs', label: 'ZRS', requires: ['racingScore'],
    description: "Zwift Racing Score — Zwift's in-game ranking. Directly comparable to vELO and often the strongest single predictor.",
    fromCP: (_kg, _s, _1, _5, _20, zrs) => zrs,
    fromInputs: (inp) => inp.racingScore,
  } as FeatureDef,
  {
    key: 'wkg5s', label: '5s W/kg', requires: ['cp5s'],
    description: '5-second peak power per kg — pure neuromuscular / sprint ceiling.',
    fromCP: (kg, c5s) => c5s / kg,
    fromInputs: (inp) => inp.wkg5s,
  },
  {
    key: 'wkg1m', label: '1min W/kg', requires: ['cp1min'],
    description: '1-minute power per kg — anaerobic capacity.',
    fromCP: (kg, _s, c1) => c1 / kg,
    fromInputs: (inp) => inp.wkg1m,
  },
  {
    key: 'wkg5m', label: '5min W/kg', requires: ['cp5min'],
    description: '5-minute power per kg — VO₂max proxy.',
    fromCP: (kg, _s, _1, c5) => c5 / kg,
    fromInputs: (inp) => inp.wkg5m,
  },
  {
    key: 'wkg20m', label: '20min W/kg', requires: ['cp20min'],
    description: 'Sustained aerobic ceiling (FTP proxy) — typically the strongest single predictor of vELO.',
    fromCP: (kg, _s, _1, _5, c20) => c20 / kg,
    fromInputs: (inp) => inp.wkg20m,
  },
  {
    key: 'watts5s', label: '5s watts', requires: ['cp5s'],
    description: 'Absolute 5-second peak watts. Scale-free on flat sprints.',
    fromCP: (_kg, c5s) => c5s,
    fromInputs: (inp) => inp.wkg5s * inp.weightKg,
  },
  {
    key: 'watts1m', label: '1min watts', requires: ['cp1min'],
    description: 'Absolute 1-minute watts.',
    fromCP: (_kg, _s, c1) => c1,
    fromInputs: (inp) => inp.wkg1m * inp.weightKg,
  },
  {
    key: 'watts5m', label: '5min watts', requires: ['cp5min'],
    description: 'Absolute 5-minute watts.',
    fromCP: (_kg, _s, _1, c5) => c5,
    fromInputs: (inp) => inp.wkg5m * inp.weightKg,
  },
  {
    key: 'watts20m', label: '20min watts', requires: ['cp20min'],
    description: 'Absolute 20-minute watts (FTP in absolute terms).',
    fromCP: (_kg, _s, _1, _5, c20) => c20,
    fromInputs: (inp) => inp.wkg20m * inp.weightKg,
  },
  {
    key: 'compound5s', label: '5s²/kg', requires: ['cp5s'],
    description: '5s watts² ÷ weight. Sprint compound score — rewards heavier sprinters.',
    fromCP: (kg, c5s) => (c5s * c5s) / kg,
    fromInputs: (inp) => inp.weightKg > 0 ? (inp.wkg5s * inp.weightKg) ** 2 / inp.weightKg : 0,
  },
  {
    key: 'compound1m', label: '1m²/kg', requires: ['cp1min'],
    description: '1min watts² ÷ weight. Anaerobic compound score.',
    fromCP: (kg, _s, c1) => (c1 * c1) / kg,
    fromInputs: (inp) => inp.weightKg > 0 ? (inp.wkg1m * inp.weightKg) ** 2 / inp.weightKg : 0,
  },
  {
    key: 'compound5m', label: '5m²/kg', requires: ['cp5min'],
    description: '5min watts² ÷ weight. Flat-terrain VO₂max — same W/kg but heavier → higher score.',
    fromCP: (kg, _s, _1, c5) => (c5 * c5) / kg,
    fromInputs: (inp) => inp.weightKg > 0 ? (inp.wkg5m * inp.weightKg) ** 2 / inp.weightKg : 0,
  },
  {
    key: 'compound20m', label: '20m²/kg', requires: ['cp20min'],
    description: '20min watts² ÷ weight. Sustained flat power — the FTP compound score.',
    fromCP: (kg, _s, _1, _5, c20) => (c20 * c20) / kg,
    fromInputs: (inp) => inp.weightKg > 0 ? (inp.wkg20m * inp.weightKg) ** 2 / inp.weightKg : 0,
  },
];

export const ALL_ON: Record<FeatureKey, boolean> = {
  weight_kg: true, zrs: false, wkg5s: false, wkg1m: true, wkg5m: false, wkg20m: true,
  watts5s: false, watts1m: false, watts5m: false, watts20m: false,
  compound5s: false, compound1m: false, compound5m: true, compound20m: false,
};

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

export function mergeFeatures(saved: Record<string, unknown>): Record<FeatureKey, boolean> {
  const out = { ...ALL_ON };
  for (const k of Object.keys(ALL_ON) as FeatureKey[]) {
    if (typeof saved[k] === 'boolean') out[k] = saved[k] as boolean;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Category constants
// ---------------------------------------------------------------------------

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

export const ZR_CATEGORY_DEFAULTS: CategoryDef[] = [
  { name: 'Diamond',  upper: null },
  { name: 'Ruby',     upper: 2200 },
  { name: 'Emerald',  upper: 1900 },
  { name: 'Sapphire', upper: 1650 },
  { name: 'Amethyst', upper: 1450 },
  { name: 'Platinum', upper: 1300 },
  { name: 'Gold',     upper: 1150 },
  { name: 'Silver',   upper: 1000 },
  { name: 'Bronze',   upper:  850 },
  { name: 'Copper',   upper:  650 },
];

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

export function categoryFromVelo(velo: number, cats: CategoryDef[]): string {
  for (let i = 0; i < cats.length; i++) {
    const upper = cats[i].upper;
    const lower = cats[i + 1]?.upper ?? 0;
    if (velo >= lower && (upper === null || velo < upper)) return cats[i].name;
  }
  return cats[cats.length - 1].name;
}

// Returns a vELO that sits in the middle of the given category's range.
export function veloForCategory(catName: string): number | null {
  const idx = ZR_CATEGORY_DEFAULTS.findIndex(c => c.name === catName);
  if (idx === -1) return null;
  const upper = ZR_CATEGORY_DEFAULTS[idx].upper;
  const lower = ZR_CATEGORY_DEFAULTS[idx + 1]?.upper ?? 0;
  return upper === null ? lower + 300 : Math.round((upper + lower) / 2);
}

// ---------------------------------------------------------------------------
// OLS helpers (pure TS, no deps)
// ---------------------------------------------------------------------------

/** Gaussian elimination solver for Ax = b (in-place, square system). */
function solveLinear(A: number[][], b: number[]): number[] {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[maxRow][col])) maxRow = row;
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];
    if (Math.abs(M[col][col]) < 1e-12) throw new Error('Singular matrix');
    for (let row = col + 1; row < n; row++) {
      const f = M[row][col] / M[col][col];
      for (let k = col; k <= n; k++) M[row][k] -= f * M[col][k];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) x[i] -= M[i][j] * x[j];
    x[i] /= M[i][i];
  }
  return x;
}

/** OLS: X rows are feature vectors; returns [intercept, ...coefficients]. */
function fitOLS(X: number[][], y: number[]): number[] {
  const n = X.length;
  const p = X[0].length + 1; // +1 for intercept
  // Augmented X with intercept column prepended
  const Xa = X.map(row => [1, ...row]);
  // Normal equations: (Xᵀ X) β = Xᵀ y
  const XtX = Array.from({ length: p }, () => new Array(p).fill(0));
  const Xty = new Array(p).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < p; j++) {
      Xty[j] += Xa[i][j] * y[i];
      for (let k = 0; k < p; k++) XtX[j][k] += Xa[i][j] * Xa[i][k];
    }
  }
  return solveLinear(XtX, Xty);
}

export function predict(coeffs: number[], row: number[]): number {
  return coeffs[0] + row.reduce((s, v, i) => s + coeffs[i + 1] * v, 0);
}

export interface PredictionSnapshot {
  velo: number | null;
  category: string | null;
  low: number | null;
  high: number | null;
  catLow: string | null;
  catHigh: string | null;
}

export const EMPTY_PREDICTION: PredictionSnapshot = {
  velo: null, category: null, low: null, high: null, catLow: null, catHigh: null,
};

/** Predicted vELO and category band for a filled input row. */
export function predictionFromInputs(model: ModelResult | null, inputs: Inputs): PredictionSnapshot {
  if (!model) return EMPTY_PREDICTION;
  const activeFeatures = FEATURE_DEFS.filter(f => model.activeFeatureKeys.includes(f.key));
  const predRow = activeFeatures.map(f => f.fromInputs(inputs));
  if (predRow.length === 0 || predRow.some(v => v <= 0)) return EMPTY_PREDICTION;
  const velo = Math.round(predict(model.coeffs, predRow));
  const low = Math.round(velo - model.rmse);
  const high = Math.round(velo + model.rmse);
  return {
    velo,
    category: categoryFromVelo(velo, ZR_CATEGORY_DEFAULTS),
    low,
    high,
    catLow: categoryFromVelo(low, ZR_CATEGORY_DEFAULTS),
    catHigh: categoryFromVelo(high, ZR_CATEGORY_DEFAULTS),
  };
}

export function actualVeloFromParticipant(p: Participant): number | null {
  if (typeof p.max30Rating === 'number') {
    return p.max30Rating > 0 ? p.max30Rating : null;
  }
  if (p.max30Rating == null || p.max30Rating === 'N/A') return null;
  const n = parseFloat(String(p.max30Rating));
  return isNaN(n) || n <= 0 ? null : n;
}

export function impliedCategoryFromParticipant(p: Participant): string | null {
  const velo = actualVeloFromParticipant(p);
  return velo == null ? null : categoryFromVelo(velo, ZR_CATEGORY_DEFAULTS);
}

export function predictedCategoryFromParticipant(model: ModelResult | null, p: Participant): string | null {
  return predictionFromInputs(model, inputsFromParticipant(p)).category;
}

/** True when Zwift-power predicted category differs from the category implied by actual vELO. */
export function hasPredictedVsImpliedMismatch(model: ModelResult | null, p: Participant): boolean {
  const predicted = predictedCategoryFromParticipant(model, p);
  const implied = impliedCategoryFromParticipant(p);
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
  model: ModelResult | null,
  opts: {
    unassignedOnly: boolean;
    mismatchOnly: boolean;
    assignedOverlay?: Record<string, string>;
  },
): Participant[] {
  return participants
    .filter(p => {
      if (opts.unassignedOnly && riderAssignedCategory(p, opts.assignedOverlay)) return false;
      if (opts.mismatchOnly && !hasPredictedVsImpliedMismatch(model, p)) return false;
      return true;
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function predictionFromStravaCache(
  model: ModelResult | null,
  p: Participant,
  cached: StravaRiderCache | undefined,
): PredictionSnapshot {
  if (!cached || cached.error) return EMPTY_PREDICTION;
  const filled = inputsFromParticipant(p);
  return predictionFromInputs(
    model,
    combineInputs({ weightKg: filled.weightKg, racingScore: filled.racingScore }, cached.power),
  );
}

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------

export function buildModel(participants: Participant[], enabled: Record<FeatureKey, boolean>): ModelResult | null {
  const active = FEATURE_DEFS.filter(f => enabled[f.key]);
  if (active.length === 0) return null;

  const needed = new Set<CPField>(active.flatMap(f => f.requires));

  const training = participants.filter(p => {
    const wg = p.weightInGrams;
    const velo = typeof p.max30Rating === 'number' ? p.max30Rating : parseFloat(String(p.max30Rating ?? ''));
    if (!wg || wg <= 0 || isNaN(velo) || velo <= 0) return false;
    if (needed.has('cp5s')        && !(p.cp5s   && p.cp5s   > 0)) return false;
    if (needed.has('cp1min')      && !(p.cp1min && p.cp1min > 0)) return false;
    if (needed.has('cp5min')      && !(p.cp5min && p.cp5min > 0)) return false;
    if (needed.has('cp20min')     && !(p.cp20min && p.cp20min > 0)) return false;
    if (needed.has('racingScore')) {
      const rs = typeof p.racingScore === 'number' ? p.racingScore : parseFloat(String(p.racingScore ?? ''));
      if (isNaN(rs) || rs <= 0) return false;
    }
    return true;
  });

  if (training.length < active.length + 2) return null;

  const rows: number[][] = [];
  const y: number[] = [];

  for (const p of training) {
    const kg = p.weightInGrams! / 1000;
    const velo = typeof p.max30Rating === 'number' ? p.max30Rating : parseFloat(String(p.max30Rating!));
    const zrs = typeof p.racingScore === 'number' ? p.racingScore : parseFloat(String(p.racingScore ?? '0')) || 0;
    rows.push(active.map(f => f.fromCP(kg, p.cp5s ?? 0, p.cp1min ?? 0, p.cp5min ?? 0, p.cp20min ?? 0, zrs)));
    y.push(velo);
  }

  let coeffs: number[];
  try { coeffs = fitOLS(rows, y); } catch { return null; }

  const preds = rows.map(r => predict(coeffs, r));
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - preds[i]) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;

  const trainingPoints = training.map((p, i) => ({
    actual: y[i],
    predicted: Math.round(preds[i]),
    name: p.name,
    category: p.ligaCategory?.category ?? categoryFromVelo(y[i], ZR_CATEGORY_DEFAULTS),
  }));

  return { coeffs, r2, rmse: Math.round(Math.sqrt(ssRes / y.length)), n: training.length, activeFeatureKeys: active.map(f => f.key), trainingPoints };
}
