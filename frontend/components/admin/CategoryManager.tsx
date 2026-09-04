'use client';

import { useState, useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useLigaCategoriesQuery } from '@/hooks/queries/useLigaCategoriesQuery';
import { useLeagueSettingsQuery } from '@/hooks/queries/useLeagueSettingsQuery';
import { useRacesQuery, useRaceSignupsQuery } from '@/hooks/queries';
import { filterRidersBySignupIds } from '@/lib/raceSignupOptions';
import type { Race } from '@/types/live';
import RaceSignupSelect from '@/components/RaceSignupSelect';

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
  const racesQuery = useRacesQuery();
  const races = (racesQuery.data ?? []) as Race[];

  const [assigning, setAssigning] = useState(false);
  const [resettingAssignments, setResettingAssignments] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');
  const [raceFilter, setRaceFilter] = useState('');

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

  function toggleCatVerification(i: number, value: boolean) {
    const next = [...effectiveLigaCategories];
    next[i] = { ...next[i], requiresVerification: value };
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
    next[i] = {
      name: `${cat.name} A`,
      upper: cat.upper,
      requiresVerification: cat.requiresVerification === true,
    };
    next.splice(i + 1, 0, {
      name: `${cat.name} B`,
      upper: mid,
      requiresVerification: false,
    });
    setLigaCategories(next);
    setConfigDirty(true);
  }

  /** Merge category i upward into the category above it (i-1). */
  function mergeCatUp(i: number) {
    if (i === 0 || effectiveLigaCategories.length <= 2) return;
    const next = [...effectiveLigaCategories];
    const removed = next[i];
    next.splice(i, 1);
    // Keep verification if either merged row required it.
    if (removed?.requiresVerification) {
      next[i - 1] = { ...next[i - 1], requiresVerification: true };
    }
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

  const handleResetAssignments = async () => {
    if (!user) return;
    const confirmed = confirm(
      `Nulstil kategori-tildelinger for alle registrerede ryttere?\n\n` +
      `Dette sletter låsning, selvvalg og grace-status fra sidste sæson, ` +
      `og tildeler nye ulåste kategorier ud fra nuværende vELO.\n\n` +
      `Grace buffer: ${effectiveGracePeriod} points\n` +
      `Kategorier: ${effectiveLigaCategories.length}\n\n` +
      `Dette kan ikke fortrydes automatisk.`
    );
    if (!confirmed) return;
    const typed = window.prompt('Skriv RESET for at bekræfte:');
    if (typed !== 'RESET') {
      alert('Nulstilling annulleret.');
      return;
    }

    setResettingAssignments(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/reset-assignments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ gracePeriod: effectiveGracePeriod, categories: effectiveLigaCategories }),
      });
      const data = await res.json();
      if (res.ok) {
        alert(`Nulstillet: ${data.reset}, Sprunget over (ingen rating): ${data.skipped}`);
        queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch {
      alert('Failed to reset category assignments');
    } finally {
      setResettingAssignments(false);
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

  const handleReleaseManual = useCallback(async (zwiftId: string, name: string) => {
    if (!user) return;
    if (!confirm(`Release the manual category assignment for ${name}?\n\nNightly auto-assign from vELO will apply again.`)) return;
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${zwiftId}/release-manual`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) alert(`Error: ${data.message}`);
      else queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
    } catch {
      alert('Failed to release manual assignment');
    }
  }, [user, queryClient]);

  // ── Rider scope (all participants vs one race's signups) ────────────────

  const selectedRaceId =
    raceFilter && (racesQuery.isLoading || races.some(r => r.id === raceFilter)) ? raceFilter : '';
  const raceSignupsQuery = useRaceSignupsQuery(selectedRaceId || null);
  const signupZwiftIds = useMemo(() => {
    if (!selectedRaceId) return null;
    const ids = new Set<string>();
    for (const row of raceSignupsQuery.data ?? []) {
      if (row.zwiftId) ids.add(String(row.zwiftId));
    }
    return ids;
  }, [selectedRaceId, raceSignupsQuery.data]);

  const signupsLoading = Boolean(selectedRaceId) && raceSignupsQuery.isLoading;
  const scopedRiders = useMemo(
    () => (signupsLoading ? [] : filterRidersBySignupIds(riders, signupZwiftIds)),
    [riders, signupZwiftIds, signupsLoading],
  );
  const selectedRace = races.find(r => r.id === selectedRaceId);

  // ── Derived stats ───────────────────────────────────────────────────────

  const assigned = scopedRiders.filter(r => r.ligaCategory);
  const overCount = assigned.filter(r => r.ligaCategory?.status === 'over').length;
  const graceCount = assigned.filter(r => r.ligaCategory?.status === 'grace').length;
  const okCount = assigned.filter(r => r.ligaCategory?.status === 'ok').length;
  const manualCount = assigned.filter(r => r.ligaCategory?.manualAssignedCategory).length;
  const searchTerm = search.trim().toLowerCase();
  const statusFiltered = filter === 'all'
    ? scopedRiders
    : filter === 'manual'
    ? scopedRiders.filter(r => r.ligaCategory?.manualAssignedCategory)
    : scopedRiders.filter(r => r.ligaCategory?.status === filter);
  const filtered = searchTerm
    ? statusFiltered.filter(r =>
        r.name.toLowerCase().includes(searchTerm) ||
        r.club.toLowerCase().includes(searchTerm) ||
        r.zwiftId.toLowerCase().includes(searchTerm)
      )
    : statusFiltered;

  const ridersWithRating = scopedRiders.filter(r => !isNaN(parseFloat(String(r.effectiveRating))));
  const listLoading = ridersLoading || signupsLoading;

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <RaceSignupSelect
          races={races}
          value={selectedRaceId}
          onChange={setRaceFilter}
          label="Signed up for"
          allLabel="All participants"
        />
        <p className="text-sm text-muted-foreground">
          {signupsLoading
            ? 'Loading signups…'
            : selectedRaceId
            ? `${scopedRiders.length} signed up for ${selectedRace?.name || 'this race'}`
            : `${riders.length} registered participants`}
        </p>
      </div>

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
              disabled={assigning || resettingAssignments}
              className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium"
            >
              {assigning ? 'Assigning…' : 'Assign Liga Categories'}
            </button>
            <button
              onClick={handleResetAssignments}
              disabled={assigning || resettingAssignments}
              className="px-3 py-1.5 rounded text-sm bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50 font-medium border border-border"
              title="Clear lock, self-select, manual holds and grace; rebuild unlocked autoAssigned"
            >
              {resettingAssignments ? 'Nulstiller…' : 'Nulstil kategori-tildelinger'}
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mb-5">
          Define vELO split points and category names. Defaults to the 10 standard ZR categories.
          The distribution preview shows how effective ratings (max of current and 30-day max) map to these categories
          {selectedRaceId ? ' for the selected race signups' : ''}.
          Use <strong>Verification</strong> to include a category in weight verification sampling and dual-recording reports.
          Use <strong>Assign Liga Categories</strong> to apply this configuration to all riders based on effective vELO.
        </p>

        <CategoryBoundaryEditor
          categories={effectiveLigaCategories}
          riders={scopedRiders as RiderEntry[]}
          ridersWithRating={ridersWithRating as RiderEntry[]}
          onUpdateName={updateCatName}
          onUpdateUpper={updateCatUpper}
          onToggleVerification={toggleCatVerification}
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
        riders={scopedRiders as RiderEntry[]}
        filtered={filtered as RiderEntry[]}
        ridersLoading={listLoading}
        filter={filter}
        search={search}
        gracePeriod={effectiveGracePeriod}
        assigned={assigned as RiderEntry[]}
        overCount={overCount}
        graceCount={graceCount}
        manualCount={manualCount}
        onFilterChange={setFilter}
        onSearchChange={setSearch}
        onGracePeriodChange={n => setGracePeriod(n)}
        emptyMessage={
          selectedRaceId && scopedRiders.length === 0 && !listLoading
            ? 'No matching signups for this race.'
            : undefined
        }
        onRefresh={() => refetchRiders()}
        onReassign={handleReassign}
        onReleaseManual={handleReleaseManual}
      />
    </div>
  );
}
