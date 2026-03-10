'use client';

import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

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

interface LigaCategory {
  season: string;
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
  eLicense: string;
  club: string;
  max30Rating: number | string;
  ligaCategory: LigaCategory | null;
}

interface CategoryManagerProps {
  user: User | null;
}

type FilterMode = 'all' | 'grace' | 'over';

export default function CategoryManager({ user }: CategoryManagerProps) {
  const [riders, setRiders] = useState<RiderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [season, setSeason] = useState('');
  const [gracePeriod, setGracePeriod] = useState(35);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  // Load league settings to pre-fill season + gracePeriod
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
          if (s.seasonStart) setSeason(s.seasonStart);
          if (s.gracePeriod) setGracePeriod(s.gracePeriod);
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

  const handleAssign = async () => {
    if (!user || !season) return;
    if (!confirm(
      `Assign liga categories based on current max30 vELO?\n\nSeason start: ${season}\nGrace period: ${gracePeriod} points\n\nThis will overwrite existing assignments for all riders.`
    )) return;

    setAssigning(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/assign-liga-categories`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ season, gracePeriod }),
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
      if (res.ok) {
        await loadRiders();
      } else {
        alert(`Error: ${data.message}`);
      }
    } catch {
      alert('Failed to reassign rider');
    }
  };

  const assigned = riders.filter(r => r.ligaCategory);
  const overCount = assigned.filter(r => r.ligaCategory?.status === 'over').length;
  const graceCount = assigned.filter(r => r.ligaCategory?.status === 'grace').length;
  const okCount = assigned.filter(r => r.ligaCategory?.status === 'ok').length;

  const filtered = filter === 'all' ? riders : riders.filter(r => r.ligaCategory?.status === filter);

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

  return (
    <div className="space-y-6">
      {/* Settings Panel */}
      <div className="bg-card p-6 rounded-lg shadow border border-border">
        <h2 className="text-xl font-semibold mb-1 text-card-foreground">Season Category Assignment</h2>
        <p className="text-sm text-muted-foreground mb-5">
          Assigns each rider a liga category based on their current max30 vELO. Run once at season start.
          The nightly ZR refresh then updates each rider's full category automatically until their first race,
          after which only grace-period status is updated and the category is locked.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">Season Start Date</label>
            <input
              type="date"
              value={season}
              onChange={e => setSeason(e.target.value)}
              className="w-full p-2 border border-input rounded bg-background text-foreground"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-muted-foreground mb-1">
              Grace Period (points above limit)
            </label>
            <input
              type="number"
              value={gracePeriod}
              min={0}
              onChange={e => setGracePeriod(parseInt(e.target.value) || 35)}
              className="w-28 p-2 border border-input rounded bg-background text-foreground"
            />
          </div>
          <button
            onClick={handleAssign}
            disabled={assigning || !season}
            className="bg-primary text-primary-foreground px-4 py-2 rounded hover:opacity-90 font-medium disabled:opacity-50"
          >
            {assigning ? 'Assigning...' : 'Assign Liga Categories'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground mt-3">
          Upper boundary + {gracePeriod} pts = grace limit. Exceeding the grace limit flags the rider as "Over limit".
        </p>
      </div>

      {/* Status Summary */}
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

      {/* Rider Table */}
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

        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
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
                  <th className="px-4 py-3 text-right">Current max30</th>
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
                          <div className="text-xs text-muted-foreground">{r.club || r.eLicense}</div>
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
                          {r.max30Rating !== 'N/A' ? Math.round(Number(r.max30Rating)) : '–'}
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
