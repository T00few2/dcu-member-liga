'use client';

import { useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useLigaCategoriesQuery } from '@/hooks/queries/useLigaCategoriesQuery';
import { useLeagueSettingsQuery } from '@/hooks/queries/useLeagueSettingsQuery';

import CategoryBoundaryEditor from './category-manager/CategoryBoundaryEditor';
import CategoryList from './category-manager/CategoryList';
import {
  ZR_CATEGORY_DEFAULTS,
  type CategoryDef,
  type RiderEntry,
  type FilterMode,
} from './category-manager/types';
import { getCatLower } from './category-manager/utils';

export default function CategoryManager() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const { data: riders = [], isFetching: ridersLoading, refetch: refetchRiders } = useLigaCategoriesQuery();
  const { data: leagueSettings } = useLeagueSettingsQuery();

  const [assigning, setAssigning] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  // Grace period — seeded from leagueSettings once available
  const [gracePeriod, setGracePeriod] = useState<number | null>(null);
  const effectiveGracePeriod = gracePeriod ?? (leagueSettings?.gracePeriod as number | undefined) ?? 35;

  // Category configuration state — seeded from leagueSettings once available
  const [ligaCategories, setLigaCategories] = useState<CategoryDef[] | null>(null);
  const [configDirty, setConfigDirty] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const effectiveLigaCategories: CategoryDef[] = ligaCategories ??
    (leagueSettings?.ligaCategories && Array.isArray(leagueSettings.ligaCategories) && leagueSettings.ligaCategories.length >= 2
      ? (leagueSettings.ligaCategories as CategoryDef[])
      : ZR_CATEGORY_DEFAULTS);

  // ── Category config operations ──────────────────────────────────────────

  function updateCatName(i: number, name: string) {
    const next = [...effectiveLigaCategories];
    next[i] = { ...next[i], name };
    setLigaCategories(next);
    setConfigDirty(true);
  }

  function updateCatUpper(i: number, raw: string) {
    const n = parseInt(raw, 10);
    if (isNaN(n) || n < 0) return;
    const next = [...effectiveLigaCategories];
    next[i] = { ...next[i], upper: n };
    setLigaCategories(next);
    setConfigDirty(true);
  }

  /** Split category i at the midpoint (or lower + 100 for unbounded top). */
  function splitCat(i: number) {
    const cat = effectiveLigaCategories[i];
    const lower = getCatLower(effectiveLigaCategories, i);
    const upper = cat.upper;
    const mid = upper !== null
      ? Math.floor((lower + upper) / 2)
      : lower + 100;
    const next = [...effectiveLigaCategories];
    next[i] = { name: `${cat.name} A`, upper: cat.upper };
    next.splice(i + 1, 0, { name: `${cat.name} B`, upper: mid });
    setLigaCategories(next);
    setConfigDirty(true);
  }

  /** Merge category i upward into the category above it (i-1). */
  function mergeCatUp(i: number) {
    if (i === 0 || effectiveLigaCategories.length <= 2) return;
    const next = [...effectiveLigaCategories];
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
        body: JSON.stringify({ categories: effectiveLigaCategories }),
      });
      const data = await res.json();
      if (res.ok) {
        setConfigDirty(false);
        queryClient.invalidateQueries({ queryKey: ['league', 'settings'] });
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
      `Assign liga categories based on effective vELO (max of current and 30-day max)?\n\nLimit buffer: ${effectiveGracePeriod} points\nCategories: ${effectiveLigaCategories.length} configured\n\nThis will overwrite existing assignments for all riders.`
    )) return;

    setAssigning(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/assign-liga-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ gracePeriod: effectiveGracePeriod, categories: effectiveLigaCategories }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Done! Assigned: ${data.assigned}, Skipped (no rating): ${data.skipped}`);
        queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
      } else {
        alert(`Error: ${data.message}`);
      }
    } finally {
      setAssigning(false);
    }
  };

  const handleReassign = useCallback(async (zwiftId: string, name: string) => {
    if (!user) return;
    if (!confirm(`Move ${name} up to the next category?\n\nThis resets their grace limit to the new category boundary + ${effectiveGracePeriod} points.`)) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${zwiftId}/reassign`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) alert(`Error: ${data.message}`);
      else queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
    } catch {
      alert('Failed to reassign rider');
    }
  }, [user, effectiveGracePeriod, queryClient]);

  // ── Derived stats ───────────────────────────────────────────────────────

  const assigned = riders.filter(r => r.ligaCategory);
  const overCount = assigned.filter(r => r.ligaCategory?.status === 'over').length;
  const graceCount = assigned.filter(r => r.ligaCategory?.status === 'grace').length;
  const okCount = assigned.filter(r => r.ligaCategory?.status === 'ok').length;
  const searchTerm = search.trim().toLowerCase();
  const statusFiltered = filter === 'all' ? riders : riders.filter(r => r.ligaCategory?.status === filter);
  const filtered = searchTerm
    ? statusFiltered.filter(r =>
        r.name.toLowerCase().includes(searchTerm) ||
        r.club.toLowerCase().includes(searchTerm) ||
        r.zwiftId.toLowerCase().includes(searchTerm)
      )
    : statusFiltered;

  const ridersWithRating = riders.filter(r => !isNaN(parseFloat(String(r.effectiveRating))));

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

        <CategoryBoundaryEditor
          categories={effectiveLigaCategories}
          riders={riders as RiderEntry[]}
          ridersWithRating={ridersWithRating as RiderEntry[]}
          onUpdateName={updateCatName}
          onUpdateUpper={updateCatUpper}
          onSplit={splitCat}
          onMergeUp={mergeCatUp}
        />

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
      <CategoryList
        riders={riders as RiderEntry[]}
        filtered={filtered as RiderEntry[]}
        ridersLoading={ridersLoading}
        filter={filter}
        search={search}
        gracePeriod={effectiveGracePeriod}
        assigned={assigned as RiderEntry[]}
        overCount={overCount}
        graceCount={graceCount}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onGracePeriodChange={n => setGracePeriod(n)}
        onRefresh={() => refetchRiders()}
        onReassign={handleReassign}
      />
    </div>
  );
}
