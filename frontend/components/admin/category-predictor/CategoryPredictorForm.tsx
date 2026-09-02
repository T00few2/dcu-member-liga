'use client';

import {
  SharedField,
  PowerField,
  PowerInputs,
  SharedInputs,
  Participant,
  ModelResult,
  PredictionSnapshot,
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
  /** Whether the Strava fetch is in progress. */
  loadingStrava: boolean;
  /** Called when the user clicks "Load" in the Strava column. */
  onLoadStrava: () => void;
  /** Error message from the last Strava fetch, or empty string. */
  stravaError: string;
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

const POWER_FIELDS: [PowerField, string, string][] = [
  ['wkg5s',  '5s W/kg',    '0.01'],
  ['wkg1m',  '1min W/kg',  '0.01'],
  ['wkg5m',  '5min W/kg',  '0.01'],
  ['wkg20m', '20min W/kg', '0.01'],
];

const SHARED_FIELDS: [SharedField, string, string][] = [
  ['weightKg',    'Weight (kg)', '0.1'],
  ['racingScore', 'ZRS',         '1'],
];

function compound5m(weightKg: number, wkg5m: number): number {
  return weightKg > 0 ? (wkg5m * weightKg) ** 2 / weightKg : 0;
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
  loadingStrava,
  onLoadStrava,
  stravaError,
  shared,
  onSetSharedInput,
  zwiftPower,
  stravaPower,
  onSetPowerInput,
  model,
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

  const zwiftCompound = compound5m(shared.weightKg, zwiftPower.wkg5m);
  const stravaCompound = compound5m(shared.weightKg, stravaPower.wkg5m);

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-foreground mb-1">Predict &amp; Assign</h2>
      <p className="text-sm text-muted-foreground mb-4">
        All riders are shown in the dropdown, including locked riders. Selecting a rider pre-fills their Zwift power.
        Click <strong>Load</strong> in the Strava column to pull 90-day outdoor power — useful for riders who train
        outdoors but race on Zwift. Both columns stay visible so you can compare predictions directly.
        All fields are editable; predictions update live.
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
              onChange={e => onSetShowUnassignedOnly(e.target.checked)}
            />
            Unassigned only
          </label>
        </div>
        <select
          value={selectedZwiftId}
          onChange={e => onSelectRider(e.target.value)}
          className="border border-border rounded px-3 py-2 text-sm bg-background text-foreground w-full max-w-sm"
        >
          <option value="">— select a rider —</option>
          {participants
            .filter(p => {
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

      {/* Shared fields: weight + ZRS apply to both columns */}
      <div className="grid grid-cols-2 gap-x-8 gap-y-3 max-w-sm mb-5">
        {SHARED_FIELDS.map(([field, label, step]) => (
          <div key={field} className="contents">
            <label className="text-sm text-foreground self-center">{label}</label>
            <input
              type="number"
              step={step}
              value={shared[field] || ''}
              onChange={e => onSetSharedInput(field, e.target.value)}
              className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
            />
          </div>
        ))}
      </div>

      {/* Zwift vs Strava comparison */}
      <div className="overflow-x-auto mb-4">
        <table className="text-sm w-auto">
          <thead>
            <tr>
              <th className="text-left pb-2 pr-4 font-medium text-foreground w-32" />
              <th className={columnHeaderClass(zwiftActive)}>
                <span className="text-sm font-semibold text-foreground">Zwift</span>
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">90d</span>
              </th>
              <th className={columnHeaderClass(stravaActive)}>
                <div className="flex items-center gap-2">
                  <span>
                    <span className="text-sm font-semibold text-foreground">Strava</span>
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">90d</span>
                  </span>
                  <button
                    onClick={onLoadStrava}
                    disabled={!selectedZwiftId || loadingStrava}
                    className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    {loadingStrava ? 'Loading…' : 'Load'}
                  </button>
                </div>
              </th>
            </tr>
          </thead>
          <tbody>
            {POWER_FIELDS.map(([field, label, step]) => (
              <tr key={field}>
                <td className="text-sm text-foreground pr-4 py-1.5 whitespace-nowrap">{label}</td>
                <td className={columnCellClass(zwiftActive)}>
                  <input
                    type="number"
                    step={step}
                    value={zwiftPower[field] || ''}
                    onChange={e => onSetPowerInput('zwift', field, e.target.value)}
                    className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
                  />
                </td>
                <td className={columnCellClass(stravaActive)}>
                  <input
                    type="number"
                    step={step}
                    value={stravaPower[field] || ''}
                    onChange={e => onSetPowerInput('strava', field, e.target.value)}
                    className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
                  />
                </td>
              </tr>
            ))}
            <tr>
              <td className="text-sm text-muted-foreground pr-4 py-1.5 whitespace-nowrap">5m²/kg (auto)</td>
              <td className={`${columnCellClass(zwiftActive)} font-mono text-muted-foreground`}>
                {zwiftCompound > 0 ? zwiftCompound.toFixed(1) : '—'}
              </td>
              <td className={`${columnCellClass(stravaActive)} font-mono text-muted-foreground`}>
                {stravaCompound > 0 ? stravaCompound.toFixed(1) : '—'}
              </td>
            </tr>
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
