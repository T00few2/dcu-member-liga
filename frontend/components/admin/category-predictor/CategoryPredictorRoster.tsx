'use client';

import { useMemo, useState } from 'react';
import CategoryBadge from './CategoryBadge';
import {
  Participant,
  ModelResult,
  StravaRiderCache,
  ZR_CATEGORY_DEFAULTS,
  predictionFromInputs,
  inputsFromParticipant,
  predictionFromStravaCache,
  riderAssignedCategory,
  formatVeloValue,
  parseVeloField,
} from './shared';

type RosterSortKey = 'name' | 'current' | 'max30' | 'zrs' | 'zwiftRides' | 'stravaRides';
type SortDir = 'asc' | 'desc';

export interface CategoryPredictorRosterProps {
  riders: Participant[];
  model: ModelResult | null;
  selectedZwiftId: string;
  onSelectRider: (zwiftId: string) => void;
  showUnassignedOnly: boolean;
  onSetShowUnassignedOnly: (v: boolean) => void;
  showMismatchOnly: boolean;
  onSetShowMismatchOnly: (v: boolean) => void;
  showZeroVeloOnly: boolean;
  onSetShowZeroVeloOnly: (v: boolean) => void;
  showNo30dVeloOnly: boolean;
  onSetShowNo30dVeloOnly: (v: boolean) => void;
  stravaByRider: Record<string, StravaRiderCache>;
  loadingStravaIds: Record<string, true>;
  bulkStravaProgress: { done: number; total: number } | null;
  onLoadStrava: (zwiftId: string) => void;
  onLoadStravaAll: () => void;
  assignedOverlay: Record<string, string>;
  assigningZwiftId: string | null;
  assignErrors: Record<string, string>;
  onAssign: (zwiftId: string, choice: string) => void;
  releasingZwiftId?: string | null;
  onRelease: (zwiftId: string, name: string) => void;
  categories?: typeof ZR_CATEGORY_DEFAULTS;
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

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  const path = !active
    ? 'M7 10l5-5 5 5zM7 14l5 5 5-5z'
    : dir === 'asc'
      ? 'M7 14l5-5 5 5z'
      : 'M7 10l5 5 5-5z';
  return (
    <svg
      aria-hidden="true"
      className={`inline shrink-0 ${active ? '' : 'opacity-30'}`}
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="currentColor"
    >
      <path d={path} />
    </svg>
  );
}

function SortableTh({
  label,
  column,
  activeKey,
  dir,
  onSort,
  rowSpan,
  className,
  ariaLabel,
}: {
  label: string;
  column: RosterSortKey;
  activeKey: RosterSortKey;
  dir: SortDir;
  onSort: (column: RosterSortKey) => void;
  rowSpan?: number;
  className: string;
  ariaLabel?: string;
}) {
  const active = activeKey === column;
  return (
    <th
      rowSpan={rowSpan}
      aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      className="p-0"
    >
      <button
        type="button"
        aria-label={ariaLabel}
        onClick={() => onSort(column)}
        className={`cursor-pointer select-none hover:bg-muted/60 ${className}`}
      >
        {label}
        <SortIcon active={active} dir={dir} />
      </button>
    </th>
  );
}

function stravaRideCount(entry: StravaRiderCache | undefined): number | null {
  if (!entry || entry.error || entry.activityCount == null) return null;
  return entry.activityCount;
}

