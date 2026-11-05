'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

export type ReviewReason = 'no_velo' | 'no_max30' | 'few_rides' | 'no_division';

export interface ReviewFilter {
  newSignupsDays: number | null;
  onlyUnlocked: boolean;
  onlyWithStrava: boolean;
  skipAdminPlaced: boolean;
  reasons: ReviewReason[];
}

interface FilterPreview {
  total: number;
  inGroup: number;
  matching: number;
  byReason: Record<ReviewReason, number>;
  pendingOutside: number;
}

export const DEFAULT_FILTER: ReviewFilter = {
  newSignupsDays: null,
  onlyUnlocked: false,
  onlyWithStrava: false,
  skipAdminPlaced: false,
  reasons: ['no_velo', 'no_max30', 'few_rides'],
};

const REASONS: { key: ReviewReason; label: string }[] = [
  { key: 'no_velo', label: 'No vELO (missing or 0)' },
  { key: 'no_max30', label: 'No max30 vELO (missing or 0)' },
  { key: 'few_rides', label: 'Few Zwift rides' },
  { key: 'no_division', label: 'No division yet' },
];

async function authed(user: User, path: string, init?: RequestInit) {
  const token = await user.getIdToken();
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data;
}

/** Waits until the value has been stable for `ms`, so typing a number does not fire a request per key. */
function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Which riders the agent checks: limits narrow the group, any ticked reason selects a rider in it. */
export default function ReviewFilterPanel({
  user, saved, savedMinRides,
}: {
  user: User | null;
  saved?: ReviewFilter;
  savedMinRides?: number;
}) {
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState<ReviewFilter>(saved ?? DEFAULT_FILTER);
  const [minRides, setMinRides] = useState<number>(savedMinRides ?? 15);
  const [days, setDays] = useState<string>(String(saved?.newSignupsDays ?? 30));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  // Show the saved filter once the status has loaded (and after another admin changes it).
  const savedKey = JSON.stringify([saved, savedMinRides]);
  useEffect(() => {
    if (saved) {
      setFilter(saved);
      if (saved.newSignupsDays) setDays(String(saved.newSignupsDays));
    }
    if (savedMinRides) setMinRides(savedMinRides);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey]);

  const request = useDebounced(JSON.stringify({ filter, minRides }));
  const { data: preview, isFetching } = useQuery<FilterPreview>({
    queryKey: ['division-agent', 'filter-preview', request],
    queryFn: () => {
      const { filter: f, minRides: m } = JSON.parse(request) as { filter: ReviewFilter; minRides: number };
      return authed(user!, `/admin/division-agent/filter-preview?filter=${encodeURIComponent(JSON.stringify(f))}`
        + `&minZwiftRides=${m}`);
    },
    enabled: !!user,
  });

  const dirty = JSON.stringify([filter, minRides]) !== JSON.stringify([saved ?? DEFAULT_FILTER, savedMinRides ?? 15]);

  function toggleReason(key: ReviewReason, on: boolean) {
    setFilter(f => ({ ...f, reasons: on ? [...f.reasons.filter(r => r !== key), key] : f.reasons.filter(r => r !== key) }));
  }

  function setSignupDays(text: string) {
    setDays(text);
    const n = Number(text);
    if (filter.newSignupsDays !== null && Number.isInteger(n) && n >= 1 && n <= 365) {
      setFilter(f => ({ ...f, newSignupsDays: n }));
    }
  }

  async function save() {
    if (!user) return;
    setSaving(true);
    setError('');
    setMessage('');
    try {
      await authed(user, '/admin/division-agent/settings', {
        method: 'POST', body: JSON.stringify({ reviewFilter: filter, minZwiftRides: minRides }),
      });
      setMessage('Saved. The next scan uses this filter.');
      void queryClient.invalidateQueries({ queryKey: ['division-agent', 'status'] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  }

  const check = 'flex items-center gap-2 cursor-pointer';
  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
      <h3 className="font-semibold text-card-foreground">Riders to check</h3>
      <div className="grid gap-4 sm:grid-cols-2 text-sm">
        <fieldset className="space-y-2">
          <legend className="text-muted-foreground mb-1">Only riders who… (all ticked)</legend>
          <label className={check}>
            <input
              type="checkbox"
              checked={filter.newSignupsDays !== null}
              onChange={e => setFilter(f => ({ ...f, newSignupsDays: e.target.checked ? (Number(days) || 30) : null }))}
            />
            signed up in the last
            <input
              type="number" min={1} max={365} value={days} aria-label="Days since sign-up"
              onChange={e => setSignupDays(e.target.value)}
              className="w-16 px-1 py-0.5 rounded border border-border bg-background"
            />
            days
          </label>
          <label className={check}>
            <input type="checkbox" checked={filter.onlyUnlocked}
              onChange={e => setFilter(f => ({ ...f, onlyUnlocked: e.target.checked }))} />
            are not locked (have not raced yet)
          </label>
          <label className={check}>
            <input type="checkbox" checked={filter.onlyWithStrava}
              onChange={e => setFilter(f => ({ ...f, onlyWithStrava: e.target.checked }))} />
            have Strava connected
          </label>
          <label className={check}>
            <input type="checkbox" checked={filter.skipAdminPlaced}
              onChange={e => setFilter(f => ({ ...f, skipAdminPlaced: e.target.checked }))} />
            were not placed by an admin
          </label>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-muted-foreground mb-1">…and have any of (at least one ticked)</legend>
          {REASONS.map(r => (
            <label key={r.key} className={check}>
              <input type="checkbox" checked={filter.reasons.includes(r.key)}
                onChange={e => toggleReason(r.key, e.target.checked)} />
              {r.label}
              {r.key === 'few_rides' && (
                <>
                  {' '}(under
                  <input
                    type="number" min={1} max={200} value={minRides} aria-label="Minimum Zwift rides"
                    onChange={e => setMinRides(Math.max(1, Math.min(200, Number(e.target.value) || 1)))}
                    className="w-16 px-1 py-0.5 rounded border border-border bg-background"
                  />
                  in 90 days)
                </>
              )}
              {preview?.byReason && <span className="text-muted-foreground">· {preview.byReason[r.key] ?? 0}</span>}
            </label>
          ))}
        </fieldset>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {preview && typeof preview.matching === 'number' && (
          <span>
            <strong>{preview.matching}</strong> of {preview.total} riders match
            {preview.inGroup !== preview.total ? ` (${preview.inGroup} in the group)` : ''}
            {preview.pendingOutside > 0
              ? ` · ${preview.pendingOutside} pending card(s) will be closed at the next scan`
              : ''}
            {isFetching ? ' · updating…' : ''}
          </span>
        )}
        {filter.reasons.length === 0 && <span className="text-amber-700">Tick at least one reason, or nobody is checked.</span>}
        <button
          onClick={() => void save()}
          disabled={!user || saving || !dirty}
          className="cursor-pointer px-3 py-1.5 rounded bg-primary text-primary-foreground disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        {message && <span className="text-green-700">{message}</span>}
        {error && <span className="text-red-600">{error}</span>}
      </div>
    </div>
  );
}
