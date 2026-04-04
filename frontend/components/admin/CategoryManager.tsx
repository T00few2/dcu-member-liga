'use client';

import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

// ---------------------------------------------------------------------------
// Category style map (for badge colours in the rider table)
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

// ---------------------------------------------------------------------------
// Default 10 ZR categories in API format [{name, upper}]
// ---------------------------------------------------------------------------
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface CategoryDef {
  name: string;
  upper: number | null; // null = no upper limit (top category, must be first)
}

interface LigaCategory {
  category: string;
  upperBoundary: number | null;
  graceLimit: number | null;
  assignedRating: number;
  status: 'ok' | 'grace' | 'over';
  lastCheckedRating: number;
  lastCheckedAt?: number;
  assignedAt?: number;
  locked?: boolean;
  autoAssignedCategory?: string;
  selfSelectedCategory?: string;
}

interface RiderEntry {
  zwiftId: string;
  name: string;
  club: string;
  currentRating: number | string;
  max30Rating: number | string;
  max90Rating: number | string;
  effectiveRating: number | string;
  ligaCategory: LigaCategory | null;
}

interface CategoryManagerProps {
  user: User | null;
}

type FilterMode = 'all' | 'grace' | 'over';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Lower bound of category at index i (derived from next entry's upper, or 0). */
function getCatLower(cats: CategoryDef[], i: number): number {
  if (i + 1 >= cats.length) return 0;
  return cats[i + 1].upper ?? 0;
}

/** Count riders whose effective rating falls within [lower, upper). */
function countInRange(riders: RiderEntry[], lower: number, upper: number | null): number {
  return riders.filter(r => {
    const effective = parseFloat(String(r.effectiveRating));
    if (isNaN(effective)) return false;
    if (effective < lower) return false;
    if (upper !== null && effective >= upper) return false;
    return true;
  }).length;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function CategoryManager({ user }: CategoryManagerProps) {
  const [riders, setRiders] = useState<RiderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [gracePeriod, setGracePeriod] = useState(35);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Category configuration state
  const [ligaCategories, setLigaCategories] = useState<CategoryDef[]>(ZR_CATEGORY_DEFAULTS);
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  // Load league settings (season, gracePeriod, ligaCategories)
  useEffect(() => {
    if (!user || settingsLoaded) return;
    const load = async () => {
      try {
        const token = await user.getIdToken();
        const res = await fetch(`${API_URL}/league/settings`, {
          headers: { 'Authorization': `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          const s = data.settings || {};
          if (s.gracePeriod) setGracePeriod(s.gracePeriod);
          if (s.ligaCategories && Array.isArray(s.ligaCategories) && s.ligaCategories.length >= 2) {
            setLigaCategories(s.ligaCategories);
          }
        }
      } catch { /* non-fatal */ }
      setSettingsLoaded(true);
    };
    load();
  }, [user, settingsLoaded]);

  const loadRiders = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories`, {
        headers: { 'Authorization': `Bearer ${token}` },
      });
      if (res.ok) {
        const data = await res.json();
        setRiders(data.riders || []);
      }
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => { loadRiders(); }, [loadRiders]);

  // ── Category config operations ──────────────────────────────────────────

  function updateCatName(i: number, name: string) {
    const next = [...ligaCategories];
    next[i] = { ...next[i], name };
    setLigaCategories(next);
    setConfigDirty(true);
  }

  function updateCatUpper(i: number, raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return;
    const next = [...ligaCategories];
    next[i] = { ...next[i], upper: n };
    setLigaCategories(next);
    setConfigDirty(true);
  }

  /** Split category i at the midpoint (or lower + 100 for unbounded top). */
  function splitCat(i: number) {
    const cat = ligaCategories[i];
    const lower = getCatLower(ligaCategories, i);
    const upper = cat.upper;
    const mid = upper !== null
      ? Math.floor((lower + upper) / 2)
      : lower + 100;
    const next = [...ligaCategories];
    next[i] = { name: `${cat.name} A`, upper: cat.upper };
    next.splice(i + 1, 0, { name: `${cat.name} B`, upper: mid });
    setLigaCategories(next);
    setConfigDirty(true);
  }

  /** Merge category i upward into the category above it (i-1). */
  function mergeCatUp(i: number) {
    if (i === 0 || ligaCategories.length <= 2) return;
    const next = [...ligaCategories];
    next.splice(i, 1);
    setLigaCategories(next);
    setConfigDirty(true);
  }

  const handleSaveConfig = async () => {
    if (!user) return;
    setConfigSaving(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ categories: ligaCategories }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfigDirty(false);
        alert(`Configuration saved (${data.count} categories).`);
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch {
      alert('Failed to save configuration');
    } finally {
      setConfigSaving(false);
    }
  };

  // ── Assignment ──────────────────────────────────────────────────────────

  const handleAssign = async () => {
    if (!user) return;
    if (!confirm(
      `Assign liga categories based on effective vELO (max of current and 30-day max)?\n\nLimit buffer: ${gracePeriod} points\nCategories: ${ligaCategories.length} configured\n\nThis will overwrite existing assignments for all riders.`
    )) return;

    setAssigning(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/assign-liga-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ gracePeriod, categories: ligaCategories }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Done! Assigned: ${data.assigned}, Skipped (no rating): ${data.skipped}`);
        await loadRiders();
      } else {
        alert(`Error: ${data.message}`);
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleReassign = async (zwiftId: string, name: string) => {
    if (!user) return;
    if (!confirm(`Move ${name} up to the next category?\n\nThis resets their grace limit to the new category boundary + ${gracePeriod} points.`)) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${zwiftId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) alert(`Error: ${data.message}`);
      else await loadRiders();
    } catch {
      alert('Failed to reassign rider');
    }
  };

  // ── Derived stats ───────────────────────────────────────────────────────

  const assigned = riders.filter(r => r.ligaCategory);
  const overCount = assigned.filter(r => r.ligaCategory?.status === 'over').length;
  const graceCount = assigned.filter(r => r.ligaCategory?.status === 'grace').length;
  const okCount = assigned.filter(r => r.ligaCategory?.status === 'ok').length;
  const filtered = filter === 'all' ? riders : riders.filter(r => r.ligaCategory?.status === filter);

  const ridersWithRating = riders.filter(r => !isNaN(parseFloat(String(r.effectiveRating))));
  const maxInAnyBucket = Math.max(
    1,
    ...ligaCategories.map((_, i) =>
      countInRange(riders, getCatLower(ligaCategories, i), ligaCategories[i].upper)
    )
  );

  // ── Status badge helper ─────────────────────────────────────────────────

  const statusBadge = (status: string | undefined) => {
    if (!status) return <span className="text-muted-foreground text-xs">–</span>;
    const styles = {
      ok: 'bg-green-100 text-green-800',
      grace: 'bg-yellow-100 text-yellow-800',
      over: 'bg-red-100 text-red-800',
    } as Record<string, string>;
    const labels: Record<string, string> = { ok: 'OK', grace: 'Grace', over: 'Over limit' };
    return (
      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${styles[status] ?? ''}`}>
        {labels[status] ?? status}
      </span>
    );
  };

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      {/* ── Category Configuration ── */}
      <div className="bg-card p-6 rounded-lg shadow border border-border">
        <div className="flex items-start justify-between gap-4 flex-wrap mb-1">
          <h2 className="text-xl font-semibold text-card-foreground">Category Configuration</h2>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => { setLigaCategories(ZR_CATEGORY_DEFAULTS); setConfigDirty(true); }}
              className="px-3 py-1.5 rounded text-sm bg-muted text-muted-foreground hover:text-foreground border border-border"
            >
              Load ZR Defaults
            </button>
            <button
              onClick={handleSaveConfig}
              disabled={!configDirty || configSaving}
              className="px-3 py-1.5 rounded text-sm bg-secondary text-secondary-foreground hover:opacity-90 disabled:opacity-50 font-medium border border-border"
            >
              {configSaving ? 'Saving…' : 'Save Configuration'}
            </button>
            <button
              onClick={handleAssign}
              disabled={assigning}
              className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium"
            >
              {assigning ? 'Assigning…' : 'Assign Liga Categories'}
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Define vELO split points and category names. Defaults to the 10 standard ZR categories.
          The distribution preview shows how effective ratings (max of current and 30-day max) map to these categories.
          Use <strong>Assign Liga Categories</strong> to apply this configuration to all riders based on effective vELO.
        </p>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-muted-foreground border-b border-border">
              <tr>
                <th className="pb-2 text-left pr-3">Name</th>
                <th className="pb-2 text-left pr-3">vELO range</th>
                <th className="pb-2 text-right pr-3 w-28">Upper boundary</th>
                <th className="pb-2 text-left">Riders ({ridersWithRating.length} with rating)</th>
                <th className="pb-2 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {ligaCategories.map((cat, i) => {
                const lower = getCatLower(ligaCategories, i);
                const upper = cat.upper;
                const count = countInRange(riders, lower, upper);
                const pct = ridersWithRating.length > 0 ? Math.round((count / ridersWithRating.length) * 100) : 0;
                const barW = Math.round((count / maxInAnyBucket) * 100);
                const isTop = i === 0;
                const canSplit = upper === null ? true : (upper - lower) >= 2;
                const canMergeUp = i > 0 && ligaCategories.length > 2;

                return (
                  <tr key={i} className="hover:bg-muted/30">
                    <td className="py-2 pr-3">
                      <input
                        type="text"
                        value={cat.name}
                        onChange={e => updateCatName(i, e.target.value)}
                        className="w-28 px-2 py-1 border border-input rounded bg-background text-foreground text-sm"
                      />
                    </td>
                    <td className="py-2 pr-3 font-mono text-xs text-muted-foreground whitespace-nowrap">
                      {lower} – {upper != null ? upper - 1 : '∞'}
                    </td>
                    <td className="py-2 pr-3 text-right">
                      {isTop ? (
                        <span className="text-xs text-muted-foreground">∞ (top)</span>
                      ) : (
                        <input
                          type="number"
                          value={upper ?? ''}
                          min={lower + 1}
                          onChange={e => updateCatUpper(i, e.target.value)}
                          className="w-24 px-2 py-1 border border-input rounded bg-background text-foreground text-sm text-right"
                        />
                      )}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-muted rounded-full h-2 overflow-hidden flex-shrink-0">
                          <div
                            className="h-2 bg-primary rounded-full"
                            style={{ width: `${barW}%` }}
                          />
                        </div>
                        <span className="text-xs text-muted-foreground whitespace-nowrap">
                          {count} ({pct}%)
                        </span>
                      </div>
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex gap-1 justify-end">
                        {canSplit && (
                          <button
                            onClick={() => splitCat(i)}
                            className="px-2 py-1 text-xs rounded bg-muted text-muted-foreground hover:text-foreground border border-border"
                            title="Split this category at the midpoint"
                          >
                            Split
                          </button>
                        )}
                        {canMergeUp && (
                          <button
                            onClick={() => mergeCatUp(i)}
                            className="px-2 py-1 text-xs rounded bg-muted text-muted-foreground hover:text-foreground border border-border"
                            title={`Merge ${cat.name} into ${ligaCategories[i - 1].name}`}
                          >
                            Merge ↑
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <p className="text-xs text-muted-foreground mt-3">
          <strong>Split</strong> divides a category at its midpoint. <strong>Merge ↑</strong> absorbs a category into the one above it.
          Edit names freely; boundaries are derived from upper values. Categories are locked to a rider after their first race.
        </p>
      </div>

      {/* ── Status Summary ── */}
      {assigned.length > 0 && (
        <div className="grid grid-cols-3 gap-4">
          <div className="bg-card p-4 rounded-lg border border-green-200 text-center">
            <div className="text-3xl font-bold text-card-foreground">{okCount}</div>
            <div className="text-sm text-green-600 font-medium mt-1">Within limit</div>
          </div>
          <div className="bg-card p-4 rounded-lg border border-yellow-300 text-center">
            <div className="text-3xl font-bold text-card-foreground">{graceCount}</div>
            <div className="text-sm text-yellow-600 font-medium mt-1">In grace zone</div>
          </div>
          <div className="bg-card p-4 rounded-lg border border-red-300 text-center">
            <div className="text-3xl font-bold text-card-foreground">{overCount}</div>
            <div className="text-sm text-red-600 font-medium mt-1">Over limit — action needed</div>
          </div>
        </div>
      )}

      {/* ── Rider Table ── */}
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
                onChange={e => setGracePeriod(parseInt(e.target.value) || 0)}
                className="w-16 px-2 py-1 border border-input rounded bg-background text-foreground text-sm text-right"
              />
              <span className="text-xs">pts</span>
            </label>
            <div className="flex gap-2 flex-wrap">
              {(['all', 'grace', 'over'] as FilterMode[]).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
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
                onClick={loadRiders}
                className="px-3 py-1 rounded text-sm bg-muted text-muted-foreground hover:text-foreground"
              >
                Refresh
              </button>
            </div>
          </div>
        </div>

        {loading ? (
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
                        : 'No riders match this filter.'}
                    </td>
                  </tr>
                ) : (
                  filtered.map(r => {
                    const lc = r.ligaCategory;
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
                              onClick={() => handleReassign(r.zwiftId, r.name)}
                              className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 font-medium"
                            >
                              Move up
                            </button>
                          )}
                          {isGrace && (
                            <button
                              onClick={() => handleReassign(r.zwiftId, r.name)}
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
    </div>
  );
}