function compareNames(a: Participant, b: Participant): number {
  return a.name.localeCompare(b.name);
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
  showZeroVeloOnly,
  onSetShowZeroVeloOnly,
  showNo30dVeloOnly,
  onSetShowNo30dVeloOnly,
  stravaByRider,
  loadingStravaIds,
  bulkStravaProgress,
  onLoadStrava,
  onLoadStravaAll,
  assignedOverlay,
  assigningZwiftId,
  assignErrors,
  onAssign,
  releasingZwiftId = null,
  onRelease,
  categories = ZR_CATEGORY_DEFAULTS,
}: CategoryPredictorRosterProps) {
  const [choices, setChoices] = useState<Record<string, string>>({});
  const [sortKey, setSortKey] = useState<RosterSortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  function handleSort(column: RosterSortKey) {
    if (sortKey === column) {
      setSortDir(dir => (dir === 'asc' ? 'desc' : 'asc'));
      return;
    }
    setSortKey(column);
    setSortDir(column === 'name' ? 'asc' : 'desc');
  }

  const sortedRiders = useMemo(() => {
    const numericValue = (p: Participant): number | null => {
      switch (sortKey) {
        case 'current':
          return parseVeloField(p.rating);
        case 'max30':
          return parseVeloField(p.max30Rating);
        case 'zrs':
          return parseVeloField(p.racingScore);
        case 'zwiftRides':
          return p.zwiftActivityCount == null ? null : p.zwiftActivityCount;
        case 'stravaRides':
          return stravaRideCount(stravaByRider[p.zwiftId]);
        default:
          return null;
      }
    };

    return [...riders].sort((a, b) => {
      if (sortKey === 'name') {
        const cmp = compareNames(a, b);
        return sortDir === 'asc' ? cmp : -cmp;
      }
      const av = numericValue(a);
      const bv = numericValue(b);
      if (av == null && bv == null) return compareNames(a, b);
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av !== bv) {
        const cmp = av < bv ? -1 : 1;
        return sortDir === 'asc' ? cmp : -cmp;
      }
      return compareNames(a, b);
    });
  }, [riders, sortKey, sortDir, stravaByRider]);

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
        <label
          className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer"
          title="Riders whose ZwiftRacing vELO is 0 or missing"
        >
          <input
            type="checkbox"
            checked={showZeroVeloOnly}
            onChange={e => onSetShowZeroVeloOnly(e.target.checked)}
          />
          vELO = 0
        </label>
        <label
          className="flex items-center gap-1.5 text-sm text-muted-foreground cursor-pointer"
          title="Riders whose 30-day max vELO is 0 or missing"
        >
          <input
            type="checkbox"
            checked={showNo30dVeloOnly}
            onChange={e => onSetShowNo30dVeloOnly(e.target.checked)}
          />
          No 30d vELO
        </label>
        <span className="text-xs text-muted-foreground">{riders.length} rider{riders.length === 1 ? '' : 's'}</span>
      </div>

      <div className="overflow-auto max-h-[32rem] border border-border rounded-md">
        <table className="w-full text-sm text-left">
          <thead className="sticky top-0 bg-card z-10">
            <tr className="text-xs uppercase text-muted-foreground border-b border-border">
              <SortableTh
                label="Rider"
                column="name"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                rowSpan={2}
                className="inline-flex w-full items-center gap-0.5 px-3 py-2 text-left text-sm font-medium normal-case text-foreground whitespace-nowrap hover:text-foreground"
              />
              <SortableTh
                label="Current"
                column="current"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                rowSpan={2}
                className="inline-flex w-full items-center justify-center gap-0.5 px-3 py-2 font-medium whitespace-nowrap hover:text-foreground"
              />
              <SortableTh
                label="30d max"
                column="max30"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                rowSpan={2}
                className="inline-flex w-full items-center justify-center gap-0.5 px-3 py-2 font-medium whitespace-nowrap hover:text-foreground"
              />
              <SortableTh
                label="ZRS"
                column="zrs"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                rowSpan={2}
                className="inline-flex w-full items-center justify-center gap-0.5 px-3 py-2 font-medium whitespace-nowrap hover:text-foreground"
              />
              <th rowSpan={2} className="px-3 py-2 font-medium text-center whitespace-nowrap">Category</th>
              <th colSpan={3} className="px-3 py-2 font-medium text-center border-l border-border">Zwift predicted</th>
              <th colSpan={3} className="px-3 py-2 font-medium text-center border-l border-border">Strava predicted</th>
              <th rowSpan={2} className="px-3 py-2 font-medium text-foreground normal-case text-sm whitespace-nowrap border-l border-border">Assign as</th>
              <th rowSpan={2} className="px-3 py-2 font-medium text-foreground normal-case text-sm whitespace-nowrap">Assign</th>
              <th rowSpan={2} className="px-3 py-2 font-medium text-foreground normal-case text-sm whitespace-nowrap">Release</th>
            </tr>
            <tr className="text-xs text-muted-foreground border-b border-border">
              <th className="px-3 py-1 font-medium text-center border-l border-border whitespace-nowrap">Lower</th>
              <th className="px-3 py-1 font-medium text-center whitespace-nowrap">Upper</th>
              <SortableTh
                label="Rides"
                ariaLabel="Zwift rides"
                column="zwiftRides"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                className="inline-flex w-full items-center justify-center gap-0.5 px-3 py-1 font-medium whitespace-nowrap hover:text-foreground"
              />
              <th className="px-3 py-1 font-medium text-center border-l border-border whitespace-nowrap">Lower</th>
              <th className="px-3 py-1 font-medium text-center whitespace-nowrap">Upper</th>
              <SortableTh
                label="Rides"
                ariaLabel="Strava rides"
                column="stravaRides"
                activeKey={sortKey}
                dir={sortDir}
                onSort={handleSort}
                className="inline-flex w-full items-center justify-center gap-0.5 px-3 py-1 font-medium whitespace-nowrap hover:text-foreground"
              />
            </tr>
          </thead>
          <tbody>
            {riders.length === 0 && (
              <tr>
                <td colSpan={14} className="px-3 py-6 text-center text-muted-foreground">
                  No riders match the current filters.
                </td>
              </tr>
            )}
            {sortedRiders.map(p => {
              const zwiftPred = predictionFromInputs(model, inputsFromParticipant(p));
              const stravaEntry = stravaByRider[p.zwiftId];
              const stravaPred = predictionFromStravaCache(model, p, stravaEntry);
              const stravaLoading = Boolean(loadingStravaIds[p.zwiftId]);
              const currentVelo = formatVeloValue(p.rating);
              const max30Velo = formatVeloValue(p.max30Rating);
              const zrs = formatVeloValue(p.racingScore);
              const assigned = riderAssignedCategory(p, assignedOverlay);
              const isManual = Boolean(p.ligaCategory?.manualAssignedCategory || assignedOverlay[p.zwiftId]);
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
                    {locked && (
                      <span className="ml-1.5 text-xs text-amber-700">locked</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap">
                    {currentVelo ?? <Dash />}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap">
                    {max30Velo ?? <Dash />}
                  </td>
                  <td className="px-3 py-2 text-center tabular-nums whitespace-nowrap">
                    {zrs ?? <Dash />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {locked ? (
                      assigned ? <CategoryBadge name={assigned} compact categories={categories} /> : <Dash />
                    ) : (
                      <select
                        aria-label={`Category for ${p.name}`}
                        value={assigned ?? ''}
                        disabled={assigningZwiftId === p.zwiftId}
                        onChange={e => {
                          const next = e.target.value;
                          if (!next) {
                            if (isManual) onRelease(p.zwiftId, p.name);
                            return;
                          }
                          if (next === assigned) return;
                          onAssign(p.zwiftId, next);
                        }}
                        className="border border-border rounded px-1.5 py-1 text-xs bg-background text-foreground max-w-[8.5rem] disabled:opacity-50"
                      >
                        <option value="">—</option>
                        {assigned && !categories.some(c => c.name === assigned) && (
                          <option value={assigned}>{assigned}</option>
                        )}
                        {categories.map(c => (
                          <option key={c.name} value={c.name}>{c.name}</option>
                        ))}
                      </select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-center border-l border-border">
                    {zwiftPred.catLow ? <CategoryBadge name={zwiftPred.catLow} compact categories={categories} /> : <Dash />}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {zwiftPred.catHigh ? <CategoryBadge name={zwiftPred.catHigh} compact categories={categories} /> : <Dash />}
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
                      <CategoryBadge name={stravaPred.catLow} compact categories={categories} />
                    ) : (
                      <Dash title={stravaEntry?.error} />
                    )}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {stravaLoading ? (
                      <span className="text-xs text-muted-foreground">…</span>
                    ) : stravaPred.catHigh ? (
                      <CategoryBadge name={stravaPred.catHigh} compact categories={categories} />
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
                        {categories.map(c => (
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
                  <td className="px-3 py-2 whitespace-nowrap">
                    {isManual && (
                      <button
                        type="button"
                        onClick={() => onRelease(p.zwiftId, p.name)}
                        disabled={releasingZwiftId === p.zwiftId}
                        className="px-2.5 py-1 text-xs rounded bg-violet-100 text-violet-800 hover:bg-violet-200 font-medium disabled:opacity-50"
                      >
                        {releasingZwiftId === p.zwiftId ? '…' : 'Release'}
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