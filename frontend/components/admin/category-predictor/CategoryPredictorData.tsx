'use client';

import { useState, type ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

interface LeagueRiders {
  total: number;
  ready: number;
  noStrava: number;
  toFetch: number;
  noPower: number;
  awaitingRecount: number;
  noRidesBeforeRace: number;
}

export interface PredictorDataStatus {
  days: number;
  /** Riders with a reliable vELO and Strava connected (the accuracy check uses these). */
  eligible: number;
  cached: number;
  noPowerData?: number;
  toFetchEligible?: number;
  /** Other riders with Strava: no vELO or too few Zwift rides (the ones the predictor places). */
  others?: number;
  othersCached?: number;
  othersNoPower?: number;
  toFetchOthers?: number;
  noStrava?: number;
  remaining: number;
  minEvalRiders: number;
  league?: {
    racesFinalized: number;
    racesBuilt: number;
    observations: number;
    withStrava: number;
    weightBeforeRace: number;
    usable: number;
    usableRiders: number;
    riders?: LeagueRiders;
    /** When the races with riders still missing are counted again. */
    nextRecountAt?: string | null;
    rebuildAfterHours?: number;
  } | null;
  lastWarm?: {
    at: string;
    warmed: number;
    noPowerData: number;
    failed: number;
    failedDownloads?: number;
    rateLimited: boolean;
  } | null;
  stravaUsage?: {
    usage15: number;
    limit15: number;
    usageDay: number;
    limitDay: number;
    appRequestsDay?: number;
    overallLimitDay?: number | null;
    overallUsageDay?: number;
    refusedDay?: number;
    known: boolean;
    cacheBudgetFraction: number;
  };
}

const th = 'py-1.5 pr-4 text-left font-medium text-muted-foreground';
const td = 'py-1.5 pr-4 align-top';
const num = 'py-1.5 pr-4 align-top text-right tabular-nums';

function time(iso?: string | null) {
  return iso
    ? new Date(iso).toLocaleString([], { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' })
    : '';
}

function Status({ done, children }: { done: boolean; children: ReactNode }) {
  return (
    <span className={`inline-block rounded px-1.5 py-0.5 text-xs ${done ? 'bg-green-100 text-green-800' : 'bg-amber-100 text-amber-800'}`}>
      {children}
    </span>
  );
}

/** What data the predictor has, what is still being collected, and what can never be collected. */
export default function CategoryPredictorData({ user }: { user: User | null }) {
  const queryClient = useQueryClient();
  const [pollUntil, setPollUntil] = useState(0);
  const [error, setError] = useState('');

  const { data } = useQuery<PredictorDataStatus>({
    queryKey: ['predictor', 'strava-cache'],
    queryFn: async () => {
      const token = await user!.getIdToken();
      const res = await fetch(`${API_URL}/admin/predictor/strava-cache/status`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error('Failed to load the data status');
      return res.json();
    },
    enabled: !!user,
    staleTime: 60_000,
    // After "Fetch now", refresh every 10 s for a few minutes to show progress.
    refetchInterval: () => (Date.now() < pollUntil ? 10_000 : false),
  });

  async function fetchNow() {
    if (!user) return;
    setError('');
    setPollUntil(Date.now() + 4 * 60_000);
    try {
      const token = await user.getIdToken();
      void fetch(`${API_URL}/admin/predictor/strava-cache/warm`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      })
        .catch(() => undefined)
        .finally(() => { void queryClient.invalidateQueries({ queryKey: ['predictor', 'strava-cache'] }); });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not start the Strava fetch');
    }
  }

  const fetching = Date.now() < pollUntil;
  const league = data?.league;
  const riders = league?.riders;
  const recount = league?.nextRecountAt ? `counted at the next recount (${time(league.nextRecountAt)})` : 'counted at the next recount';

  return (
    <div className="bg-card border border-border rounded-lg p-6 space-y-5">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Data for the predictor</h2>
        <p className="text-sm text-muted-foreground">
          The predictor learns from two things: each rider&apos;s Strava power, and how riders did in the league&apos;s
          own races. This shows what has been collected, what is still on its way, and what cannot be collected.
        </p>
      </div>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!data && <p className="text-sm text-muted-foreground">Loading…</p>}

      {data && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-foreground">1. Strava power per rider</h3>
            {data.remaining > 0
              ? <Status done={false}>{data.remaining} riders queued</Status>
              : <Status done>Up to date</Status>}
          </div>
          <p className="text-sm text-muted-foreground">
            Best efforts from the last {data.days} days of each rider&apos;s Strava rides. Refreshed weekly.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border">
                  <th className={th}>Riders</th>
                  <th className={`${th} text-right`}>Total</th>
                  <th className={`${th} text-right`}>Power ready</th>
                  <th className={`${th} text-right`}>No power rides on Strava</th>
                  <th className={`${th} text-right`}>Queued for a fetch</th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-border">
                  <td className={td}>
                    Reliable vELO
                    <span className="block text-xs text-muted-foreground">Used to measure the predictor&apos;s accuracy (tuning needs {data.minEvalRiders} with power)</span>
                  </td>
                  <td className={num}>{data.eligible}</td>
                  <td className={num}>{data.cached}</td>
                  <td className={num}>{data.noPowerData ?? 0}</td>
                  <td className={num}>{data.toFetchEligible ?? 0}</td>
                </tr>
                <tr className="border-b border-border">
                  <td className={td}>
                    No vELO or few Zwift rides
                    <span className="block text-xs text-muted-foreground">The riders the predictor places in a division</span>
                  </td>
                  <td className={num}>{data.others ?? 0}</td>
                  <td className={num}>{data.othersCached ?? 0}</td>
                  <td className={num}>{data.othersNoPower ?? 0}</td>
                  <td className={num}>{data.toFetchOthers ?? 0}</td>
                </tr>
                <tr>
                  <td className={td}>
                    Strava not connected
                    <span className="block text-xs text-muted-foreground">Nothing to fetch until the rider connects Strava</span>
                  </td>
                  <td className={num}>{data.noStrava ?? 0}</td>
                  <td className={num}>—</td>
                  <td className={num}>—</td>
                  <td className={num}>—</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            “No power rides” means Strava is connected but holds no rides recorded with a power meter; it is checked
            again every week. A rider with power ready can also be queued, for the weekly refresh.
          </p>
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>
              {data.remaining > 0
                ? `Fetching ${data.remaining} riders: 10 every 15 minutes, automatically.`
                : 'Nothing to fetch right now.'}
              {data.lastWarm
                ? ` Last run ${time(data.lastWarm.at)}: ${data.lastWarm.warmed + data.lastWarm.noPowerData} riders checked`
                  + `, ${data.lastWarm.warmed} got a power curve`
                  + (data.lastWarm.failed > 0 ? `, ${data.lastWarm.failed} failed` : '')
                  + ((data.lastWarm.failedDownloads ?? 0) > 0 ? `, ${data.lastWarm.failedDownloads} ride downloads failed (tried again later)` : '')
                  + (data.lastWarm.rateLimited ? '. Paused: Strava budget reached, continues in the next 15 minutes' : '')
                  + '.'
                : ''}
            </span>
            {data.remaining > 0 && (
              <button
                type="button"
                onClick={() => void fetchNow()}
                disabled={!user || fetching}
                className="cursor-pointer px-2.5 py-1 text-xs rounded border border-border text-muted-foreground hover:text-foreground disabled:opacity-50"
                title="Fetches up to 10 riders now instead of waiting for the next automatic run"
              >
                {fetching ? 'Fetching…' : 'Fetch 10 now'}
              </button>
            )}
          </div>
        </section>
      )}

      {league && (
        <section className="space-y-2">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="font-semibold text-foreground">2. League races as the right answer</h3>
            {riders && (riders.toFetch + riders.awaitingRecount > 0
              ? <Status done={false}>{riders.toFetch + riders.awaitingRecount} riders still coming</Status>
              : <Status done>Complete</Status>)}
          </div>
          <p className="text-sm text-muted-foreground">
            For each finalized race, a rider&apos;s result is paired with the Strava power they had shown{' '}
            <strong>before</strong> that race. {league.racesBuilt} of {league.racesFinalized} finalized races are
            processed, with {league.observations.toLocaleString()} results.
          </p>
          {riders && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className={th}>Riders with a league result</th>
                    <th className={`${th} text-right`}>Riders</th>
                    <th className={th}>What happens next</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-border">
                    <td className={td}>Power from before the race is known</td>
                    <td className={num}>{riders.ready}</td>
                    <td className={td}><Status done>Ready</Status></td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className={td}>Fetched from Strava, not counted yet</td>
                    <td className={num}>{riders.awaitingRecount}</td>
                    <td className={td}>Automatic: {recount}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className={td}>Queued for a Strava fetch</td>
                    <td className={num}>{riders.toFetch}</td>
                    <td className={td}>Automatic: fetched (table 1), then {recount}</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className={td}>Strava connected, but no power rides</td>
                    <td className={num}>{riders.noPower}</td>
                    <td className={td}>Cannot be used unless the rider records power on Strava</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className={td}>Power rides, but none in the {data?.days ?? 90} days before their races</td>
                    <td className={num}>{riders.noRidesBeforeRace}</td>
                    <td className={td}>Cannot be used for those races</td>
                  </tr>
                  <tr className="border-b border-border">
                    <td className={td}>Strava not connected</td>
                    <td className={num}>{riders.noStrava}</td>
                    <td className={td}>Cannot be used unless the rider connects Strava</td>
                  </tr>
                  <tr className="font-medium">
                    <td className={td}>Total</td>
                    <td className={num}>{riders.total}</td>
                    <td className={td}></td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
          <table className="text-sm">
            <tbody>
              <tr>
                <td className={td}>Results with power from before the race</td>
                <td className={num}>{league.withStrava.toLocaleString()} of {league.observations.toLocaleString()}</td>
              </tr>
              <tr>
                <td className={td}>
                  <strong>Usable as the right answer in tuning</strong>
                  <span className="block text-xs text-muted-foreground">
                    Results of riders without a reliable vELO: the riders the predictor is for
                  </span>
                </td>
                <td className={num}><strong>{league.usable}</strong> results from {league.usableRiders} riders</td>
              </tr>
              <tr>
                <td className={td}>
                  Results that also have a weight recorded before the race
                  <span className="block text-xs text-muted-foreground">
                    Weights are recorded from 13 November 2026 on; earlier races use today&apos;s weight
                  </span>
                </td>
                <td className={num}>{league.weightBeforeRace.toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <p className="text-xs text-muted-foreground">
            The rider counts are as of each race&apos;s last count. Races with riders still coming are counted again every{' '}
            {league.rebuildAfterHours ?? 6} hours{league.nextRecountAt ? `; next at ${time(league.nextRecountAt)}` : ''}.
          </p>
        </section>
      )}

      {data?.stravaUsage?.known && (
        <details className="text-sm">
          <summary className="cursor-pointer text-muted-foreground">Strava API usage today</summary>
          <table className="mt-2 text-sm">
            <tbody>
              <tr>
                <td className={td}>Reads counted by Strava</td>
                <td className={num}>{data.stravaUsage.usageDay.toLocaleString()} of {data.stravaUsage.limitDay.toLocaleString()}</td>
              </tr>
              <tr>
                <td className={td}>Reads in this 15 minutes</td>
                <td className={num}>{data.stravaUsage.usage15} of {data.stravaUsage.limit15}</td>
              </tr>
              {data.stravaUsage.overallLimitDay ? (
                <tr>
                  <td className={td}>All requests counted by Strava</td>
                  <td className={num}>{(data.stravaUsage.overallUsageDay ?? 0).toLocaleString()} of {data.stravaUsage.overallLimitDay.toLocaleString()}</td>
                </tr>
              ) : null}
              {data.stravaUsage.appRequestsDay != null && (
                <tr>
                  <td className={td}>Requests the app made (Strava does not count ride downloads)</td>
                  <td className={num}>{data.stravaUsage.appRequestsDay.toLocaleString()}</td>
                </tr>
              )}
              <tr>
                <td className={td}>Requests Strava refused</td>
                <td className={num}>{(data.stravaUsage.refusedDay ?? 0).toLocaleString()}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-1 text-xs text-muted-foreground">
            Fetching uses at most {Math.round(data.stravaUsage.cacheBudgetFraction * 100)}% of Strava&apos;s limits and
            pauses when that is reached, so the rest of the app always has room.
          </p>
        </details>
      )}
    </div>
  );
}
