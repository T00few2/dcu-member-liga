'use client';

import { useState } from 'react';
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
import {
  FEATURE_DEFS,
  SCATTER_COLORS,
  ModelResult,
  FeatureKey,
} from './shared';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CategoryPredictorResultsProps {
  /** Whether participants are still loading from the server. */
  loadingParticipants: boolean;
  /** Fitted OLS model, or null when there is not enough training data. */
  model: ModelResult | null;
  /** Which features are currently enabled in the regressor selector. */
  selectedFeatures: Record<FeatureKey, boolean>;
  /** Called when the user toggles a feature checkbox. */
  onToggleFeature: (key: FeatureKey, enabled: boolean) => void;
  /** Called when the user clicks "Save as default". */
  onSaveDefaults: () => void;
  /** Whether the saved-feedback message should be visible. */
  savedFeedback: boolean;
  /** Called when the user clicks "Reset". */
  onResetFeatures: () => void;
}

// ---------------------------------------------------------------------------
// Diagonal reference line drawn via Recharts Customized + axis scales
// ---------------------------------------------------------------------------

function DiagonalLine({
  xAxisMap,
  yAxisMap,
  minV,
  maxV,
}: {
  xAxisMap?: Record<string, { scale: (v: number) => number }>;
  yAxisMap?: Record<string, { scale: (v: number) => number }>;
  minV: number;
  maxV: number;
}) {
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

// ---------------------------------------------------------------------------
// RegressorSelector — internal sub-panel
// ---------------------------------------------------------------------------

interface RegressorSelectorProps {
  selectedFeatures: Record<FeatureKey, boolean>;
  onToggleFeature: (key: FeatureKey, enabled: boolean) => void;
  onSaveDefaults: () => void;
  savedFeedback: boolean;
  onResetFeatures: () => void;
}

function RegressorSelector({
  selectedFeatures,
  onToggleFeature,
  onSaveDefaults,
  savedFeedback,
  onResetFeatures,
}: RegressorSelectorProps) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mb-4 border border-border rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-4 py-2.5 text-sm font-medium text-foreground bg-muted/40 hover:bg-muted/70 transition"
      >
        <span>Regressors</span>
        <span className="text-muted-foreground text-xs">{open ? '▲' : '▼'}</span>
      </button>
      {open && (
        <div className="px-4 py-3 space-y-3 bg-card">
          {FEATURE_DEFS.map(f => (
            <label key={f.key} className="flex items-start gap-3 cursor-pointer">
              <input
                type="checkbox"
                className="mt-0.5 shrink-0"
                checked={selectedFeatures[f.key]}
                onChange={e => onToggleFeature(f.key, e.target.checked)}
              />
              <div>
                <span className="text-sm font-medium text-foreground">{f.label}</span>
                <p className="text-xs text-muted-foreground">{f.description}</p>
              </div>
            </label>
          ))}
          <div className="flex items-center gap-3 pt-1 border-t border-border">
            <button
              onClick={onSaveDefaults}
              className="px-3 py-1.5 text-xs rounded bg-primary text-primary-foreground hover:opacity-90"
            >
              Save as default
            </button>
            {savedFeedback && <span className="text-xs text-green-600">Saved.</span>}
            <button
              onClick={onResetFeatures}
              className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CategoryPredictorResults({
  loadingParticipants,
  model,
  selectedFeatures,
  onToggleFeature,
  onSaveDefaults,
  savedFeedback,
  onResetFeatures,
}: CategoryPredictorResultsProps) {
  const coeffLabels = model
    ? ['Intercept', ...model.activeFeatureKeys.map(k => FEATURE_DEFS.find(f => f.key === k)!.label)]
    : [];

  const scatterVelos = model?.trainingPoints.map(p => p.actual) ?? [];
  const minVelo = scatterVelos.length ? Math.min(...scatterVelos) - 100 : 400;
  const maxVelo = scatterVelos.length ? Math.max(...scatterVelos) + 100 : 2500;

  return (
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

      <RegressorSelector
        selectedFeatures={selectedFeatures}
        onToggleFeature={onToggleFeature}
        onSaveDefaults={onSaveDefaults}
        savedFeedback={savedFeedback}
        onResetFeatures={onResetFeatures}
      />

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
                      <td className="pr-8 py-1 text-foreground">{coeffLabels[i]}</td>
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
                  domain={[Math.floor(minVelo), Math.ceil(maxVelo)]}
                  tickFormatter={(v: number) => Math.round(v).toLocaleString()}
                  label={{ value: 'Actual vELO', position: 'insideBottom', offset: -15, fontSize: 12 }}
                  tick={{ fontSize: 11 }}
                />
                <YAxis
                  type="number"
                  dataKey="predicted"
                  name="Predicted vELO"
                  domain={[Math.floor(minVelo), Math.ceil(maxVelo)]}
                  tickFormatter={(v: number) => Math.round(v).toLocaleString()}
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
  );
}
