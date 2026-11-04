'use client';

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { API_URL } from '@/lib/api';
import { PreviewBlock, type Preview } from '@/components/admin/category-manager/TransferPreview';

type Prediction = { velo: number | null; category: string | null; confidence?: string };

export interface DivisionProposal {
  id: string;
  zwiftId: string;
  name?: string;
  status: 'pending' | 'approved' | 'edited' | 'rejected' | 'superseded';
  reasons?: string[];
  currentCategory: string | null;
  proposedCategory: string | null;
  suggestedCategory?: string | null;
  predictedVelo?: number | null;
  source?: string;
  confidence?: string;
  flags?: string[];
  adminRationale?: string;
  riderExplanation?: string;
  author?: string;
  locked?: boolean;
  movePreview?: (Preview & { error?: string }) | null;
  createdAt?: string;
  decidedAt?: string;
  decidedBy?: string;
  decisionNote?: string | null;
  appliedCategory?: string;
  evidence?: {
    divisions?: string[];
    zwiftActivityCount?: number | null;
    weightKg?: number | null;
    velo?: { current?: number | null; max30?: number | null };
    strava?: {
      activityCount?: number;
      indoorCount?: number | null;
      outdoorCount?: number | null;
      days?: number;
      prediction?: Prediction;
    } | null;
    zwift?: { prediction?: Prediction } | null;
  };
}

interface AgentStatus {
  enabled: boolean;
  queued: number;
  waiting: number;
  pending: number;
  lastRun?: { at?: string; proposed?: number; processed?: number; waitingForStrava?: number } | null;
}

const REASON_TEXT: Record<string, string> = {
  no_velo: 'no vELO',
  few_rides: 'few Zwift rides',
};

const FLAG_TEXT: Record<string, string> = {
  few_strava_rides: 'few Strava rides',
  implausible_wkg: 'implausible W/kg',
  no_weight: 'no weight',
  strava_zwift_disagree: 'Strava and Zwift disagree',
  no_power_data: 'no power data',
  assessment_disagrees: 'Claude differs from the predictor',
};

function stravaRides(s: { activityCount?: number; indoorCount?: number | null; outdoorCount?: number | null; days?: number }) {
  const total = `${s.activityCount ?? 0} rides in ${s.days ?? '?'} days`;
  return s.indoorCount != null && s.outdoorCount != null
    ? `${total} (${s.indoorCount} indoor, ${s.outdoorCount} outdoor; outdoor efforts corrected)`
    : total;
}

const SOURCE_TEXT: Record<string, string> = { strava: 'Strava', zwift: 'Zwift power', velo: 'vELO' };

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

function when(iso?: string) {
  return iso ? new Date(iso).toLocaleString() : '';
}

function PredictionLine({ label, p, extra }: { label: string; p?: Prediction; extra?: string }) {
  if (!p || p.velo == null) return null;
  return (
    <li>
      {label}: <strong>{p.velo}</strong> → {p.category}
      {p.confidence ? ` (${p.confidence})` : ''}
      {extra ? ` · ${extra}` : ''}
    </li>
  );
}

