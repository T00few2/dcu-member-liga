import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import CategoryPredictorTuning from '@/components/admin/category-predictor/CategoryPredictorTuning';

const score = (divisionAccuracy: number) => ({
  n: 48, divisionAccuracy, adjacentAccuracy: 96, maeVelo: 70, zwiftDivisionAccuracy: 80,
});

const pendingRun = {
  runId: 'run1',
  createdAt: '2026-11-03T10:00:00Z',
  status: 'pending',
  result: {
    status: 'improved',
    evalRiders: 48,
    current: { score: score(52) },
    best: { score: score(61), config: { stravaWindowDays: 60 } },
    improvementPP: 9,
    changedRiders: [{ zwiftId: '7', realCategory: 'Gold', before: 'Silver', after: 'Gold' }],
    pastPredictions: { n: 0 },
    message: 'New settings improve Strava→division accuracy by 9 pp.',
  },
};

const user = { getIdToken: vi.fn().mockResolvedValue('t') } as unknown as User;
let fetchMock: ReturnType<typeof vi.fn>;
let tuneRuns: unknown[] = [];

beforeEach(() => {
  tuneRuns = [pendingRun];
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/admin/predictor/tune/runs')) {
      return new Response(JSON.stringify({ runs: tuneRuns }), { status: 200 });
    }
    if (String(url).endsWith('/admin/predictor/strava-cache/status')) {
      return new Response(JSON.stringify({
        days: 90, eligible: 70, cached: 12, others: 30, othersCached: 4, remaining: 84, minEvalRiders: 40,
        stravaUsage: { usage15: 40, limit15: 300, usageDay: 900, limitDay: 3000, appRequestsDay: 2400, known: true, cacheBudgetFraction: 0.5 },
      }), { status: 200 });
    }
    if (String(url).endsWith('/admin/predictor/tune')) {
      return new Response(JSON.stringify({ runId: 'new1', status: 'running' }), { status: 200 });
    }
    return new Response(JSON.stringify({ message: 'ok' }), { status: 200 });
  });
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function renderPanel() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <CategoryPredictorTuning user={user} />
    </QueryClientProvider>,
  );
}

describe('CategoryPredictorTuning', () => {
  it('shows the latest run with before/after accuracy and the riders that would move', async () => {
    renderPanel();
    expect(await screen.findByText(/improve Strava→division accuracy by 9 pp/)).toBeInTheDocument();
    expect(screen.getByText('52%')).toBeInTheDocument();
    expect(screen.getByText('61%')).toBeInTheDocument();
    expect(screen.getByText(/1 eval riders would get a different predicted division/)).toBeInTheDocument();
  });

  it('applies a pending proposal', async () => {
    const u = userEvent.setup();
    renderPanel();
    await u.click(await screen.findByRole('button', { name: 'Apply' }));
    await waitFor(() => {
      const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith('/admin/predictor/tune/run1/decision'));
      expect(call).toBeTruthy();
      expect(JSON.parse((call![1] as RequestInit).body as string)).toEqual({ action: 'apply' });
    });
  });

  it('shows Strava cache progress and can fill it now', async () => {
    const u = userEvent.setup();
    renderPanel();
    expect(await screen.findByText(/of 70 eligible riders/)).toBeInTheDocument();
    expect(screen.getByText(/tuning needs 40/)).toBeInTheDocument();
    expect(screen.getByText(/Other riders with Strava \(division agent\): 4 of 30 cached/)).toBeInTheDocument();
    expect(screen.getByText(/Strava reads today \(as reported by Strava\): 900 of 3,000/)).toBeInTheDocument();
    expect(screen.getByText(/the app made 2,400 requests today/)).toBeInTheDocument();
    await u.click(screen.getByRole('button', { name: 'Fill now' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/admin/predictor/strava-cache/warm'))).toBe(true);
    });
  });

  it('starts tuning and asks the server to process it', async () => {
    const u = userEvent.setup();
    renderPanel();
    await u.click(await screen.findByRole('button', { name: 'Run tuning' }));
    await waitFor(() => {
      const urls = fetchMock.mock.calls.map(([url]) => String(url));
      expect(urls.some(url => url.endsWith('/admin/predictor/tune'))).toBe(true);
      expect(urls.some(url => url.endsWith('/admin/predictor/tune/new1/process'))).toBe(true);
    });
  });

  it('shows a running run and a failed run', async () => {
    tuneRuns = [{ runId: 'r9', createdAt: '2026-11-03T17:00:00Z', status: 'running' }];
    renderPanel();
    expect(await screen.findByText(/Running in the background/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Running…' })).toBeDisabled();
  });

  it('shows what the last Strava fetch did', async () => {
    renderPanel();
    expect(await screen.findByText(/of 70 eligible riders/)).toBeInTheDocument();
    expect(screen.queryByText(/riders an hour/)).not.toBeInTheDocument();
  });
});
