import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import CategoryPredictorData, { type PredictorDataStatus } from '@/components/admin/category-predictor/CategoryPredictorData';

const user = { getIdToken: vi.fn().mockResolvedValue('t') } as unknown as User;
let fetchMock: ReturnType<typeof vi.fn>;
let status: PredictorDataStatus;

const base: PredictorDataStatus = {
  days: 90, eligible: 601, cached: 519, noPowerData: 82, toFetchEligible: 6,
  others: 178, othersCached: 152, othersNoPower: 20, toFetchOthers: 12, noStrava: 40,
  remaining: 18, minEvalRiders: 40,
  league: {
    racesFinalized: 4, racesBuilt: 4, observations: 1233, withStrava: 661, weightBeforeRace: 0,
    usable: 116, usableRiders: 74, nextRecountAt: '2026-11-14T13:05:00+00:00', rebuildAfterHours: 6,
    riders: { total: 560, ready: 283, noStrava: 150, toFetch: 9, noPower: 70, awaitingRecount: 30, noRidesBeforeRace: 18 },
  },
  lastWarm: { at: '2026-11-14T11:21:57+00:00', warmed: 0, noPowerData: 10, failed: 0, rateLimited: false },
  stravaUsage: { usage15: 20, limit15: 300, usageDay: 325, limitDay: 3000, appRequestsDay: 15750,
    overallLimitDay: 6000, overallUsageDay: 325, refusedDay: 0, known: true, cacheBudgetFraction: 0.75 },
};

beforeEach(() => {
  status = structuredClone(base);
  fetchMock = vi.fn(async (url: string) => {
    if (String(url).endsWith('/admin/predictor/strava-cache/status')) {
      return new Response(JSON.stringify(status), { status: 200 });
    }
    return new Response('{}', { status: 200 });
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
      <CategoryPredictorData user={user} />
    </QueryClientProvider>,
  );
}

/** Cell texts of the table row whose first cell matches. */
function cells(rowLabel: RegExp) {
  const row = screen.getAllByRole('row').find(r => rowLabel.test(within(r).queryAllByRole('cell')[0]?.textContent ?? ''));
  if (!row) throw new Error(`No table row starts with ${rowLabel}`);
  return within(row).getAllByRole('cell').map(c => c.textContent);
}

describe('CategoryPredictorData', () => {
  it('shows Strava power per group of riders in a table', async () => {
    renderPanel();
    expect(await screen.findByRole('heading', { name: 'Data for the predictor' })).toBeInTheDocument();
    await screen.findByText('1. Strava power per rider');
    expect(cells(/^Reliable vELO/).slice(1)).toEqual(['601', '519', '82', '6']);
    expect(cells(/^No vELO or few Zwift rides/).slice(1)).toEqual(['178', '152', '20', '12']);
    expect(cells(/^Strava not connected.*Nothing to fetch/).slice(1)).toEqual(['40', '—', '—', '—']);
    expect(screen.getByText('18 riders queued')).toBeInTheDocument();
    expect(screen.getByText(/Fetching 18 riders: 10 every 15 minutes, automatically\./)).toHaveTextContent(
      '10 riders checked, 0 got a power curve');
  });

  it('says for every league rider whether the data is ready, coming, or cannot be had', async () => {
    renderPanel();
    await screen.findByText('2. League races as the right answer');
    expect(cells(/^Power from before the race is known/)).toEqual(['Power from before the race is known', '283', 'Ready']);
    expect(cells(/^Fetched from Strava, not counted yet/)[1]).toBe('30');
    expect(cells(/^Queued for a Strava fetch/)[1]).toBe('9');
    expect(cells(/^Strava connected, but no power rides/)[2]).toMatch(/Cannot be used/);
    expect(cells(/^Total$/)[1]).toBe('560');
    expect(screen.getByText('39 riders still coming')).toBeInTheDocument();
    expect(cells(/Usable as the right answer in tuning/)[1]).toBe('116 results from 74 riders');
    expect(cells(/^Results with power from before the race/)[1]).toBe('661 of 1,233');
  });

  it('fetches now while riders are queued, and says so when nothing is left', async () => {
    const u = userEvent.setup();
    const first = renderPanel();
    await u.click(await screen.findByRole('button', { name: 'Fetch 10 now' }));
    await waitFor(() => {
      expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/admin/predictor/strava-cache/warm'))).toBe(true);
    });
    first.unmount();

    status.remaining = 0;
    status.league!.riders = { ...status.league!.riders!, toFetch: 0, awaitingRecount: 0 };
    status.league!.nextRecountAt = null;
    renderPanel();
    expect(await screen.findByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('Complete')).toBeInTheDocument();
    expect(screen.getByText(/Nothing to fetch right now\./)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Fetch 10 now' })).not.toBeInTheDocument();
  });

  it('keeps the Strava API numbers in a closed details block', async () => {
    renderPanel();
    const summary = await screen.findByText('Strava API usage today');
    expect(summary.closest('details')).not.toHaveAttribute('open');
    expect(cells(/^Requests Strava refused/)[1]).toBe('0');
    expect(cells(/^All requests counted by Strava/)[1]).toBe('325 of 6,000');
  });
});
