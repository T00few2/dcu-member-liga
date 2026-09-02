'use client';

import { Fragment, useMemo } from 'react';
import {
  SharedField,
  PowerField,
  PowerInputs,
  SharedInputs,
  Participant,
  ModelResult,
  PredictionSnapshot,
  FeatureKey,
  FEATURE_DEFS,
  predictorFormLayout,
  hasPredictedVsImpliedMismatch,
  impliedCategoryFromParticipant,
  predictedCategoryFromParticipant,
  ZR_CATEGORY_DEFAULTS,
  ZR_CATEGORY_STYLES,
} from './shared';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface CategoryPredictorFormProps {
  /** Full participant list — used to populate the rider dropdown. */
  participants: Participant[];
  /** Currently selected rider's Zwift ID, or empty string if none. */
  selectedZwiftId: string;
  /** Called when a new rider is chosen from the dropdown. */
  onSelectRider: (zwiftId: string) => void;
  /** Whether to show only riders without an assigned category. */
  showUnassignedOnly: boolean;
  onSetShowUnassignedOnly: (v: boolean) => void;
  /** Whether to show only riders whose predicted category differs from their vELO category. */
  showMismatchOnly: boolean;
  onSetShowMismatchOnly: (v: boolean) => void;
  /** Whether the Strava fetch is in progress. */
  loadingStrava: boolean;
  /** Called when the user clicks "Load" in the Strava column. */
  onLoadStrava: () => void;
  /** Error message from the last Strava fetch, or empty string. */
  stravaError: string;
  /** Zwift activities in the CP window for the selected rider, if known. */
  zwiftRideCount?: number | null;
  /** Strava activities used for the loaded 90d curve, if loaded. */
  stravaRideCount?: number | null;
  /** Weight and ZRS — shared by both power sources. */
  shared: SharedInputs;
  onSetSharedInput: (field: SharedField, value: string) => void;
  /** Zwift 90-day power values. */
  zwiftPower: PowerInputs;
  /** Strava 90-day power values. */
  stravaPower: PowerInputs;
  onSetPowerInput: (source: 'zwift' | 'strava', field: PowerField, value: string) => void;
  /** Fitted OLS model — used for the RMSE band. */
  model: ModelResult | null;
  /** Feature keys currently in the fitted (or selected) model. */
  activeFeatureKeys: FeatureKey[];
  zwiftPrediction: PredictionSnapshot;
  stravaPrediction: PredictionSnapshot;
  /** Actual vELO for the selected rider, or null if unavailable. */
  actualVelo: number | null;
  /**
   * Assign target: `'zwift'` / `'strava'` uses that column's prediction;
   * any other value is a manual category name.
   */
  assignChoice: string;
  onSetAssignChoice: (choice: string) => void;
  /** Whether the assign API call is in progress. */
  assigning: boolean;
  /** Called when the user clicks "Assign". */
  onAssign: () => void;
  /** Result from the last successful assign, or null. */
  assignResult: { category: string } | null;
  /** Error message from the last assign attempt, or empty string. */
  assignError: string;
}

function rideCountSuffix(count: number | null | undefined): string {
  if (count == null) return '';
  return ` · ${count} ${count === 1 ? 'ride' : 'rides'}`;
}

function compoundScore(weightKg: number, wkg: number): number {
  return weightKg > 0 ? (wkg * weightKg) ** 2 / weightKg : 0;
}

function wattsFromWkg(weightKg: number, wkg: number): number {
  return weightKg > 0 && wkg > 0 ? wkg * weightKg : 0;
}

function DerivedCell({ value, active }: { value: number; active: boolean }) {
  return (
    <td className={`${columnCellClass(active)} font-mono text-muted-foreground`}>
      {value > 0 ? value.toFixed(1) : '—'}
    </td>
  );
}

