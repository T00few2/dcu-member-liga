'use client';

import { useState } from 'react';
import {
  useAddStreamRiderMutation,
  useRemoveStreamRiderMutation,
  useStreamRidersQuery,
} from '@/hooks/queries/useStreamRidersQuery';

interface StreamRidersPanelProps {
  raceId: string;
  raceName?: string;
  categoryOptions: string[];
}

export default function StreamRidersPanel({
  raceId,
  raceName,
  categoryOptions,
}: StreamRidersPanelProps) {
  const defaultCat = categoryOptions[0] || '';
  const [category, setCategory] = useState(defaultCat);
  const [zwiftId, setZwiftId] = useState('');
  const [publicId, setPublicId] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: riders = [], isFetching } = useStreamRidersQuery(raceId);
  const addMutation = useAddStreamRiderMutation(raceId);
  const removeMutation = useRemoveStreamRiderMutation(raceId);

  const effectiveCategory = categoryOptions.includes(category) ? category : defaultCat;

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const zid = zwiftId.trim();
    const pid = publicId.trim();
    if (!zid) {
      setError('Zwift ID is required');
      return;
    }
    try {
      await addMutation.mutateAsync({
        zwiftId: zid,
        publicId: pid || undefined,
        category: effectiveCategory || undefined,
      });
      setZwiftId('');
      setPublicId('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign up failed');
    }
  }

  async function handleRemove(id: string) {
    setError(null);
    try {
      await removeMutation.mutateAsync(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign off failed');
    }
  }

  return (
    <div className="bg-card p-6 rounded-lg shadow border border-border">
      <h2 className="text-xl font-semibold text-card-foreground mb-1">Stream riders</h2>
      <p className="text-sm text-muted-foreground mb-4">
        Register Zwift-only accounts onto a category pen for {raceName || 'this race'}.
        They stay off liga signups and are hidden on /live-race.
      </p>

      <form onSubmit={handleAdd} className="flex flex-wrap items-end gap-2 mb-4">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Category
          <select
            value={effectiveCategory}
            onChange={e => setCategory(e.target.value)}
            className="px-2 py-1.5 border border-input rounded bg-background text-foreground text-sm min-w-[10rem]"
          >
            {categoryOptions.map(name => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Zwift ID
          <input
            value={zwiftId}
            onChange={e => setZwiftId(e.target.value)}
            placeholder="numeric or UUID"
            className="px-2 py-1.5 border border-input rounded bg-background text-foreground text-sm w-44"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Public UUID
          <input
            value={publicId}
            onChange={e => setPublicId(e.target.value)}
            placeholder="required unless ID is a UUID"
            className="px-2 py-1.5 border border-input rounded bg-background text-foreground text-sm w-72"
          />
        </label>
        <button
          type="submit"
          disabled={addMutation.isPending || !effectiveCategory}
          className="px-3 py-1.5 rounded text-sm bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 font-medium"
        >
          {addMutation.isPending ? 'Signing up…' : 'Sign up'}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-3">{error}</p>}

      {isFetching && riders.length === 0 ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : riders.length === 0 ? (
        <p className="text-sm text-muted-foreground">No stream riders on this race.</p>
      ) : (
        <table className="w-full text-sm">
          <thead className="text-xs uppercase text-muted-foreground border-b border-border">
            <tr>
              <th className="py-2 text-left">Zwift ID</th>
              <th className="py-2 text-left">Category</th>
              <th className="py-2 text-left">Status</th>
              <th className="py-2 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {riders.map(r => (
              <tr key={r.zwiftId}>
                <td className="py-2 font-mono text-xs">
                  {r.zwiftId}
                  {r.publicId && r.publicId !== r.zwiftId && (
                    <div className="text-muted-foreground">{r.publicId}</div>
                  )}
                </td>
                <td className="py-2">{r.category || '–'}</td>
                <td className="py-2">
                  {r.status || '–'}
                  {r.lastError ? (
                    <div className="text-xs text-red-600">{r.lastError}</div>
                  ) : null}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    onClick={() => { void handleRemove(r.zwiftId); }}
                    disabled={removeMutation.isPending}
                    className="px-2 py-1 text-xs rounded bg-destructive text-destructive-foreground hover:opacity-90 disabled:opacity-50"
                  >
                    Sign off
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
