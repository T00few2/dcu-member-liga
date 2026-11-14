'use client';

import { useState } from 'react';
import type { User } from 'firebase/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import type { PredictorConfigResponse } from '@/hooks/queries';
import CategoryPredictorResearch from './CategoryPredictorResearch';

interface Score {
  n: number;
  divisionAccuracy: number;
  adjacentAccuracy: number;
  maeVelo: number;
  zwiftDivisionAccuracy: number;
  /** Per kind of right answer: the rider's own reliable vELO, or league results (riders without one). */
  bySource?: Record<string, { n: number; divisionAccuracy: number; maeVelo: number }>;
}

const SOURCE_LABEL: Record<string, string> = {
  velo: 'riders with a reliable vELO',
  league: 'league races of riders without one',
  leaguePointInTimeWeight: 'of those, weight recorded before the race',
};

interface TuningRun {
  runId: string;
  createdAt: string;
  startedBy?: string;
  status: 'running' | 'pending' | 'report' | 'applied' | 'rejected' | 'failed';
  error?: string;
  result?: {
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
      {score.bySource && Object.keys(score.bySource).length > 1 && (
        <ul className="text-xs text-muted-foreground list-disc pl-5">
          {Object.entries(score.bySource).map(([key, s]) => (
            <li key={key}>
              {SOURCE_LABEL[key] ?? key}: {s.divisionAccuracy}% right division · MAE {s.maeVelo} pts · n={s.n}
            </li>
          ))}
        </ul>
      )}
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
    // While a run is being computed in the background, check every 5 s.
    refetchInterval: query => ((query.state.data as TuningRun[] | undefined)?.[0]?.status === 'running' ? 5_000 : false),
  });
  const latest = runs?.[0];
  const r = latest?.result;
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

  /** Start a long backend job without waiting for it (the page polls for progress). */
  async function startTuning() {
    if (!user) return;
    setBusy('tune');
    setError('');
    try {
      const token = await user.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor/tune`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.message ?? 'Could not start tuning');
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ['predictor', 'tune-runs'] });
      // Ask the server to process the run now and wait for it (usually under a minute).
      // If this request is dropped or times out, the predictor worker (Cloud Scheduler,
      // every 5 minutes) processes the run, so errors here are not shown.
      await fetch(`${API_URL}/admin/predictor/tune/${data.runId}/process`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      }).catch(() => undefined);
      void queryClient.invalidateQueries({ queryKey: ['predictor', 'tune-runs'] });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start tuning');
    } finally {
      setBusy(null);
    }
  }

  const metrics = config?.metrics as Score | null | undefined;
  const tuningRunning = latest?.status === 'running';

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Tuning</h2>
          <p className="text-sm text-muted-foreground">
            Checks how often a <strong>Strava</strong>-based prediction lands in the right division for riders whose
            real vELO is reliable (enough Zwift rides, stable rating), using cross-validation and only cached Strava
            curves. Better settings are proposed only with enough data and a clear improvement. What data is
            available is shown under “Data for the predictor” above.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void startTuning()}
          disabled={busy !== null || !user || tuningRunning}
          className="px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy === 'tune' || tuningRunning ? 'Running…' : 'Run tuning'}
        </button>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {metrics && <ScoreLine label="Active settings (last measured)" score={metrics} />}

      {latest && (
        <div className="border border-border rounded p-4 space-y-2">
          <div className="text-xs text-muted-foreground">
            Latest run {new Date(latest.createdAt).toLocaleString()}
            {r ? ` · ${r.evalRiders} eval riders` : ''} · status{' '}
            <span className="font-medium text-foreground">{latest.status}</span>
          </div>
          {latest.status === 'running' && (
            <p className="text-sm text-muted-foreground">Running in the background… usually done within a minute, at the latest within 5 minutes.</p>
          )}
          {latest.error && <p className="text-sm text-red-600">{latest.error}</p>}
          {r && (
          <>
          <p className="text-sm text-foreground">{r.message}</p>
          <ScoreLine label="Current settings" score={r.current?.score} />
          {r.best && <ScoreLine label="Proposed settings" score={r.best.score} />}
          {r.pastPredictions.n > 0 && (
            <p className="text-sm text-muted-foreground">
              Earlier predicted placements, now that those riders race: {r.pastPredictions.divisionAccuracy}% right
              division, MAE {r.pastPredictions.maeVelo} pts, bias {r.pastPredictions.meanBias} pts
              (n={r.pastPredictions.n}).
            </p>
          )}
          {r.changedRiders.length > 0 && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">
                {r.changedRiders.length} eval riders would get a different predicted division
              </summary>
              <ul className="mt-1 space-y-0.5">
                {r.changedRiders.map(r => (
                  <li key={r.zwiftId} className="font-mono text-xs">
                    {r.zwiftId}: {r.before} → {r.after} (real {r.realCategory})
                  </li>
                ))}
              </ul>
            </details>
          )}
          {r.best && (
            <details className="text-sm">
              <summary className="cursor-pointer text-muted-foreground">Proposed settings</summary>
              <pre className="mt-1 text-xs overflow-x-auto">{JSON.stringify(r.best.config, null, 2)}</pre>
            </details>
          )}
          </>
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

      <CategoryPredictorResearch user={user} />
    </div>
  );
}
