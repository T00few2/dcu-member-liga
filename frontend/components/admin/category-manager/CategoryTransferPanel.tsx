'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';

import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { RiderEntry } from './types';

type CreditRow = {
  raceId: string;
  raceName: string;
  fromCategory?: string;
  destinationFinishers: number;
  assignedPlace: number;
  leaguePoints: number;
  seasonPoints: number;
  countsNow: boolean;
};

type SkipRow = { raceId: string; raceName: string; reason: string };

type SignupRow = {
  raceId: string;
  raceName: string;
  fromSubgroupId?: string;
  toSubgroupId?: string;
  status?: string;
};

type StandingSide = { rank: number | null; points: number };

type Preview = {
  dryRun?: boolean;
  applied?: boolean;
  message?: string;
  transferId?: string;
  fromCategory?: string;
  toCategory?: string;
  races?: CreditRow[];
  skipped?: SkipRow[];
  signups?: SignupRow[];
  penErrors?: string[];
  standings?: {
    fromCategory?: { category?: string; before?: StandingSide; after?: StandingSide };
    toCategory?: { category?: string; before?: StandingSide; after?: StandingSide };
  };
};

type TransferRow = {
  id: string;
  zwiftId: string;
  name: string;
  fromCategory: string;
  toCategory: string;
  status: string;
  createdAtIso?: string;
  penErrors?: string[];
};

type Props = {
  riders: RiderEntry[];
  categories: string[];
};

function standingText(side?: StandingSide): string {
  if (!side || side.rank == null) return 'not listed';
  return `#${side.rank} · ${side.points} pts`;
}

