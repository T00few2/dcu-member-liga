'use client';

import { useState } from 'react';
import CategoryBadge from './CategoryBadge';
import {
  Participant,
  ModelResult,
  StravaRiderCache,
  ZR_CATEGORY_DEFAULTS,
  predictionFromInputs,
  inputsFromParticipant,
  impliedCategoryFromParticipant,
  predictionFromStravaCache,
  riderAssignedCategory,
} from './shared';

export interface CategoryPredictorRosterProps {
  riders: Participant[];
  model: ModelResult | null;
  selectedZwiftId: string;
  onSelectRider: (zwiftId: string) => void;
  showUnassignedOnly: boolean;
  onSetShowUnassignedOnly: (v: boolean) => void;
  showMismatchOnly: boolean;
  onSetShowMismatchOnly: (v: boolean) => void;
  stravaByRider: Record<string, StravaRiderCache>;
  loadingStravaIds: Record<string, true>;
  bulkStravaProgress: { done: number; total: number } | null;
  onLoadStrava: (zwiftId: string) => void;
  onLoadStravaAll: () => void;
  assignedOverlay: Record<string, string>;
  assigningZwiftId: string | null;
  assignErrors: Record<string, string>;
  onAssign: (zwiftId: string, choice: string) => void;
}

function Dash({ title }: { title?: string }) {
  return (
    <span className="text-muted-foreground" title={title}>—</span>
  );
}

function rideCountTitle(count: number | null | undefined): string | undefined {
  if (count == null) return undefined;
  return count === 1 ? '1 ride' : `${count} rides`;
}