function ProposalCard({
  proposal, onDecide, busy,
}: {
  proposal: DivisionProposal;
  onDecide: (action: 'approve' | 'edit' | 'reject', body: { category?: string; note?: string }) => void;
  busy: boolean;
}) {
  const [mode, setMode] = useState<'none' | 'edit' | 'reject'>('none');
  const divisions = proposal.evidence?.divisions ?? [];
  const [category, setCategory] = useState(proposal.proposedCategory ?? divisions[0] ?? '');
  const [note, setNote] = useState('');
  const ev = proposal.evidence ?? {};
  return (
    <div className="border border-border rounded-lg p-4 space-y-3 bg-card">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <span className="font-semibold text-foreground">{proposal.name || proposal.zwiftId}</span>
          <span className="text-xs text-muted-foreground"> · {proposal.zwiftId}</span>
          {proposal.locked && <span className="ml-2 text-xs rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">locked</span>}
        </div>
        <span className="text-xs text-muted-foreground">{when(proposal.createdAt)}</span>
      </div>
      <p className="text-lg">
        {proposal.currentCategory ?? 'No division'} → <strong>{proposal.proposedCategory ?? 'needs a manual look'}</strong>
        {proposal.predictedVelo != null && (
          <span className="text-sm text-muted-foreground">
            {' '}· predicted vELO {proposal.predictedVelo} from {SOURCE_TEXT[proposal.source ?? ''] ?? proposal.source}
            {proposal.confidence ? ` · ${proposal.confidence} confidence` : ''}
          </span>
        )}
      </p>
      <div className="flex flex-wrap gap-1 text-xs">
        {(proposal.reasons ?? []).map(r => (
          <span key={r} className="rounded bg-muted px-1.5 py-0.5">{REASON_TEXT[r] ?? r}</span>
        ))}
        {(proposal.flags ?? []).map(f => (
          <span key={f} className="rounded bg-amber-100 text-amber-800 px-1.5 py-0.5">{FLAG_TEXT[f] ?? f}</span>
        ))}
      </div>
      <ul className="text-sm text-muted-foreground list-disc pl-5">
        <PredictionLine label="Strava" p={ev.strava?.prediction}
          extra={ev.strava ? stravaRides(ev.strava) : undefined} />
        <PredictionLine label="Zwift power" p={ev.zwift?.prediction} />
        <li>
          vELO {ev.velo?.current ?? '—'} (max30 {ev.velo?.max30 ?? '—'}) · {ev.zwiftActivityCount ?? 0} Zwift rides
          {ev.weightKg ? ` · ${ev.weightKg} kg` : ''}
        </li>
      </ul>
      {proposal.adminRationale && <p className="text-sm">{proposal.adminRationale}</p>}
      {proposal.riderExplanation && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Text for the rider (Danish)</summary>
          <p className="mt-1 italic">{proposal.riderExplanation}</p>
        </details>
      )}
      {proposal.locked && proposal.movePreview && (
        proposal.movePreview.error
          ? <p className="text-sm text-amber-700">Transfer preview failed: {proposal.movePreview.error}</p>
          : (
            <div>
              <p className="text-sm font-medium">Mid-season transfer preview</p>
              <PreviewBlock preview={proposal.movePreview} />
            </div>
          )
      )}
      {mode === 'none' && (
        <div className="flex flex-wrap gap-2">
          <button
            disabled={busy || !proposal.proposedCategory}
            onClick={() => onDecide('approve', {})}
            className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
          >
            Approve
          </button>
          <button disabled={busy} onClick={() => setMode('edit')} className="px-3 py-1.5 rounded border border-border text-sm">
            Edit
          </button>
          <button disabled={busy} onClick={() => setMode('reject')} className="px-3 py-1.5 rounded border border-border text-sm">
            Reject
          </button>
        </div>
      )}
      {mode !== 'none' && (
        <div className="space-y-2">
          {mode === 'edit' && (
            <label className="text-sm block">
              Division{' '}
              <select
                aria-label="Division"
                value={category}
                onChange={e => setCategory(e.target.value)}
                className="border border-border rounded px-2 py-1 bg-background"
              >
                {divisions.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          )}
          <textarea
            aria-label="Note"
            placeholder="Note (optional)"
            value={note}
            onChange={e => setNote(e.target.value)}
            className="w-full border border-border rounded px-2 py-1 text-sm bg-background"
            rows={2}
          />
          <div className="flex gap-2">
            <button
              disabled={busy || (mode === 'edit' && !category)}
              onClick={() => onDecide(mode, mode === 'edit' ? { category, note } : { note })}
              className="px-3 py-1.5 rounded bg-primary text-primary-foreground text-sm disabled:opacity-50"
            >
              {mode === 'edit' ? 'Apply division' : 'Reject proposal'}
            </button>
            <button onClick={() => setMode('none')} className="px-3 py-1.5 rounded border border-border text-sm">Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

export default function DivisionAgent({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<'pending' | 'history'>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [scanning, setScanning] = useState(false);
  const [pollUntil, setPollUntil] = useState(0);

  const { data: status } = useQuery<AgentStatus>({
    queryKey: ['division-agent', 'status'],
    queryFn: () => authed(user!, '/admin/division-agent/status'),
    enabled: !!user,
    // Faster while riders are queued or right after a scan, so progress is visible.
    refetchInterval: (query) =>
      (query.state.data?.queued ?? 0) > 0 || Date.now() < pollUntil ? 10_000 : 30_000,
  });
  const working = (status?.queued ?? 0) > 0;
  const { data: list, isLoading } = useQuery<{ proposals: DivisionProposal[] }>({
    queryKey: ['division-agent', 'proposals', tab],
    queryFn: () => authed(user!, `/admin/division-agent/proposals?status=${tab}`),
    enabled: !!user,
    // A callback, so the 10-minute fast window after a scan ends on its own.
    refetchInterval: () => {
      if (tab !== 'pending') return false;
      const queued = queryClient.getQueryData<AgentStatus>(['division-agent', 'status'])?.queued ?? 0;
      return queued > 0 || Date.now() < pollUntil ? 10_000 : 30_000;
    },
  });

  async function decide(id: string, action: 'approve' | 'edit' | 'reject', body: { category?: string; note?: string }) {
    if (!user) return;
    setBusyId(id);
    setError('');
    setInfo('');
    try {
      await authed(user, `/admin/division-agent/proposals/${id}/decision`, {
        method: 'POST', body: JSON.stringify({ action, ...body }),
      });
      setInfo(action === 'reject' ? 'Proposal rejected.' : 'Division applied.');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusyId(null);
      void queryClient.invalidateQueries({ queryKey: ['division-agent'] });
      if (action !== 'reject') {
        void queryClient.invalidateQueries({ queryKey: ['admin', 'liga-categories'] });
        void queryClient.invalidateQueries({ queryKey: ['participants'] });
      }
    }
  }

  async function scan() {
    if (!user || scanning) return;
    setError('');
    setInfo('Scanning riders…');
    setScanning(true);
    try {
      const data = await authed(user, '/admin/division-agent/scan', { method: 'POST', body: '{}' });
      const queued = Number(data.queued) || 0;
      setInfo(queued > 0
        ? `${queued} rider(s) queued — proposals appear here within a few minutes.`
        : 'No riders need a review right now.');
      setPollUntil(Date.now() + 10 * 60_000);
      void queryClient.invalidateQueries({ queryKey: ['division-agent'] });
    } catch (e: unknown) {
      setInfo('');
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setScanning(false);
    }
  }

  const proposals = list?.proposals ?? [];
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-foreground">Division Agent</h2>
        <p className="text-sm text-muted-foreground">
          Reviews riders with no vELO or few Zwift rides using Strava and Zwift power (the vELO predictor) and
          proposes a division. Nothing changes until you approve, edit or reject a proposal.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        {status && (
          <span>
            {status.pending} pending · {status.queued} queued
            {status.waiting > 0 ? ` (${status.waiting} waiting for Strava)` : ''}
            {status.lastRun?.at ? ` · last run ${when(status.lastRun.at)}` : ''}
            {status.enabled === false ? ' · agent is switched off' : ''}
            {working && status.enabled !== false ? ' · working…' : ''}
          </span>
        )}
        <button
          onClick={() => void scan()}
          disabled={scanning || !user}
          className="px-3 py-1.5 rounded border border-border disabled:opacity-50"
        >
          {scanning ? 'Scanning…' : 'Scan riders now'}
        </button>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {info && <p className="text-sm text-green-700">{info}</p>}
      <div className="flex border-b border-border">
        {(['pending', 'history'] as const).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 px-4 text-sm font-medium ${tab === t ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground'}`}
          >
            {t === 'pending' ? 'Pending' : 'History'}
          </button>
        ))}
      </div>
      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}
      {!isLoading && proposals.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {tab === 'pending' ? 'No proposals waiting.' : 'No decisions yet.'}
        </p>
      )}
      {tab === 'pending' && proposals.map(p => (
        <ProposalCard key={p.id} proposal={p} busy={busyId === p.id} onDecide={(a, b) => void decide(p.id, a, b)} />
      ))}
      {tab === 'history' && proposals.length > 0 && (
        <table className="w-full text-sm text-left">
          <thead>
            <tr className="text-muted-foreground">
              <th className="py-1">Rider</th><th>Change</th><th>Decision</th><th>By</th><th>When</th><th>Note</th>
            </tr>
          </thead>
          <tbody>
            {proposals.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="py-1">{p.name || p.zwiftId}</td>
                <td>{p.currentCategory ?? '—'} → {p.appliedCategory ?? p.proposedCategory ?? '—'}</td>
                <td>{p.status}</td>
                <td>{p.decidedBy ?? ''}</td>
                <td>{when(p.decidedAt)}</td>
                <td>{p.decisionNote ?? ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
