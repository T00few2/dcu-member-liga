import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from 'firebase/auth';
import { FEATURE_META } from '../helpers/predictorFeatures';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('@/components/admin/category-predictor/CategoryPredictorTuning', () => ({ default: () => null }));

const features = Object.fromEntries(FEATURE_META.map(f => [f.key, f.key === 'wkg20m']));
const ada = {
  name: 'Ada', zwiftId: '42', weightInGrams: 70000, cp5s: 1000, cp1min: 400, cp5min: 300, cp20min: 280,
  racingScore: 500, max30Rating: 'N/A', rating: 0, ligaCategory: null,
};
const platinum = {
  velo: 1280, category: 'Platinum', low: 1240, high: 1320, catLow: 'Platinum', catHigh: 'Amethyst', confidence: 'medium',
};

const predictionsResult = { data: {} as Record<string, unknown>, isPlaceholderData: false };

vi.mock('@/hooks/queries', () => ({
  useParticipantsQuery: () => ({ data: [ada], isLoading: false }),
  useLeagueSettingsQuery: () => ({ data: undefined }),
  usePredictorConfigQuery: () => ({
    data: { config: { features, stravaWindowDays: 90 }, metrics: null, history: [], updatedAt: 't1' },
  }),
  usePredictorModelQuery: () => ({
    data: {
      model: { coeffs: [0, 320], r2: 1, rmse: 40, n: 10, activeFeatureKeys: ['wkg20m'], trainingPoints: [] },
      config: { features }, defaultFeatures: features, features: FEATURE_META, predictions: { '42': platinum },
    },
    isLoading: false,
    isPlaceholderData: false,
    error: null,
  }),
  usePredictionsQuery: (rows: { id: string }[]) =>
    rows.some(r => r.id === 'zwift') ? predictionsResult : { data: {}, isPlaceholderData: false },
  useDebouncedValue: <T,>(value: T) => value,
}));

import CategoryPredictor from '@/components/admin/CategoryPredictor';

function renderPage() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <CategoryPredictor user={{ getIdToken: vi.fn() } as unknown as User} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  predictionsResult.data = {};
  predictionsResult.isPlaceholderData = false;
});

describe('CategoryPredictor form predictions', () => {
  it('offers the backend prediction for the inputs on screen', async () => {
    predictionsResult.data = { zwift: platinum, strava: { ...platinum, velo: null, category: null } };
    renderPage();
    await userEvent.setup().selectOptions(screen.getByLabelText('Rider'), '42');
    expect(screen.getByRole('button', { name: 'Assign to Platinum' })).toBeEnabled();
  });

  it('does not offer a previous result while the new one is loading', async () => {
    // keepPreviousData: the hook still returns the last rider's numbers, flagged as placeholder.
    predictionsResult.data = { zwift: { ...platinum, velo: 1900, category: 'Ruby' } };
    predictionsResult.isPlaceholderData = true;
    renderPage();
    await userEvent.setup().selectOptions(screen.getByLabelText('Rider'), '42');
    expect(screen.queryByText('Ruby', { selector: 'span' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Assign to/ })).toBeDisabled();
  });
});
