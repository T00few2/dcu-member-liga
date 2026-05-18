'use client';

import type { RiderEntry, LigaCategory, FilterMode } from './types';
import { ZR_CATEGORY_STYLES } from './types';

interface CategoryListProps {
  riders: RiderEntry[];
  filtered: RiderEntry[];
  ridersLoading: boolean;
  filter: FilterMode;
  search: string;
  gracePeriod: number;
  assigned: RiderEntry[];
  overCount: number;
  graceCount: number;
  onFilterChange: (f: FilterMode) => void;
  onSearchChange: (s: string) => void;
  onGracePeriodChange: (n: number) => void;
  onRefresh: () => void;
  onReassign: (zwiftId: string, name: string) => void;
}

function statusBadge(status: string | undefined) {
  if (!status) return <span className="text-muted-foreground text-xs">–</span>;
  const styles: Record<string, string> = {
    ok:    'bg-green-100 text-green-800',
    grace: 'bg-yellow-100 text-yellow-800',
    over:  'bg-red-100 text-red-800',
  };
  const labels: Record<string, string> = { ok: 'OK', grace: 'Grace', over: 'Over limit' };
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status] ?? ''}`}>
      {labels[status] ?? status}
    </span>
  );
}

export default function CategoryList({
  riders,
  filtered,
  ridersLoading,
  filter,
  search,
  gracePeriod,
  assigned,
  overCount,
  graceCount,
  onFilterChange,
  onSearchChange,
  onGracePeriodChange,
  onRefresh,
  onReassign,
}: CategoryListProps) {
  return (
    <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
      <div className="px-4 py-3 border-b border-border flex flex-wrap items-center justify-between gap-3">
        <h3 className="font-semibold text-card-foreground">
          Rider Category Status
          {assigned.length > 0 && (
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({assigned.length} assigned / {riders.length} total)
            </span>
          )}
        </h3>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
            Limit buffer
            <input
              type="number"
              value={gracePeriod}
              min={0}
              onChange={e => onGracePeriodChange(parseInt(e.target.value) || 0)}
              className="w-16 px-2 py-1 border border-input rounded bg-background text-foreground text-sm text-right"
            />
            <span className="text-xs">pts</span>
          </label>
          <input
            type="text"
            value={search}
            onChange={e => onSearchChange(e.target.value)}
            placeholder="Search rider, club, or Zwift ID"
            className="w-64 max-w-full px-3 py-1 border border-input rounded bg-background text-foreground text-sm"
          />
          <div className="flex gap-2 flex-wrap">
            {(['all', 'grace', 'over'] as FilterMode[]).map(f => (
              <button
                key={f}
                onClick={() => onFilterChange(f)}
                className={`px-3 py-1 rounded text-sm font-medium transition ${
                  filter === f
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? `All (${riders.length})` : f === 'grace' ? `Grace (${graceCount})` : `Over limit (${overCount})`}
              </button>
            ))}
            <button
              onClick={onRefresh}
              className="px-3 py-1 rounded text-sm bg-muted text-muted-foreground hover:text-foreground"
            >
              Refresh
            </button>
          </div>
        </div>
      </div>

      {ridersLoading ? (
        <div className="p-8 text-center text-muted-foreground">Loading…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="px-4 py-3">Rider</th>
                <th className="px-4 py-3">Category</th>
                <th className="px-4 py-3 text-right">Rating at Assignment</th>
                <th className="px-4 py-3 text-right">Upper Boundary</th>
                <th className="px-4 py-3 text-right">Grace Limit</th>
                <th className="px-4 py-3 text-right">Effective vELO</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                    {riders.length === 0
                      ? 'No categories assigned yet. Run assignment first.'
                      : 'No riders match the current filter/search.'}
                  </td>
                </tr>
              ) : (
                filtered.map(r => {
                  const lc: LigaCategory | null = r.ligaCategory;
                  const isOver = lc?.status === 'over';
                  const isGrace = lc?.status === 'grace';
                  return (
                    <tr
                      key={r.zwiftId}
                      className={`hover:bg-muted/50 transition ${
                        isOver
                          ? 'bg-red-50 dark:bg-red-950/20'
                          : isGrace
                          ? 'bg-yellow-50 dark:bg-yellow-950/20'
                          : ''
                      }`}
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-card-foreground">{r.name}</div>
                        <div className="text-xs text-muted-foreground">{r.club}</div>
                      </td>
                      <td className="px-4 py-3">
                        {lc ? (
                          <div className="space-y-1">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ZR_CATEGORY_STYLES[lc.category] ?? 'bg-slate-100 text-slate-800'}`}>
                                {lc.category}
                              </span>
                              {lc.locked && (
                                <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs bg-amber-100 text-amber-700">
                                  🔒 Locked
                                </span>
                              )}
                              {lc.selfSelectedCategory && lc.selfSelectedCategory === lc.category && lc.selfSelectedCategory !== lc.autoAssignedCategory && (
                                <span className="text-xs text-muted-foreground">(selvvalgt)</span>
                              )}
                            </div>
                            {lc.autoAssignedCategory && lc.autoAssignedCategory !== lc.category && (
                              <div className="text-xs text-muted-foreground">
                                Auto: {lc.autoAssignedCategory}
                              </div>
                            )}
                          </div>
                        ) : (
                          <span className="text-muted-foreground text-xs">Not assigned</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {lc?.assignedRating ?? '–'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {lc?.upperBoundary != null ? lc.upperBoundary : '∞'}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-muted-foreground">
                        {lc?.graceLimit != null ? lc.graceLimit : '∞'}
                      </td>
                      <td className={`px-4 py-3 text-right font-mono font-semibold ${
                        isOver ? 'text-red-600' : isGrace ? 'text-yellow-600' : 'text-card-foreground'
                      }`}>
                        {r.effectiveRating !== 'N/A' ? Math.round(Number(r.effectiveRating)) : '–'}
                      </td>
                      <td className="px-4 py-3">
                        {statusBadge(lc?.status)}
                      </td>
                      <td className="px-4 py-3">
                        {isOver && (
                          <button
                            onClick={() => onReassign(r.zwiftId, r.name)}
                            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 font-medium"
                          >
                            Move up
                          </button>
                        )}
                        {isGrace && (
                          <button
                            onClick={() => onReassign(r.zwiftId, r.name)}
                            className="px-3 py-1 text-xs bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200 font-medium"
                          >
                            Move up early
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
