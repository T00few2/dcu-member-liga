'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';

export interface LeagueSummary {
  races: number;
  finishes: number;
  dnfs: number;
  /** Typical pre-race vELO of the riders this rider finished among. */
  performanceVelo?: number | null;
  recent?: { raceId: string; rank: number | null; fieldSize: number; percentile: number; dnf: boolean }[];
}

interface StrugglingRider {
  zwiftId: string;
  name: string;
  club: string;
  division: string | null;
  league: LeagueSummary;
  velo: { current: number | null; max30: number | null };
  zwiftActivityCount?: number | null;
  heldUp: boolean;
  veloReliable: boolean;
  veloDivision: string | null;
  pendingProposal: { id: string; proposedCategory: string | null } | null;
}

interface StrugglingResponse {
  riders: StrugglingRider[];
  thresholds: { strugglingMinRaces: number; strugglingPercentile: number; strugglingShare: number };
  reasonEnabled: boolean;
}

/** "9/10, 10/10, DNF · rides like vELO 1010 (3 races)" */
export function leagueLine(league: LeagueSummary): string {
  const places = (league.recent ?? []).map(r => (r.dnf ? 'DNF' : `${r.rank}/${r.fieldSize}`)).join(', ');
  const perf = league.performanceVelo != null ? ` · rides like vELO ${league.performanceVelo}` : '';
  return `${places || `${league.races} races`}${perf} (${league.races} race${league.races === 1 ? '' : 's'} in this division)`;
}

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

/** Riders who keep finishing at the back of their division, with a button to have the agent check one. */
export default function StrugglingRiders({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<Record<string, string>>({});
  const { data, isLoading, error } = useQuery<StrugglingResponse>({
    queryKey: ['division-agent', 'struggling'],
    queryFn: () => authed(user!, '/admin/division-agent/struggling'),
    enabled: !!user,
  });

  async function check(zwiftId: string) {
    if (!user) return;
    setBusy(zwiftId);
    try {
      const res = await authed(user, `/admin/division-agent/assess/${zwiftId}?reason=struggling`, { method: 'POST', body: '{}' });
      const text: Record<string, string> = {
        proposed: 'Proposal created (see Pending).',
        no_change: 'Checked: no move proposed.',
        handled: 'Already checked with this data.',
      };
      setNote(n => ({ ...n, [zwiftId]: text[res.outcome as string] ?? 'Checked.' }));
      void queryClient.invalidateQueries({ queryKey: ['division-agent'] });
    } catch (e: unknown) {
      setNote(n => ({ ...n, [zwiftId]: e instanceof Error ? e.message : 'Check failed' }));
    } finally {
      setBusy(null);
    }
  }

  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  if (error) return <p className="text-sm text-red-600">{error instanceof Error ? error.message : 'Could not load'}</p>;
  const riders = data?.riders ?? [];
  const t = data?.thresholds;
  return (
    <div className="space-y-2">
      {t && (
        <p className="text-sm text-muted-foreground">
          In the last {Math.round((1 - t.strugglingPercentile) * 100)}% of the field in at least{' '}
          {Math.round(t.strugglingShare * 100)}% of their races, with at least {t.strugglingMinRaces} races in the
          division (finalized races only). The agent only proposes a move down for riders placed above their own
          vELO division or with an unreliable vELO.
          {data && !data.reasonEnabled ? ' The agent does not check these riders by itself until the reason is ticked above.' : ''}
        </p>
      )}
      {riders.length === 0 && <p className="text-sm text-muted-foreground">No riders match right now.</p>}
      {riders.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead>
              <tr className="text-muted-foreground">
                <th className="py-1 pr-3">Rider</th><th className="pr-3">Division</th><th className="pr-3">Results</th>
                <th className="pr-3">vELO</th><th className="pr-3">Placement</th><th></th>
              </tr>
            </thead>
            <tbody>
              {riders.map(r => (
                <tr key={r.zwiftId} className="border-t border-border align-top">
                  <td className="py-1 pr-3">
                    {r.name || r.zwiftId}
                    <span className="block text-xs text-muted-foreground">{r.club}</span>
                  </td>
                  <td className="pr-3">{r.division ?? '—'}</td>
                  <td className="pr-3">{leagueLine(r.league)}</td>
                  <td className="pr-3">
                    {r.velo.current ?? '—'} (max30 {r.velo.max30 ?? '—'})
                    <span className="block text-xs text-muted-foreground">{r.zwiftActivityCount ?? 0} Zwift rides</span>
                  </td>
                  <td className="pr-3">
                    {r.heldUp
                      ? (r.veloReliable ? `Above own vELO division (${r.veloDivision ?? '—'})` : 'vELO unreliable')
                      : 'vELO belongs here'}
                  </td>
                  <td className="whitespace-nowrap">
                    {r.pendingProposal
                      ? <span className="text-xs">Pending: → {r.pendingProposal.proposedCategory ?? '?'}</span>
                      : (
                        <button
                          onClick={() => void check(r.zwiftId)}
                          disabled={busy === r.zwiftId}
                          className="cursor-pointer px-2 py-1 rounded border border-border disabled:opacity-50"
                        >
                          {busy === r.zwiftId ? 'Checking…' : 'Check now'}
                        </button>
                      )}
                    {note[r.zwiftId] && <span className="block text-xs text-muted-foreground">{note[r.zwiftId]}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
