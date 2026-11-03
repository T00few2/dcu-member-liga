'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

interface Score {
  n: number;
  divisionAccuracy: number;
  maeVelo: number;
}

interface Findings {
  baselineDivisionAccuracy: number;
  bestDivisionAccuracy: number;
  baselineMaeVelo: number;
  bestMaeVelo: number;
  improved: boolean;
  summary: string;
  method: string;
  proposedCode: string;
  caveats: string;
  ridersChanged: number;
}

export interface ResearchRun {
  runId: string;
  createdAt: string;
  startedBy?: string;
  status: 'queued' | 'running' | 'done' | 'failed' | 'timed_out';
  finishedAt?: string;
  model?: string;
  usage?: { inputTokens: number; outputTokens: number; turns: number };
  evalRiders?: number;
  baseline?: Score;
  findings?: Findings;
  baselineReproduced?: boolean;
  improvementPP?: number;
  outcome?: 'proposal' | 'report';
  error?: string;
  lastText?: string;
}

const STATUS_LABEL: Record<ResearchRun['status'], string> = {
  queued: 'Queued — starts within 30 minutes',
  running: 'Running in the sandbox (up to ~13 minutes)…',
  done: 'Done',
  failed: 'Failed',
  timed_out: 'Stopped at the time limit',
};

/** Markdown for a GitHub issue, so a proposal can become a normal pull request. */
export function researchIssueMarkdown(run: ResearchRun): string {
  const f = run.findings;
  if (!f) return '';
  return [
    `## Predictor research proposal (${new Date(run.createdAt).toISOString().slice(0, 10)})`,
    '',
    `Strava→division accuracy: **${f.baselineDivisionAccuracy}% → ${f.bestDivisionAccuracy}%** `
      + `(+${run.improvementPP ?? '?'} pp, MAE ${f.baselineMaeVelo} → ${f.bestMaeVelo} vELO pts) `
      + `on ${run.evalRiders ?? '?'} riders; ${f.ridersChanged} would change division.`,
    '',
    '### Summary',
    f.summary,
    '',
    '### Method',
    f.method,
    '',
    '### Caveats',
    f.caveats,
    '',
    '### Proposed code for `backend/services/velo_predictor.py`',
    '```python',
    f.proposedCode,
    '```',
    '',
    `_Research run ${run.runId} (${run.model ?? 'Claude'}, Claude sandbox). Not run in production; `
      + 'implement as a normal PR and re-run tuning after merging._',
  ].join('\n');
}

export default function CategoryPredictorResearch({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [copied, setCopied] = useState(false);

  const { data: runs } = useQuery<ResearchRun[]>({
    queryKey: ['predictor', 'research-runs'],
    queryFn: async () => {
      const token = await user!.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor/research/runs`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load research runs');
      return (await res.json()).runs ?? [];
    },
    enabled: !!user,
    refetchInterval: query => {
      const latest = (query.state.data as ResearchRun[] | undefined)?.[0];
      return latest && (latest.status === 'queued' || latest.status === 'running') ? 30_000 : false;
    },
  });
  const latest = runs?.[0];
  const active = latest?.status === 'queued' || latest?.status === 'running';

  async function start() {
    if (!user) return;
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor/research`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not start research');
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['predictor', 'research-runs'] });
      // Start processing right away; the server keeps going even if this page is closed.
      void fetch(`${API_URL}/admin/predictor/research/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
        .catch(() => undefined)
        .finally(() => { void queryClient.invalidateQueries({ queryKey: ['predictor', 'research-runs'] }); });
      setTimeout(() => { void queryClient.invalidateQueries({ queryKey: ['predictor', 'research-runs'] }); }, 3000);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start research');
    }
  }

  async function copyIssue() {
    if (!latest) return;
    try {
      await navigator.clipboard.writeText(researchIssueMarkdown(latest));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy to the clipboard');
    }
  }

  const f = latest?.findings;

  return (
    <div className="border-t border-border pt-4 space-y-3">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h3 className="text-base font-semibold text-foreground">Code research (Claude sandbox)</h3>
          <p className="text-sm text-muted-foreground">
            Claude tries new features and model types on an anonymized copy of the tuning data (no names or IDs),
            scored with the same folds and the same right-division measure. Nothing runs in production: a clear
            improvement becomes proposed code you can copy into a GitHub issue. Runs monthly, or now. About $1–3 per run.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void start()}
          disabled={!user || active}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {active ? 'Research running…' : 'Run research'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {latest && (
        <div className="border border-border rounded p-4 space-y-2 text-sm">
          <div className="text-xs text-muted-foreground">
            {new Date(latest.createdAt).toLocaleString()} · {latest.startedBy ?? '—'}
            {latest.usage ? ` · ${latest.usage.turns} turns, ${Math.round((latest.usage.inputTokens + latest.usage.outputTokens) / 1000)}k tokens` : ''}
          </div>
          <p className="font-medium text-foreground">
            {STATUS_LABEL[latest.status]}
            {latest.status === 'done' && latest.outcome === 'proposal' && ` — proposal: +${latest.improvementPP} pp`}
            {latest.status === 'done' && latest.outcome === 'report' && ' — report only (no clear improvement)'}
          </p>
          {latest.error && <p className="text-red-600">{latest.error}</p>}
          {latest.status === 'done' && latest.baselineReproduced === false && (
            <p className="text-amber-700">
              Claude&apos;s baseline did not match ours ({latest.baseline?.divisionAccuracy}%), so its numbers are not
              trusted as a proposal.
            </p>
          )}
          {f && (
            <>
              <p>
                <span className="text-muted-foreground">Right division: </span>
                <span className="font-semibold">{f.baselineDivisionAccuracy}% → {f.bestDivisionAccuracy}%</span>
                <span className="text-muted-foreground">
                  {' '}· MAE {f.baselineMaeVelo} → {f.bestMaeVelo} pts · {f.ridersChanged} riders would move
                </span>
              </p>
              <p className="whitespace-pre-wrap text-foreground">{f.summary}</p>
              <details>
                <summary className="cursor-pointer text-muted-foreground">Method and caveats</summary>
                <p className="mt-1 whitespace-pre-wrap">{f.method}</p>
                <p className="mt-1 whitespace-pre-wrap text-muted-foreground">{f.caveats}</p>
              </details>
              {f.proposedCode.trim() && (
                <details open={latest.outcome === 'proposal'}>
                  <summary className="cursor-pointer text-muted-foreground">Proposed code</summary>
                  <pre className="mt-1 text-xs overflow-x-auto bg-muted/40 p-2 rounded">{f.proposedCode}</pre>
                </details>
              )}
              {latest.outcome === 'proposal' && (
                <button
                  type="button"
                  onClick={() => void copyIssue()}
                  className="px-3 py-1.5 text-xs rounded border border-border text-muted-foreground hover:text-foreground"
                >
                  {copied ? 'Copied' : 'Copy as GitHub issue'}
                </button>
              )}
            </>
          )}
          {!f && latest.lastText && latest.status !== 'running' && (
            <details>
              <summary className="cursor-pointer text-muted-foreground">Last message from Claude</summary>
              <p className="mt-1 whitespace-pre-wrap text-xs">{latest.lastText}</p>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