function CategoryBadge({ name }: { name: string }) {
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${ZR_CATEGORY_STYLES[name] ?? 'bg-slate-100 text-slate-800'}`}>
      {name}
    </span>
  );
}

function PredictionCell({ pred, model }: { pred: PredictionSnapshot; model: ModelResult | null }) {
  return (
    <div className="space-y-1">
      <div>
        {pred.velo != null ? (
          <span className="font-semibold text-foreground">{pred.velo.toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
        {pred.category && (
          <>
            {' → '}
            <CategoryBadge name={pred.category} />
          </>
        )}
      </div>
      {pred.low != null && pred.high != null && model && (
        <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
          <span>±{model.rmse} pts → {pred.low.toLocaleString()}–{pred.high.toLocaleString()}</span>
          {pred.catLow && pred.catHigh && (
            <>
              <span>(</span>
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${ZR_CATEGORY_STYLES[pred.catLow] ?? 'bg-slate-100 text-slate-800'}`}>{pred.catLow}</span>
              {pred.catLow !== pred.catHigh && (
                <>
                  <span>–</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${ZR_CATEGORY_STYLES[pred.catHigh] ?? 'bg-slate-100 text-slate-800'}`}>{pred.catHigh}</span>
                </>
              )}
              <span>)</span>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function columnHeaderClass(active: boolean): string {
  return [
    'text-left pb-2 px-3 min-w-[10rem]',
    active ? 'bg-primary/5 border-b-2 border-primary' : 'border-b border-border',
  ].join(' ');
}

function columnCellClass(active: boolean): string {
  return [
    'py-1.5 px-3',
    active ? 'bg-primary/5' : '',
  ].join(' ');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function CategoryPredictorForm({
  participants,
  selectedZwiftId,
  onSelectRider,
  showUnassignedOnly,
  onSetShowUnassignedOnly,
  showMismatchOnly,
  onSetShowMismatchOnly,
  loadingStrava,
  onLoadStrava,
  stravaError,
  zwiftRideCount = null,
  stravaRideCount = null,
  shared,
  onSetSharedInput,
  zwiftPower,
  stravaPower,
  onSetPowerInput,
  model,
  activeFeatureKeys,
  zwiftPrediction,
  stravaPrediction,
  actualVelo,
  assignChoice,
  onSetAssignChoice,
  assigning,
  onAssign,
  assignResult,
  assignError,
}: CategoryPredictorFormProps) {
  const zwiftActive = assignChoice === 'zwift';
  const stravaActive = assignChoice === 'strava';
  const assignCategory =
    assignChoice === 'zwift' ? zwiftPrediction.category
    : assignChoice === 'strava' ? stravaPrediction.category
    : assignChoice;
  const assignVeloReady =
    assignChoice === 'zwift' ? zwiftPrediction.velo != null
    : assignChoice === 'strava' ? stravaPrediction.velo != null
    : Boolean(assignChoice);

  const layout = predictorFormLayout(activeFeatureKeys);
  const modelLabels = activeFeatureKeys
    .map(k => FEATURE_DEFS.find(f => f.key === k)?.label)
    .filter((label): label is string => Boolean(label));

  const riderOptions = useMemo(() => {
    return participants
      .filter(p => {
        if (showUnassignedOnly && p.ligaCategory?.category) return false;
        if (showMismatchOnly && !hasPredictedVsImpliedMismatch(model, p)) return false;
        return true;
      })
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(p => {
        const implied = impliedCategoryFromParticipant(p);
        const predicted = predictedCategoryFromParticipant(model, p);
        const mismatch = implied != null && predicted != null && implied !== predicted;
        let label = p.name;
        if (p.ligaCategory?.category) label += ` (${p.ligaCategory.category})`;
        if (mismatch) label += ` · vELO ${implied} ≠ ${predicted}`;
        return { zwiftId: p.zwiftId, label };
      });
  }, [participants, showUnassignedOnly, showMismatchOnly, model]);

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-foreground mb-1">Predict &amp; Assign</h2>
      <p className="text-sm text-muted-foreground mb-4">
        All riders are shown in the dropdown, including locked riders. Selecting a rider pre-fills their Zwift power.
        Click <strong>Load</strong> in the Strava column to pull 90-day outdoor power — useful for riders who train
        outdoors but race on Zwift. Both columns stay visible so you can compare predictions directly.
        Fields follow the regressors currently checked above; predictions update live.
        <br />
        <span className="text-xs">
          W/kg is the editable input. Watts and compound scores (watts² ÷ kg) are derived from W/kg and weight —
          they are the same numbers the coefficients table uses, not extra independent inputs.
          If the rider&apos;s weight is wrong, correct it here before assigning.
        </span>
      </p>

      {/* Rider dropdown */}
      <div className="mb-4">
        <div className="flex items-center gap-4 mb-1 flex-wrap">
          <label htmlFor="predictor-rider" className="text-sm font-medium text-foreground">Rider</label>
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={showUnassignedOnly}
              onChange={e => onSetShowUnassignedOnly(e.target.checked)}
            />
            Unassigned only
          </label>
          <label
            className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer"
            title="Riders whose current-model predicted category (from Zwift power) differs from the category implied by their ZwiftRacing vELO"
          >
            <input
              type="checkbox"
              checked={showMismatchOnly}
              onChange={e => onSetShowMismatchOnly(e.target.checked)}
            />
            Predicted ≠ vELO category
          </label>
        </div>
        <select
          id="predictor-rider"
          value={selectedZwiftId}
          onChange={e => onSelectRider(e.target.value)}
          className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground w-full max-w-sm"
        >
          <option value="">— select a rider —</option>
          {riderOptions.map(p => (
            <option key={p.zwiftId} value={p.zwiftId}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {!selectedZwiftId && (
        <p className="text-sm text-muted-foreground mb-4">
          Select a rider to fill Zwift power and see a prediction.
        </p>
      )}

      {modelLabels.length > 0 && (
        <p className="text-xs text-muted-foreground mb-4">
          Using current model: {modelLabels.join(', ')}
        </p>
      )}

      {/* Shared fields: weight + ZRS apply to both columns */}
      {(layout.showWeight || layout.showZrs) && (
        <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-w-sm mb-5">
          {layout.showWeight && (
            <>
              <label className="text-sm text-foreground self-center">Weight (kg)</label>
              <input
                type="number"
                step="0.1"
                value={shared.weightKg || ''}
                onChange={e => onSetSharedInput('weightKg', e.target.value)}
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
              />
            </>
          )}
          {layout.showZrs && (
            <>
              <label className="text-sm text-foreground self-center">ZRS</label>
              <input
                type="number"
                step="1"
                value={shared.racingScore || ''}
                onChange={e => onSetSharedInput('racingScore', e.target.value)}
                className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
              />
            </>
          )}
        </div>
      )}

      {/* Zwift vs Strava comparison — only power rows the current model uses */}
      <div className="overflow-x-auto mb-4">
        <table className="text-sm w-auto">
          <thead>
            <tr>
              <th className="text-left pb-2 pr-4 font-medium text-foreground w-32" />
              <th className={columnHeaderClass(zwiftActive)}>
                <span className="text-sm font-semibold text-foreground">Zwift</span>
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  90d{rideCountSuffix(zwiftRideCount)}
                </span>
              </th>
              <th className={columnHeaderClass(stravaActive)}>
                <div className="flex items-center gap-2">
                  <span>
                    <span className="text-sm font-semibold text-foreground">Strava</span>
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      90d{rideCountSuffix(stravaRideCount)}
                    </span>
                  </span>
                  {layout.usesPower && (
                    <button
                      onClick={onLoadStrava}
                      disabled={!selectedZwiftId || loadingStrava}
                      className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                    >
                      {loadingStrava ? 'Loading…' : 'Load'}
                    </button>
                  )}
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {layout.powerRows.map(row => (
              <Fragment key={row.field}>
                <tr>
                  <td className="text-sm text-foreground pr-4 py-1.5 whitespace-nowrap">{row.label}</td>
                  <td className={columnCellClass(zwiftActive)}>
                    <input
                      type="number"
                      step={row.step}
                      value={zwiftPower[row.field] || ''}
                      onChange={e => onSetPowerInput('zwift', row.field, e.target.value)}
                      className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
                    />
                  </td>
                  <td className={columnCellClass(stravaActive)}>
                    <input
                      type="number"
                      step={row.step}
                      value={stravaPower[row.field] || ''}
                      onChange={e => onSetPowerInput('strava', row.field, e.target.value)}
                      className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
                    />
                  </td>
                </tr>
                {row.wattsLabel && (
                  <tr>
                    <td className="text-sm text-muted-foreground pr-4 py-1.5 whitespace-nowrap">{row.wattsLabel}</td>
                    <DerivedCell value={wattsFromWkg(shared.weightKg, zwiftPower[row.field])} active={zwiftActive} />
                    <DerivedCell value={wattsFromWkg(shared.weightKg, stravaPower[row.field])} active={stravaActive} />
                  </tr>
                )}
                {row.compoundLabel && (
                  <tr>
                    <td className="text-sm text-muted-foreground pr-4 py-1.5 whitespace-nowrap">{row.compoundLabel}</td>
                    <DerivedCell value={compoundScore(shared.weightKg, zwiftPower[row.field])} active={zwiftActive} />
                    <DerivedCell value={compoundScore(shared.weightKg, stravaPower[row.field])} active={stravaActive} />
                  </tr>
                )}
              </Fragment>
            ))}
            <tr>
              <td className="text-sm text-foreground pr-4 pt-3 align-top whitespace-nowrap">Predicted vELO</td>
              <td className={`${columnCellClass(zwiftActive)} pt-3 align-top`}>
                <PredictionCell pred={zwiftPrediction} model={model} />
              </td>
              <td className={`${columnCellClass(stravaActive)} pt-3 align-top`}>
                <PredictionCell pred={stravaPrediction} model={model} />
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      {zwiftPrediction.velo != null && stravaPrediction.velo != null && (
        <p className="text-sm text-muted-foreground mb-4">
          Strava is{' '}
          {stravaPrediction.velo === zwiftPrediction.velo
            ? 'equal to Zwift'
            : `${stravaPrediction.velo > zwiftPrediction.velo ? 'higher' : 'lower'} by ${Math.abs(stravaPrediction.velo - zwiftPrediction.velo).toLocaleString()} pts`}
          {zwiftPrediction.category && stravaPrediction.category && zwiftPrediction.category !== stravaPrediction.category && (
            <> · {stravaPrediction.category} vs {zwiftPrediction.category}</>
          )}
        </p>
      )}

      {stravaError && (
        <p className="text-red-600 text-sm mb-4">{stravaError}</p>
      )}

      <div className="mb-4 text-sm">
        <span className="text-muted-foreground">Actual vELO: </span>
        {actualVelo != null && !isNaN(actualVelo) ? (
          <span className="font-semibold text-foreground">{Math.round(actualVelo).toLocaleString()}</span>
        ) : (
          <span className="text-muted-foreground">N/A</span>
        )}
      </div>

      {/* Category override + assign */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label htmlFor="predictor-assign" className="text-sm font-medium text-foreground">Assign as</label>
        <select
          id="predictor-assign"
          value={assignChoice}
          onChange={e => onSetAssignChoice(e.target.value)}
          className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
        >
          <option value="zwift">Predicted Zwift ({zwiftPrediction.category ?? '—'})</option>
          <option value="strava">Predicted Strava ({stravaPrediction.category ?? '—'})</option>
          {ZR_CATEGORY_DEFAULTS.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={onAssign}
          disabled={!selectedZwiftId || !assignVeloReady || assigning}
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {assigning ? 'Assigning…' : `Assign to ${assignCategory || '—'}`}
        </button>
      </div>

      {assignResult && (
        <p className="mt-3 text-green-600 text-sm font-medium">
          Assigned to {assignResult.category}.
        </p>
      )}
      {assignError && (
        <p className="mt-3 text-red-600 text-sm">{assignError}</p>
      )}
    </div>
  );
}
