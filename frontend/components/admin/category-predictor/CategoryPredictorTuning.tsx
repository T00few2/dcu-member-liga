'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import type { PredictorConfigResponse } from '@/hooks/queries';

interface Score {
  n: number;
  divisionAccuracy: number;
  adjacentAccuracy: number;
  maeVelo: number;
  zwiftDivisionAccuracy: number;
}

interface TuningRun {
  runId: string;
  createdAt: string;
  startedBy?: string;
  status: 'pending' | 'report' | 'applied' | 'rejected';
  result: {
    status: 'insufficient_data' | 'no_improvement' | 'improved';
    evalRiders: number;
    current: { score: Score } | null;
    best: { score: Score; config: Record<string, unknown> } | null;
    improvementPP: number;
    changedRiders: { zwiftId: string; realCategory: string; before: string; after: string }[];
    pastPredictions: { n: number; divisionAccuracy?: number; maeVelo?: number; meanBias?: number };
    message: string;
  };
}

export interface CategoryPredictorTuningProps {
  user: User | null;
  config?: PredictorConfigResponse;
}

function ScoreLine({ label, score }: { label: string; score: Score | null | undefined }) {
  if (!score) return null;
  return (
    <div className="text-sm">
      <span className="text-muted-foreground">{label}: </span>
      <span className="font-semibold text-foreground">{score.divisionAccuracy}%</span>
      <span className="text-muted-foreground"> right division · {score.adjacentAccuracy}% within one · MAE {score.maeVelo} pts · n={score.n}</span>
    </div>
  );
}

/** Run predictor tuning, review the result, and apply/reject or roll back settings. */
export default function CategoryPredictorTuning({ user, config }: CategoryPredictorTuningProps) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState('');

  const { data: runs } = useQuery<TuningRun[]>({
    queryKey: ['predictor', 'tune-runs'],
    queryFn: async () => {
      const token = await user!.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor/tune/runs`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load tuning runs');
      return (await res.json()).runs ?? [];
    },
    enabled: !!user,
    staleTime: 60_000,
  });
  const latest = runs?.[0];

  async function call(path: string, body: unknown, label: string) {
    if (!user) return;
    setBusy(label);
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) setError(data.message ?? 'Request failed');
      void queryClient.invalidateQueries({ queryKey: ['predictor'] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Request failed');
    } finally {
      setBusy(null);
    }
  }

  const metrics = config?.metrics as Score | null | undefined;

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tuning</h2>
          <p className="text-sm text-muted-foreground">
            Checks how often a <strong>Strava</strong>-based prediction lands in the right division for riders whose
            real vELO is reliable (enough Zwift rides, stable rating), using cross-validation and only cached Strava
            curves. Better settings are proposed only with enough data and a clear improvement.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void call('/admin/predictor/tune', {}, 'tune')}
          disabled={busy !== null || !user}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'tune' ? 'Running…' : 'Run tuning'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {metrics && <ScoreLine label="Active settings (last measured)" score={metrics} />}

      {latest && (
        <div className="border border-border rounded p-4 space-y-2">
          <div className="text-xs text-muted-foreground">
            Latest run {new Date(latest.createdAt).toLocaleString()} · {latest.result.evalRiders} eval riders · status{' '}
            <span className="font-medium text-foreground">{latest.status}</span>
          </div>
          <p className="text-sm text-foreground">{latest.result.message}</p>
          <ScoreLine label="Current settings" score={latest.result.current?.score} />
          {latest.result.best && <ScoreLine label="Proposed settings" score={latest.result.best.score} />}
          {latest.result.pastPredictions.n > 0 && (
            <p className="text-sm text-muted-foreground">
              Earlier predicted placements, now that those riders race: {latest.result.pastPredictions.divisionAccuracy}% right
              division, MAE {latest.result.pastPredictions.maeVelo} pts, bias {latest.result.pastPredictions.meanBias} pts
              (n={latest.result.pastPredictions.n}).
            </p>
          )}
          {latest.result.changedRiders.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {latest.result.changedRiders.length} eval riders would get a different predicted division
              </summary>
              <ul className="mt-1 space-y-0.5">
                {latest.result.changedRiders.map(r => (
                  <li key={r.zwiftId} className="font-mono text-xs">
                    {r.zwiftId}: {r.before} → {r.after} (real {r.realCategory})
                  </li>
                ))}
              </ul>
            </details>
          )}
          {latest.result.best && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Proposed settings</summary>
              <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(latest.result.best.config, null, 2)}</pre>
            </details>
          )}
          {latest.status === 'pending' && (
            <div className="flex gap-2 pt-1">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => void call(`/admin/predictor/tune/${latest.runId}/decision`, { action: 'apply' }, 'apply')}
                className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
              >
                Apply
              </button>
              <button
                type="button"
                disabled={busy !== null}
                onClick={() => {
                  const note = prompt('Why reject? (optional)') ?? '';
                  void call(`/admin/predictor/tune/${latest.runId}/decision`, { action: 'reject', note }, 'reject');
                }}
                className="px-3 py-1.5 text-sm rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
              >
                Reject
              </button>
            </div>
          )}
        </div>
      )}

      {(config?.history?.length ?? 0) > 0 && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Settings history ({config!.history.length})</summary>
          <ul className="mt-2 space-y-1">
            {config!.history.map((h, i) => (
              <li key={i} className="flex items-center justify-between gap-3">
                <span className="text-xs text-muted-foreground">
                  Replaced {h.replacedAt ? new Date(h.replacedAt).toLocaleString() : '—'} by {h.replacedBy ?? '—'}
                  {h.reason ? ` · ${h.reason}` : ''}
                </span>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => {
                    if (confirm('Restore these predictor settings? The current ones go into the history.')) {
                      void call('/admin/predictor/config', { rollbackIndex: i }, 'rollback');
                    }
                  }}
                  className="px-2 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                >
                  Roll back
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
