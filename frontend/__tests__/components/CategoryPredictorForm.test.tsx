import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import CategoryPredictorForm from '@/components/admin/category-predictor/CategoryPredictorForm';
import {
  EMPTY_POWER,
  EMPTY_PREDICTION,
  type ModelResult,
  type PredictionSnapshot,
} from '@/components/admin/category-predictor/shared';

const zwiftPred: PredictionSnapshot = {
  velo: 1200,
  category: 'Platinum',
  low: 1160,
  high: 1240,
  catLow: 'Platinum',
  catHigh: 'Platinum',
};

const stravaPred: PredictionSnapshot = {
  velo: 1320,
  category: 'Amethyst',
  low: 1280,
  high: 1360,
  catLow: 'Platinum',
  catHigh: 'Amethyst',
};

function renderForm(overrides: Partial<ComponentProps<typeof CategoryPredictorForm>> = {}) {
  const props: ComponentProps<typeof CategoryPredictorForm> = {
    participants: [
      {
        name: 'Ada',
        zwiftId: '42',
        weightInGrams: 70000,
        cp5s: 1000,
        cp1min: 400,
        cp5min: 300,
        cp20min: 250,
        racingScore: 500,
        max30Rating: 1100,
        ligaCategory: null,
      },
    ],
    selectedZwiftId: '42',
    onSelectRider: vi.fn(),
    showUnassignedOnly: false,
    onSetShowUnassignedOnly: vi.fn(),
    showMismatchOnly: false,
    onSetShowMismatchOnly: vi.fn(),
    loadingStrava: false,
    onLoadStrava: vi.fn(),
    stravaError: '',
    shared: { weightKg: 70, racingScore: 500 },
    onSetSharedInput: vi.fn(),
    zwiftPower: { wkg5s: 14, wkg1m: 6, wkg5m: 4.5, wkg20m: 4.0 },
    stravaPower: { wkg5s: 15, wkg1m: 6.2, wkg5m: 4.8, wkg20m: 4.4 },
    onSetPowerInput: vi.fn(),
    model: { coeffs: [0], r2: 1, rmse: 40, n: 10, activeFeatureKeys: ['wkg20m'], trainingPoints: [] },
    activeFeatureKeys: ['wkg20m'],
    zwiftPrediction: zwiftPred,
    stravaPrediction: stravaPred,
    actualVelo: 1100,
    assignChoice: 'zwift',
    onSetAssignChoice: vi.fn(),
    assigning: false,
    onAssign: vi.fn(),
    assignResult: null,
    assignError: '',
    ...overrides,
  };
  return { ...render(<CategoryPredictorForm {...props} />), props };
}

describe('CategoryPredictorForm dual-source columns', () => {
  it('shows Zwift and Strava columns with both predictions visible', () => {
    renderForm();

    expect(screen.getByText('Zwift')).toBeInTheDocument();
    expect(screen.getByText('Strava')).toBeInTheDocument();
    expect(screen.queryByText('Power source:')).not.toBeInTheDocument();

    expect(screen.getByText(zwiftPred.velo!.toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(stravaPred.velo!.toLocaleString())).toBeInTheDocument();
    expect(screen.getByText(/Strava is higher by 120 pts/)).toBeInTheDocument();
    expect(screen.getByText(/Amethyst vs Platinum/)).toBeInTheDocument();

    const assign = screen.getByLabelText('Assign as');
    expect(within(assign).getByRole('option', { name: 'Predicted Zwift (Platinum)' })).toBeInTheDocument();
    expect(within(assign).getByRole('option', { name: 'Predicted Strava (Amethyst)' })).toBeInTheDocument();
  });

  it('shows how many rides each power column is based on', () => {
    renderForm({ zwiftRideCount: 12, stravaRideCount: 1 });

    expect(screen.getByText(/12 rides/)).toBeInTheDocument();
    expect(screen.getByText(/1 ride(?!s)/)).toBeInTheDocument();
  });

  it('keeps Load in the Strava column and does not require a source toggle', async () => {
    const user = userEvent.setup();
    const { props } = renderForm({ stravaPrediction: EMPTY_PREDICTION, stravaPower: EMPTY_POWER });

    const load = screen.getByRole('button', { name: 'Load' });
    await user.click(load);
    expect(props.onLoadStrava).toHaveBeenCalledOnce();
  });

  it('only shows input rows for the currently selected regressors', () => {
    renderForm({ activeFeatureKeys: ['weight_kg', 'wkg1m', 'wkg20m', 'compound5m'] });

    expect(screen.getByText('Weight (kg)')).toBeInTheDocument();
    expect(screen.queryByText('ZRS')).not.toBeInTheDocument();
    expect(screen.queryByText('5s W/kg')).not.toBeInTheDocument();
    expect(screen.getByText('1min W/kg')).toBeInTheDocument();
    expect(screen.getByText('5min W/kg')).toBeInTheDocument();
    expect(screen.getByText('20min W/kg')).toBeInTheDocument();
    expect(screen.getByText('5m²/kg (auto)')).toBeInTheDocument();
    expect(screen.getByText(/Using current model: Weight \(kg\), 1min W\/kg, 20min W\/kg, 5m²\/kg/)).toBeInTheDocument();
  });

  it('shows derived watts rows when those regressors are checked', () => {
    renderForm({
      activeFeatureKeys: ['weight_kg', 'wkg5s', 'watts5s', 'compound5s'],
    });

    expect(screen.getByText('5s W/kg')).toBeInTheDocument();
    expect(screen.getByText('5s watts (auto)')).toBeInTheDocument();
    expect(screen.getByText('5s²/kg (auto)')).toBeInTheDocument();
    expect(screen.queryByText('20min W/kg')).not.toBeInTheDocument();
  });

  it('shows ZRS when that regressor is checked', () => {
    renderForm({ activeFeatureKeys: ['zrs'] });

    expect(screen.getByText('ZRS')).toBeInTheDocument();
    expect(screen.queryByText('20min W/kg')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load' })).not.toBeInTheDocument();
  });

  it('can filter the rider list to predicted vs vELO category mismatches', () => {
    const mismatchModel: ModelResult = {
      coeffs: [0, 300],
      r2: 1,
      rmse: 10,
      n: 10,
      activeFeatureKeys: ['wkg20m'],
      trainingPoints: [],
    };
    const base = {
      weightInGrams: 70000,
      cp5s: 1000,
      cp1min: 400,
      cp5min: 300,
      cp20min: 280,
      racingScore: 500,
      ligaCategory: null,
    };
    renderForm({
      model: mismatchModel,
      activeFeatureKeys: ['wkg20m'],
      selectedZwiftId: '',
      showMismatchOnly: true,
      participants: [
        { ...base, name: 'Match', zwiftId: '1', max30Rating: 1200 },
        { ...base, name: 'Mismatch', zwiftId: '2', max30Rating: 900 },
      ],
    });

    const riderSelect = screen.getByLabelText('Rider');
    expect(riderSelect).toHaveTextContent('Mismatch');
    expect(riderSelect).toHaveTextContent('vELO Silver ≠ Platinum');
    expect(riderSelect).not.toHaveTextContent('Match');
  });
});
