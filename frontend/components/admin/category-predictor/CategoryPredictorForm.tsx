'use client';

import {
  Inputs,
  Participant,
  ModelResult,
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
  /** Active power source tab. */
  powerSource: 'zwift' | 'strava';
  onSetPowerSource: (src: 'zwift' | 'strava') => void;
  /** Whether the Strava fetch is in progress. */
  loadingStrava: boolean;
  /** Called when the user clicks "Load" in Strava mode. */
  onLoadStrava: () => void;
  /** Error message from the last Strava fetch, or empty string. */
  stravaError: string;
  /** Current manual input values. */
  inputs: Inputs;
  /** Called when the user edits an input field. */
  onSetInput: (field: keyof Inputs, value: string) => void;
  /** Fitted OLS model — used to derive predicted vELO and RMSE. */
  model: ModelResult | null;
  /** Predicted vELO from the model, or null if inputs are incomplete. */
  predictedVelo: number | null;
  /** Predicted category name, or null. */
  predictedCategory: string | null;
  /** Lower bound of RMSE uncertainty band. */
  predLow: number | null;
  /** Upper bound of RMSE uncertainty band. */
  predHigh: number | null;
  /** Category at the lower RMSE bound. */
  catLow: string | null;
  /** Category at the upper RMSE bound. */
  catHigh: string | null;
  /** Actual vELO for the selected rider, or null if unavailable. */
  actualVelo: number | null;
  /** Current manual category override (empty string = use predicted). */
  manualCategory: string;
  onSetManualCategory: (cat: string) => void;
  /** Whether the assign API call is in progress. */
  assigning: boolean;
  /** Called when the user clicks "Assign". */
  onAssign: () => void;
  /** Result from the last successful assign, or null. */
  assignResult: { category: string } | null;
  /** Error message from the last assign attempt, or empty string. */
  assignError: string;
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
  powerSource,
  onSetPowerSource,
  loadingStrava,
  onLoadStrava,
  stravaError,
  inputs,
  onSetInput,
  model,
  predictedVelo,
  predictedCategory,
  predLow,
  predHigh,
  catLow,
  catHigh,
  actualVelo,
  manualCategory,
  onSetManualCategory,
  assigning,
  onAssign,
  assignResult,
  assignError,
}: CategoryPredictorFormProps) {
  // Compound 5m is derived from inputs — belongs here since only this panel displays it
  const compound5m =
    inputs.weightKg > 0 ? (inputs.wkg5m * inputs.weightKg) ** 2 / inputs.weightKg : 0;

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <h2 className="text-xl font-semibold text-foreground mb-1">Predict &amp; Assign</h2>
      <p className="text-sm text-muted-foreground mb-4">
        All riders are shown in the dropdown, including locked riders. Selecting a rider pre-fills their Zwift power data.
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

      {/* Power source toggle */}
      <div className="flex items-center gap-4 mb-4">
        <span className="text-sm font-medium text-foreground">Power source:</span>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="radio"
            name="powerSource"
            value="zwift"
            checked={powerSource === 'zwift'}
            onChange={() => { onSetPowerSource('zwift'); }}
          />
          Zwift (90d)
        </label>
        <label className="flex items-center gap-1.5 text-sm cursor-pointer">
          <input
            type="radio"
            name="powerSource"
            value="strava"
            checked={powerSource === 'strava'}
            onChange={() => onSetPowerSource('strava')}
          />
          Strava (90d)
        </label>
        {powerSource === 'strava' && (
          <button
            onClick={onLoadStrava}
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
        {([
          ['weightKg',    'Weight (kg)', '0.1'],
          ['racingScore', 'ZRS',         '1'],
          ['wkg5s',       '5s W/kg',    '0.01'],
          ['wkg1m',       '1min W/kg',  '0.01'],
          ['wkg5m',       '5min W/kg',  '0.01'],
          ['wkg20m',      '20min W/kg', '0.01'],
        ] as [keyof Inputs, string, string][]).map(([field, label, step]) => (
          <>
            <label key={field + '_lbl'} className="text-sm text-foreground self-center">{label}</label>
            <input
              key={field}
              type="number"
              step={step}
              value={inputs[field] || ''}
              onChange={e => onSetInput(field, e.target.value)}
              className="border border-border rounded px-2 py-1 text-sm bg-background text-foreground w-24"
            />
          </>
        ))}
        <label className="text-sm text-muted-foreground self-center">5m²/kg (auto)</label>
        <span className="text-sm text-muted-foreground py-1 w-24 font-mono">
          {compound5m > 0 ? compound5m.toFixed(1) : '—'}
        </span>
      </div>

      {/* Prediction result */}
      <div className="flex flex-wrap gap-6 mb-4 text-sm">
        <div className="space-y-1">
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
          {predLow != null && predHigh != null && (
            <div className="text-xs text-muted-foreground flex items-center gap-1 flex-wrap">
              <span>±{model!.rmse} pts → {predLow.toLocaleString()}–{predHigh.toLocaleString()}</span>
              {catLow && catHigh && (
                <>
                  <span>(</span>
                  <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${ZR_CATEGORY_STYLES[catLow] ?? 'bg-slate-100 text-slate-800'}`}>{catLow}</span>
                  {catLow !== catHigh && (
                    <>
                      <span>–</span>
                      <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full font-medium ${ZR_CATEGORY_STYLES[catHigh] ?? 'bg-slate-100 text-slate-800'}`}>{catHigh}</span>
                    </>
                  )}
                  <span>)</span>
                </>
              )}
            </div>
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

      {/* Category override + assign */}
      <div className="flex flex-wrap items-center gap-3 mb-2">
        <label className="text-sm font-medium text-foreground">Assign as</label>
        <select
          value={manualCategory}
          onChange={e => { onSetManualCategory(e.target.value); }}
          className="border border-border rounded px-2 py-1.5 text-sm bg-background text-foreground"
        >
          <option value="">Predicted ({predictedCategory ?? '—'})</option>
          {ZR_CATEGORY_DEFAULTS.map(c => (
            <option key={c.name} value={c.name}>{c.name}</option>
          ))}
        </select>
        <button
          onClick={onAssign}
          disabled={!selectedZwiftId || (!manualCategory && predictedVelo == null) || assigning}
          className="px-4 py-2 rounded bg-primary text-primary-foreground text-sm font-medium hover:opacity-90 disabled:opacity-50"
        >
          {assigning ? 'Assigning…' : `Assign to ${manualCategory || predictedCategory || '—'}`}
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