export default function CategoryPredictorRoster({
  riders,
  model,
  selectedZwiftId,
  onSelectRider,
  showUnassignedOnly,
  onSetShowUnassignedOnly,
  showMismatchOnly,
  onSetShowMismatchOnly,
  stravaByRider,
  loadingStravaIds,
  bulkStravaProgress,
  onLoadStrava,
  onLoadStravaAll,
  assignedOverlay,
  assigningZwiftId,
  assignErrors,
  onAssign,
}: CategoryPredictorRosterProps) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const pendingStrava = riders.filter(p => {
    if (loadingStravaIds[p.zwiftId]) return false;
    const entry = stravaByRider[p.zwiftId];
    return !entry || Boolean(entry.error);
  }).length;
  const bulkBusy = bulkStravaProgress != null;

  return (
    <div className="bg-card border border-border rounded-lg p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-xl font-semibold text-foreground mb-1">Rider overview</h2>
          <p className="text-sm text-muted-foreground max-w-3xl">
            Lower/upper columns are the RMSE band around the predicted vELO, mapped to categories.
            Strava stays empty until you load it. Click a name to open the detailed form below.
          </p>
        </div>
        <button
          onClick={onLoadStravaAll}
          disabled={bulkBusy || pendingStrava === 0}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {bulkBusy
            ? `Loading Strava ${bulkStravaProgress.done}/${bulkStravaProgress.total}…`
            : pendingStrava > 0
              ? `Load Strava (${pendingStrava})`
              : 'Strava loaded'}
        </button>
      </div>

      <div className="flex items-center gap-4 mb-3 flex-wrap">
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
        <span className="text-xs text-muted-foreground">{riders.length} rider{riders.length === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-auto max-h-[32rem] border border-border rounded-md">
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-xs uppercase text-muted-foreground border-b border-border">
              <th rowSpan={2} className="px-3 py-2 font-medium text-foreground normal-case text-sm whitespace-nowrap">Rider</th>
              <th rowSpan={2} className="px-3 py-2 font-medium text-center whitespace-nowrap">vELO</th>
              <th colSpan={3} className="px-3 py-2 font-medium text-center border-l border-border">Zwift predicted</th>
              <th colSpan={3} className="px-3 py-2 font-medium text-center border-l border-border">Strava predicted</th>
              <th rowSpan={2} className="px-3 py-2 font-medium text-foreground normal-case text-sm whitespace-nowrap border-l border-border">Assign as</th>
              <th rowSpan={2} className="px-3 py-2 font-medium text-foreground normal-case text-sm whitespace-nowrap">Assign</th>
            </tr>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="px-3 py-1 font-medium text-center border-l border-border whitespace-nowrap">Lower</th>
              <th className="px-3 py-1 font-medium text-center whitespace-nowrap">Upper</th>
              <th className="px-3 py-1 font-medium text-center whitespace-nowrap">Rides</th>
              <th className="px-3 py-1 font-medium text-center border-l border-border whitespace-nowrap">Lower</th>
              <th className="px-3 py-1 font-medium text-center whitespace-nowrap">Upper</th>
              <th className="px-3 py-1 font-medium text-center whitespace-nowrap">Rides</th>
            </tr>
          </thead>
          <tbody>
            {riders.length === 0 && (
              <tr>
                <td colSpan={10} className="px-3 py-6 text-center text-muted-foreground">
                  No riders match the current filters.
                </td>
              </tr>
            )}
            {riders.map(p => {
              const zwiftPred = predictionFromInputs(model, inputsFromParticipant(p));
              const stravaEntry = stravaByRider[p.zwiftId];
              const stravaPred = predictionFromStravaCache(model, p, stravaEntry);
              const stravaLoading = Boolean(loadingStravaIds[p.zwiftId]);
              const veloCat = impliedCategoryFromParticipant(p);
              const assigned = riderAssignedCategory(p, assignedOverlay);
              const locked = Boolean(p.ligaCategory?.locked);
              const choice = choices[p.zwiftId] ?? 'zwift';
              const zwiftReady = zwiftPred.velo != null;
              const stravaReady = stravaPred.velo != null;
              const assignReady =
                choice === 'zwift' ? zwiftReady
                : choice === 'strava' ? stravaReady
                : Boolean(choice);
              const selected = p.zwiftId === selectedZwiftId;
              const rowError = assignErrors[p.zwiftId];

              return (
                <tr
                  key={p.zwiftId}
                  className={`border-b border-border last:border-0 ${selected ? 'bg-primary/5' : 'hover:bg-muted/40'}`}
                >
                  <td className="px-3 py-2 whitespace-nowrap">
                    <button
                      type="button"
                      onClick={() => onSelectRider(p.zwiftId)}
                      className="text-left font-medium text-foreground hover:underline"
                    >
                      {p.name}
                    </button>
                    {assigned && (
                      <span className="ml-1.5 text-xs text-muted-foreground">({assigned})</span>
                    )}
                    {locked && (
                      <span className="ml-1.5 text-xs text-amber-700">locked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {veloCat ? <CategoryBadge name={veloCat} compact /> : <Dash />}
                  </td>
                  <td className="px-3 py-2 text-center border-l border-border">
                    {zwiftPred.catLow ? <CategoryBadge name={zwiftPred.catLow} compact /> : <Dash />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {zwiftPred.catHigh ? <CategoryBadge name={zwiftPred.catHigh} compact /> : <Dash />}
                  </td>
                  <td
                    className="px-3 py-2 text-center text-xs text-muted-foreground tabular-nums whitespace-nowrap"
                    title={rideCountTitle(p.zwiftActivityCount)}
                  >
                    {p.zwiftActivityCount == null ? <Dash /> : p.zwiftActivityCount}
                  </td>
                  <td className="px-3 py-2 text-center border-l border-border">
                    {stravaLoading ? (
                      <span className="text-xs text-muted-foreground">…</span>
                    ) : stravaPred.catLow ? (
                      <CategoryBadge name={stravaPred.catLow} compact />
                    ) : (
                      <Dash title={stravaEntry?.error} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {stravaLoading ? (
                      <span className="text-xs text-muted-foreground">…</span>
                    ) : stravaPred.catHigh ? (
                      <CategoryBadge name={stravaPred.catHigh} compact />
                    ) : (
                      <Dash title={stravaEntry?.error} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                    {stravaLoading ? (
                      <span>…</span>
                    ) : stravaEntry?.error ? (
                      <button
                        type="button"
                        onClick={() => onLoadStrava(p.zwiftId)}
                        className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90"
                      >
                        Retry
                      </button>
                    ) : stravaEntry ? (
                      <span title={rideCountTitle(stravaEntry.activityCount)}>
                        {stravaEntry.activityCount == null ? <Dash /> : stravaEntry.activityCount}
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => onLoadStrava(p.zwiftId)}
                        className="text-xs px-2 py-0.5 rounded bg-primary text-primary-foreground hover:opacity-90"
                      >
                        Load
                      </button>
                    )}
                  </td>
                  <td className="px-3 py-2 border-l border-border whitespace-nowrap">
                    {locked ? (
                      <span className="text-xs text-muted-foreground">Locked after racing</span>
                    ) : (
                      <select
                        aria-label={`Assign ${p.name}`}
                        value={choice}
                        onChange={e => setChoices(prev => ({ ...prev, [p.zwiftId]: e.target.value }))}
                        className="border border-border rounded px-1.5 py-1 text-xs bg-background text-foreground w-full min-w-[9.5rem]"
                      >
                        <option value="zwift">Zwift ({zwiftPred.category ?? '—'})</option>
                        <option value="strava" disabled={!stravaReady}>
                          Strava ({stravaPred.category ?? '—'})
                        </option>
                        {ZR_CATEGORY_DEFAULTS.map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    )}
                    {rowError && (
                      <p className="text-xs text-red-600 mt-0.5 max-w-[16rem]">{rowError}</p>
                    )}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {!locked && (
                      <button
                        type="button"
                        onClick={() => onAssign(p.zwiftId, choice)}
                        disabled={!assignReady || assigningZwiftId === p.zwiftId}
                        className="px-2.5 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
                      >
                        {assigningZwiftId === p.zwiftId ? '…' : 'Assign'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
