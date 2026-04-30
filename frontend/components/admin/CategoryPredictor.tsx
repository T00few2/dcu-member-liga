'use client';

import { useState, useEffect, useMemo } from 'react';
import { User } from 'firebase/auth';
import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell,
  Customized,
} from 'recharts';
import { API_URL } from '@/lib/api';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CategoryDef {
  name: string;
  upper: number | null;
}

interface Participant {
  name: string;
  zwiftId: string;
  weightInGrams: number | null;
  cp1min: number | null;
  cp5min: number | null;
  cp20min: number | null;
  max30Rating: number | string | null;
  ligaCategory: { locked?: boolean; category?: string } | null;
}

interface ModelResult {
  coeffs: number[]; // [intercept, weight_kg, wkg1m, wkg20m, compound]
  r2: number;
  rmse: number;
  n: number;
  trainingPoints: { actual: number; predicted: number; name: string; category: string }[];
}

interface Inputs {
  weightKg: number;
  wkg1m: number;
  cp5minWatts: number;
  wkg20m: number;
}

interface CategoryPredictorProps {
  user: User | null;
}

// ---------------------------------------------------------------------------
// Category constants (duplicated from CategoryManager to avoid coupling)
// ---------------------------------------------------------------------------

const ZR_CATEGORY_STYLES: Record<string, string> = {
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

const ZR_CATEGORY_DEFAULTS: CategoryDef[] = [
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

const SCATTER_COLORS: Record<string, string> = {
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

function predict(coeffs: number[], row: number[]): number {
  return coeffs[0] + row.reduce((s, v, i) => s + coeffs[i + 1] * v, 0);
}

// ---------------------------------------------------------------------------
// Category lookup
// ---------------------------------------------------------------------------

function categoryFromVelo(velo: number, cats: CategoryDef[]): string {
  for (let i = 0; i < cats.length; i++) {
    const upper = cats[i].upper;
    const lower = cats[i + 1]?.upper ?? 0;
    if (velo >= lower && (upper === null || velo < upper)) return cats[i].name;
  }
  return cats[cats.length - 1].name;
}

// ---------------------------------------------------------------------------
// Model builder
// ---------------------------------------------------------------------------

function buildModel(participants: Participant[]): ModelResult | null {
  const training = participants.filter(p => {
    const wg = p.weightInGrams;
    const cp1 = p.cp1min;
    const cp5 = p.cp5min;
    const cp20 = p.cp20min;
    const velo = typeof p.max30Rating === 'number' ? p.max30Rating : parseFloat(String(p.max30Rating ?? ''));
    return (
      wg && wg > 0 &&
      cp1 && cp1 > 0 &&
      cp5 && cp5 > 0 &&
      cp20 && cp20 > 0 &&
      !isNaN(velo) && velo > 0
    );
  });

  if (training.length < 5) return null;

  const rows: number[][] = [];
  const y: number[] = [];

  for (const p of training) {
    const wg = p.weightInGrams!;
    const kg = wg / 1000;
    const cp1 = p.cp1min!;
    const cp5 = p.cp5min!;
    const cp20 = p.cp20min!;
    const velo = typeof p.max30Rating === 'number' ? p.max30Rating : parseFloat(String(p.max30Rating!));
    const wkg1 = cp1 / kg;
    const wkg20 = cp20 / kg;
    const compound = (cp5 * cp5) / kg;
    rows.push([kg, wkg1, wkg20, compound]);
    y.push(velo);
  }

  let coeffs: number[];
  try {
    coeffs = fitOLS(rows, y);
  } catch {
    return null;
  }

  const preds = rows.map(r => predict(coeffs, r));
  const yMean = y.reduce((s, v) => s + v, 0) / y.length;
  const ssTot = y.reduce((s, v) => s + (v - yMean) ** 2, 0);
  const ssRes = y.reduce((s, v, i) => s + (v - preds[i]) ** 2, 0);
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const rmse = Math.sqrt(ssRes / y.length);

  const trainingPoints = training.map((p, i) => ({
    actual: y[i],
    predicted: Math.round(preds[i]),
    name: p.name,
    category: p.ligaCategory?.category ?? categoryFromVelo(y[i], ZR_CATEGORY_DEFAULTS),
  }));

  return { coeffs, r2, rmse: Math.round(rmse), n: training.length, trainingPoints };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Diagonal reference line drawn via Recharts Customized + axis scales
// ---------------------------------------------------------------------------

function DiagonalLine({ xAxisMap, yAxisMap, minV, maxV }: { xAxisMap?: Record<string, { scale: (v: number) => number }>; yAxisMap?: Record<string, { scale: (v: number) => number }>; minV: number; maxV: number }) {
  const xAxis = xAxisMap?.[0];
  const yAxis = yAxisMap?.[0];
  if (!xAxis?.scale || !yAxis?.scale) return null;
  return (
    <line
      x1={xAxis.scale(minV)} y1={yAxis.scale(minV)}
      x2={xAxis.scale(maxV)} y2={yAxis.scale(maxV)}
      stroke="#94a3b8"
      strokeDasharray="5 4"
      strokeWidth={1.5}
    />
  );
}

export default function CategoryPredictor({ user }: CategoryPredictorProps) {
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [loadingParticipants, setLoadingParticipants] = useState(true);
  const [selectedZwiftId, setSelectedZwiftId] = useState('');
  const [showUnassignedOnly, setShowUnassignedOnly] = useState(false);
  const [powerSource, setPowerSource] = useState<'zwift' | 'strava'>('zwift');
  const [loadingStrava, setLoadingStrava] = useState(false);
  const [stravaError, setStravaError] = useState('');
  const [inputs, setInputs] = useState<Inputs>({ weightKg: 0, wkg1m: 0, cp5minWatts: 0, wkg20m: 0 });
  const [assigning, setAssigning] = useState(false);
  const [assignResult, setAssignResult] = useState<{ category: string } | null>(null);
  const [assignError, setAssignError] = useState('');

  // Fetch participants
  useEffect(() => {
    if (!user) return;
    (async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/participants`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          setParticipants(data.participants ?? []);
        }
      } catch {
        // ignore
      } finally {
        setLoadingParticipants(false);
      }
    })();
  }, [user]);

  const model = useMemo(() => buildModel(participants), [participants]);

  // Derived values
  const compound = inputs.weightKg > 0 ? (inputs.cp5minWatts ** 2) / inputs.weightKg : 0;
  const predictedVelo =
    model && inputs.weightKg > 0 && inputs.wkg1m > 0 && inputs.wkg20m > 0 && compound > 0
      ? Math.round(predict(model.coeffs, [inputs.weightKg, inputs.wkg1m, inputs.wkg20m, compound]))
      : null;
  const predictedCategory = predictedVelo != null ? categoryFromVelo(predictedVelo, ZR_CATEGORY_DEFAULTS) : null;

  const selectedParticipant = participants.find(p => p.zwiftId === selectedZwiftId) ?? null;
  const actualVelo =
    selectedParticipant && typeof selectedParticipant.max30Rating === 'number'
      ? selectedParticipant.max30Rating
      : selectedParticipant?.max30Rating != null && selectedParticipant.max30Rating !== 'N/A'
      ? parseFloat(String(selectedParticipant.max30Rating))
      : null;

  function handleSelectRider(zwiftId: string) {
    setSelectedZwiftId(zwiftId);
    setAssignResult(null);
    setAssignError('');
    setStravaError('');
    const p = participants.find(pp => pp.zwiftId === zwiftId);
    if (!p) { setInputs({ weightKg: 0, wkg1m: 0, cp5minWatts: 0, wkg20m: 0 }); return; }
    const kg = (p.weightInGrams ?? 0) / 1000;
    setInputs({
      weightKg: kg,
      wkg1m: kg > 0 && p.cp1min ? parseFloat((p.cp1min / kg).toFixed(2)) : 0,
      cp5minWatts: p.cp5min ?? 0,
      wkg20m: kg > 0 && p.cp20min ? parseFloat((p.cp20min / kg).toFixed(2)) : 0,
    });
  }

  async function handleLoadStrava() {
    if (!selectedZwiftId || !user) return;
    setLoadingStrava(true);
    setStravaError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/verification/strava-power-curve/${selectedZwiftId}?days=90`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) { setStravaError(data.message ?? 'Failed to load Strava data'); return; }
      const curve: Record<string, number> = data.curve ?? {};
      const kg = inputs.weightKg > 0 ? inputs.weightKg : (selectedParticipant?.weightInGrams ?? 0) / 1000;
      const cp1 = curve['60'] ?? curve['61'] ?? 0;
      const cp5 = curve['300'] ?? curve['301'] ?? 0;
      const cp20 = curve['1200'] ?? curve['1201'] ?? 0;
      setInputs(prev => ({
        ...prev,
        weightKg: kg || prev.weightKg,
        wkg1m: kg > 0 && cp1 > 0 ? parseFloat((cp1 / kg).toFixed(2)) : prev.wkg1m,
        cp5minWatts: cp5 > 0 ? Math.round(cp5) : prev.cp5minWatts,
        wkg20m: kg > 0 && cp20 > 0 ? parseFloat((cp20 / kg).toFixed(2)) : prev.wkg20m,
      }));
    } catch (e: unknown) {
      setStravaError(e instanceof Error ? e.message : 'Error loading Strava data');
    } finally {
      setLoadingStrava(false);
    }
  }

  async function handleAssign() {
    if (!selectedZwiftId || !user || predictedVelo == null) return;
    setAssigning(true);
    setAssignResult(null);
    setAssignError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${selectedZwiftId}/predict-assign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ predictedVelo }),
      });
      const data = await res.json();
      if (!res.ok) { setAssignError(data.message ?? 'Assignment failed'); return; }
      setAssignResult({ category: data.category });
    } catch (e: unknown) {
      setAssignError(e instanceof Error ? e.message : 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  }

  function setInput(field: keyof Inputs, value: string) {
    setAssignResult(null);
    setAssignError('');
    const num = parseFloat(value);
    setInputs(prev => ({ ...prev, [field]: isNaN(num) ? 0 : num }));
  }

  const featureLabels = ['Intercept', 'Weight (kg)', '1min W/kg', '20min W/kg', '5m²/kg'];

  // Scatter chart domain
  const scatterVelos = model?.trainingPoints.map(p => p.actual) ?? [];
  const minVelo = scatterVelos.length ? Math.min(...scatterVelos) - 100 : 400;
  const maxVelo = scatterVelos.length ? Math.max(...scatterVelos) + 100 : 2500;

  return (
    <div className="space-y-8">
      {/* ── Intro ── */}
      <div className="bg-muted/40 border border-border rounded-lg p-4 text-sm text-muted-foreground space-y-1">
        <p>
          <span className="font-medium text-foreground">What this tool does:</span> Riders with thin Zwift profiles
          may not have a ZwiftRacing vELO score, so the automatic category assignment can't place them. This tool
          fits a linear model from riders <em>who do</em> have vELO scores, then uses it to predict a vELO for
          any rider based on their power data — either from Zwift or from Strava — and assigns them a starting
          category using the same engine as the nightly job.
        </p>
        <p>
          <span className="font-medium text-foreground">Workflow:</span> Review the model fit below, then scroll
          to <em>Predict &amp; Assign</em>. Select a rider, optionally switch to Strava power data and click Load,
          adjust any values if needed, and click Assign. The predicted vELO is written as{' '}
          <code className="bg-muted px-1 rounded text-xs">assignedFrom: &quot;predicted&quot;</code> so the nightly
          job will re-evaluate them normally going forward.
        </p>
      </div>

      {/* ── Section 1: Model ── */}
      <div className="bg-card border border-border rounded-lg p-6">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-xl font-semibold text-foreground">vELO Prediction Model</h2>
          {loadingParticipants && (
            <span className="text-sm text-muted-foreground">Loading data…</span>
          )}
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fitted automatically from all league members who have both Zwift CP efforts and a ZwiftRacing vELO
          score. Features: rider weight (kg), 1-minute W/kg (sprint), 20-minute W/kg (aerobic ceiling), and
          the 5-minute compound score (5min watts² ÷ weight). The compound score rewards heavier riders with
          the same W/kg — because on flat terrain, absolute watts matter as much as power-to-weight.
        </p>

        {!model && !loadingParticipants && (
          <p className="text-muted-foreground text-sm">
            Not enough riders with both CP data and vELO scores to fit a model (need at least 5).
          </p>
        )}

        {model && (
          <div className="space-y-6">
            {/* Stats */}
            <div className="flex flex-wrap gap-6 text-sm">
              <div>
                <span className="text-muted-foreground">Training riders: </span>
                <span className="font-semibold text-foreground">{model.n}</span>
              </div>
              <div>
                <span className="text-muted-foreground">R²: </span>
                <span className="font-semibold text-foreground">{model.r2.toFixed(3)}</span>
              </div>
              <div>
                <span className="text-muted-foreground">RMSE: </span>
                <span className="font-semibold text-foreground">±{model.rmse} vELO pts</span>
              </div>
            </div>

            {/* Coefficients table */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-2">Coefficients</h3>
              <div className="overflow-x-auto">
                <table className="text-sm w-auto">
                  <thead>
                    <tr className="text-muted-foreground text-xs uppercase">
                      <th className="text-left pr-8 pb-1">Feature</th>
                      <th className="text-right pb-1">Coefficient</th>
                    </tr>
                  </thead>
                  <tbody>
                    {model.coeffs.map((c, i) => (
                      <tr key={i} className="border-t border-border">
                        <td className="pr-8 py-1 text-foreground">{featureLabels[i]}</td>
                        <td className="text-right py-1 font-mono text-foreground">
                          {c >= 0 ? '+' : ''}{c.toFixed(1)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Scatter: predicted vs actual */}
            <div>
              <h3 className="text-sm font-medium text-muted-foreground mb-1">
                Predicted vs Actual vELO
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Each dot is a rider with a known vELO score used to train the model.
                A perfect model would place every dot on the diagonal.
                Dots above the diagonal are over-predicted; dots below are under-predicted.
                Hover a dot to see the rider name and values.
              </p>
              <ResponsiveContainer width="100%" height={320}>
                <ScatterChart margin={{ top: 10, right: 20, bottom: 30, left: 20 }}>
                  <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                  <XAxis
                    type="number"
                    dataKey="actual"
                    name="Actual vELO"
                    domain={[minVelo, maxVelo]}
                    label={{ value: 'Actual vELO', position: 'insideBottom', offset: -15, fontSize: 12 }}
                    tick={{ fontSize: 11 }}
                  />
                  <YAxis
                    type="number"
                    dataKey="predicted"
                    name="Predicted vELO"
                    domain={[minVelo, maxVelo]}
                    label={{ value: 'Predicted vELO', angle: -90, position: 'insideLeft', offset: 10, fontSize: 12 }}
                    tick={{ fontSize: 11 }}
                  />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const d = payload[0].payload;
                      return (
                        <div className="bg-popover border border-border rounded p-2 text-xs shadow">
                          <p className="font-medium">{d.name}</p>
                          <p>Actual: {d.actual}</p>
                          <p>Predicted: {d.predicted}</p>
                          <p>Category: {d.category}</p>
                        </div>
                      );
                    }}
                  />
                  {/* y=x reference diagonal via axis scales */}
                  <Customized component={(props: any) => <DiagonalLine {...props} minV={minVelo} maxV={maxVelo} />} />
                  {/* Single Scatter with Cell children for per-point colours */}
                  <Scatter data={model.trainingPoints} r={5} opacity={0.85}>
                    {model.trainingPoints.map((pt, idx) => (
                      <Cell key={idx} fill={SCATTER_COLORS[pt.category] ?? '#94a3b8'} />
                    ))}
                  </Scatter>
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}
      </div>

      {/* ── Section 2: Predict & Assign ── */}
      <div className="bg-card border border-border rounded-lg p-6">
        <h2 className="text-xl font-semibold text-foreground mb-1">Predict &amp; Assign</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Locked riders are excluded from the dropdown. Selecting a rider pre-fills their Zwift power data.
          Switch to <em>Strava</em> and click <strong>Load</strong> to use Strava 90-day power instead — useful
          for riders who train outdoors but race on Zwift. All fields are editable; the prediction updates live.
          <br />
          <span className="text-xs">
            5min watts is the raw absolute figure (not W/kg) — the compound score is derived from it automatically.
            If the rider&apos;s weight is wrong, correct it here before assigning.
          </span>
        </p>

        {/* Rider dropdown */}
        <div className="mb-4">
          <div className="flex items-center gap-4 mb-1">
            <label className="text-sm font-medium text-foreground">Rider</label>
            <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
              <input
                type="checkbox"
                checked={showUnassignedOnly}
                onChange={e => setShowUnassignedOnly(e.target.checked)}
              />
              Unassigned only
            </label>
          </div>
          <select
            value={selectedZwiftId}
            onChange={e => handleSelectRider(e.target.value)}
            className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground w-full max-w-sm"
          >
            <option value="">— select a rider —</option>
            {participants
              .filter(p => {
                if (p.ligaCategory?.locked) return false;
                if (showUnassignedOnly && p.ligaCategory?.category) return false;
                return true;
              })
              .sort((a, b) => a.name.localeCompare(b.name))
              .map(p => (
                <option key={p.zwiftId} value={p.zwiftId}>
                  {p.name}{p.ligaCategory?.category ? ` (${p.ligaCategory.category})` : ''}
                </option>
              ))}
          </select>
        </div>

        {/* Power source toggle */}
        <div className="flex items-center gap-4 mb-4">
          <span className="text-sm font-medium text-foreground">Power source:</span>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="powerSource"
              value="zwift"
              checked={powerSource === 'zwift'}
              onChange={() => { setPowerSource('zwift'); setStravaError(''); }}
            />
            Zwift (90d)
          </label>
          <label className="flex items-center gap-1.5 text-sm cursor-pointer">
            <input
              type="radio"
              name="powerSource"
              value="strava"
              checked={powerSource === 'strava'}
              onChange={() => setPowerSource('strava')}
            />
            Strava (90d)
          </label>
          {powerSource === 'strava' && (
            <button
              onClick={handleLoadStrava}
              disabled={!selectedZwiftId || loadingStrava}
              className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
            >
              {loadingStrava ? 'Loading…' : 'Load'}
            </button>
          )}
        </div>

        {stravaError && (
          <p className="text-red-600 text-sm mb-4">{stravaError}</p>
        )}

        {/* Input fields */}
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-w-sm mb-4">
          <label className="text-sm text-foreground self-center">Weight (kg)</label>
          <input
            type="number"
            step="0.1"
            value={inputs.weightKg || ''}
            onChange={e => setInput('weightKg', e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
          />

          <label className="text-sm text-foreground self-center">1min W/kg</label>
          <input
            type="number"
            step="0.01"
            value={inputs.wkg1m || ''}
            onChange={e => setInput('wkg1m', e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
          />

          <label className="text-sm text-foreground self-center">5min watts (raw)</label>
          <input
            type="number"
            step="1"
            value={inputs.cp5minWatts || ''}
            onChange={e => setInput('cp5minWatts', e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
          />

          <label className="text-sm text-foreground self-center">20min W/kg</label>
          <input
            type="number"
            step="0.01"
            value={inputs.wkg20m || ''}
            onChange={e => setInput('wkg20m', e.target.value)}
            className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
          />

          <label className="text-sm text-muted-foreground self-center">5m²/kg (auto)</label>
          <span className="text-sm text-muted-foreground py-1 w-24 font-mono">
            {compound > 0 ? compound.toFixed(1) : '—'}
          </span>
        </div>

        {/* Prediction result */}
        <div className="flex flex-wrap gap-6 mb-4 text-sm">
          <div>
            <span className="text-muted-foreground">Predicted vELO: </span>
            {predictedVelo != null ? (
              <span className="font-semibold text-foreground">{predictedVelo.toLocaleString()}</span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )}
            {predictedCategory && (
              <>
                {' → '}
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ml-1 ${ZR_CATEGORY_STYLES[predictedCategory] ?? 'bg-slate-100 text-slate-800'}`}>
                  {predictedCategory}
                </span>
              </>
            )}
          </div>
          <div>
            <span className="text-muted-foreground">Actual vELO: </span>
            {actualVelo != null && !isNaN(actualVelo) ? (
              <span className="font-semibold text-foreground">{Math.round(actualVelo).toLocaleString()}</span>
            ) : (
              <span className="text-muted-foreground">N/A</span>
            )}
          </div>
        </div>

        {/* Assign button */}
        <button
          onClick={handleAssign}
          disabled={!selectedZwiftId || predictedVelo == null || assigning || !model}
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {assigning
            ? 'Assigning…'
            : predictedCategory
            ? `Assign to ${predictedCategory}`
            : 'Assign'}
        </button>

        {assignResult && (
          <p className="mt-3 text-green-600 text-sm font-medium">
            Assigned to {assignResult.category}.
          </p>
        )}
        {assignError && (
          <p className="mt-3 text-red-600 text-sm">{assignError}</p>
        )}
      </div>
    </div>
  );
}
