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
    best: { score: score(61), config: { stravaWindowDays: 180 } },
    improvementPP: 9,
    changedRiders: [{ zwiftId: '7', realCategory: 'Gold', before: 'Silver', after: 'Gold' }],
    pastPredictions: { n: 0 },
    message: 'New settings improve Strava→division accuracy by 9 pp.',
  },
};

const user = { getIdToken: vi.fn().mockResolvedValue('t') } as unknown as User;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/admin/predictor/tune/runs')) {
      return new Response(JSON.stringify({ runs: [pendingRun] }), { status: 200 });
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
});