export default function CategoryTransferPanel({ riders, categories }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [zwiftId, setZwiftId] = useState('');
  const [toCategory, setToCategory] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [busy, setBusy] = useState(false);
  const [undoPreview, setUndoPreview] = useState<Preview | null>(null);
  const [undoId, setUndoId] = useState<string | null>(null);

  const historyQuery = useQuery({
    queryKey: ['admin', 'category-transfers'],
    enabled: !!user,
    queryFn: async () => {
      const token = await user!.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/transfers`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('Failed to load category moves');
      const data = await res.json();
      return (data.transfers ?? []) as TransferRow[];
    },
  });

  const rider = riders.find((item) => item.zwiftId === zwiftId);
  const fromCategory = rider?.ligaCategory?.category || '';

  useEffect(() => {
    setPreview(null);
  }, [zwiftId, toCategory]);

  async function postMove(dryRun: boolean) {
    if (!user || !zwiftId || !toCategory) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/${zwiftId}/transfer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ toCategory, dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || 'Category move failed');
        return;
      }
      setPreview(data as Preview);
      if (!dryRun) {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
        await queryClient.invalidateQueries({ queryKey: ['admin', 'category-transfers'] });
        await queryClient.invalidateQueries({ queryKey: ['races'] });
        await queryClient.invalidateQueries({ queryKey: ['league-standings'] });
      }
    } catch {
      alert('Category move failed');
    } finally {
      setBusy(false);
    }
  }

  async function postUndo(id: string, dryRun: boolean) {
    if (!user) return;
    setBusy(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/liga-categories/transfers/${id}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ dryRun }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.message || 'Undo failed');
        return;
      }
      setUndoId(id);
      setUndoPreview(data as Preview);
      if (!dryRun) {
        await queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
        await queryClient.invalidateQueries({ queryKey: ['admin', 'category-transfers'] });
        await queryClient.invalidateQueries({ queryKey: ['races'] });
        await queryClient.invalidateQueries({ queryKey: ['league-standings'] });
      }
    } catch {
      alert('Undo failed');
    } finally {
      setBusy(false);
    }
  }

  const previewReady = preview?.dryRun === true
    && preview.fromCategory === fromCategory
    && preview.toCategory === toCategory;

  return (
    <div className="bg-card p-6 rounded-lg shadow border border-border space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-card-foreground">Move rider</h2>
        <p className="text-sm text-muted-foreground mt-1">
          Finished races stay in the division where they were ridden. The division they join gets a last-place credit for every race they have actually finished. Run a dry run before applying.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3">
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">Rider</span>
          <select
            value={zwiftId}
            onChange={(event) => setZwiftId(event.target.value)}
            className="w-full border border-border rounded px-2 py-1.5 bg-background"
          >
            <option value="">Select rider</option>
            {riders.map((item) => (
              <option key={item.zwiftId} value={item.zwiftId}>
                {item.name} ({item.ligaCategory?.category || 'no category'})
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="block text-muted-foreground mb-1">New division</span>
          <select
            value={toCategory}
            onChange={(event) => setToCategory(event.target.value)}
            className="w-full border border-border rounded px-2 py-1.5 bg-background"
          >
            <option value="">Select division</option>
            {categories.filter((name) => name !== fromCategory).map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          disabled={busy || !zwiftId || !toCategory}
          onClick={() => void postMove(true)}
          className="px-3 py-1.5 rounded text-sm border border-border bg-muted hover:text-foreground disabled:opacity-50"
        >
          Dry run
        </button>
        <button
          type="button"
          disabled={busy || !previewReady}
          onClick={() => void postMove(false)}
          className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground disabled:opacity-50"
        >
          Apply move
        </button>
      </div>

      {preview && <PreviewBlock preview={preview} />}

      <div>
        <h3 className="font-medium text-card-foreground">History</h3>
        {historyQuery.isLoading && <p className="text-sm text-muted-foreground">Loading moves…</p>}
        {historyQuery.isError && <p className="text-sm text-red-600">Could not load moves.</p>}
        <ul className="mt-2 space-y-2">
          {(historyQuery.data ?? []).map((item) => (
            <li key={item.id} className="border border-border rounded p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span>
                  <strong>{item.name}</strong> {item.fromCategory} → {item.toCategory}
                  <span className="text-muted-foreground"> · {item.status}</span>
                </span>
                {item.status === 'applied' && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void postUndo(item.id, true)}
                    className="px-2 py-1 rounded border border-border text-xs"
                  >
                    Dry run undo
                  </button>
                )}
              </div>
              {item.penErrors && item.penErrors.length > 0 && (
                <p className="text-xs text-amber-700 mt-1">{item.penErrors.join(' ')}</p>
              )}
              {undoId === item.id && undoPreview && (
                <div className="mt-2 space-y-2">
                  <PreviewBlock preview={undoPreview} />
                  {undoPreview.dryRun && (
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => void postUndo(item.id, false)}
                      className="px-2 py-1 rounded bg-primary text-primary-foreground text-xs"
                    >
                      Undo this move
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
          {historyQuery.data && historyQuery.data.length === 0 && (
            <li className="text-sm text-muted-foreground">No moves yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

function PreviewBlock({ preview }: { preview: Preview }) {
  const from = preview.standings?.fromCategory;
  const to = preview.standings?.toCategory;
  return (
    <div className="text-sm space-y-2 border border-border rounded p-3 bg-muted/30">
      <p>{preview.message}</p>
      {from && to && (
        <p>
          {from.category}: {standingText(from.before)} → {standingText(from.after)}. {to.category}: {standingText(to.before)} → {standingText(to.after)}.
        </p>
      )}
      {preview.races && preview.races.length > 0 && (
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">Race</th>
              <th>Place</th>
              <th>Season pts</th>
              <th>Counts now</th>
            </tr>
          </thead>
          <tbody>
            {preview.races.map((race) => (
              <tr key={race.raceId}>
                <td className="py-1">{race.raceName}</td>
                <td>{race.assignedPlace}</td>
                <td>{race.seasonPoints}</td>
                <td>{race.countsNow ? 'yes' : 'when finalized'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {preview.skipped && preview.skipped.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Skipped: {preview.skipped.map((row) => `${row.raceName} (${row.reason})`).join(', ')}
        </p>
      )}
      {preview.signups && preview.signups.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Upcoming pens: {preview.signups.map((row) => `${row.raceName} ${row.fromSubgroupId || '—'} → ${row.toSubgroupId || 'resolved on apply'}`).join('; ')}
        </p>
      )}
      {preview.penErrors && preview.penErrors.length > 0 && (
        <p className="text-xs text-amber-700">{preview.penErrors.join(' ')}</p>
      )}
    </div>
  );
}
