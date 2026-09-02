import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import CategoryPredictorRoster from '@/components/admin/category-predictor/CategoryPredictorRoster';
import { EMPTY_POWER, type ModelResult, type Participant } from '@/components/admin/category-predictor/shared';

const MODEL: ModelResult = {
  coeffs: [0, 320],
  r2: 1,
  rmse: 40,
  n: 10,
  activeFeatureKeys: ['wkg20m'],
  trainingPoints: [],
};

const ada: Participant = {
  name: 'Ada',
  zwiftId: '1',
  weightInGrams: 70000,
  cp5s: 1000,
  cp1min: 400,
  cp5min: 300,
  cp20min: 280,
  racingScore: 500,
  max30Rating: 1100,
  ligaCategory: null,
};

function renderRoster(overrides: Partial<ComponentProps<typeof CategoryPredictorRoster>> = {}) {
  const props: ComponentProps<typeof CategoryPredictorRoster> = {
    riders: [ada],
    model: MODEL,
    selectedZwiftId: '',
    onSelectRider: vi.fn(),
    showUnassignedOnly: false,
    onSetShowUnassignedOnly: vi.fn(),
    showMismatchOnly: false,
    onSetShowMismatchOnly: vi.fn(),
    stravaByRider: {},
    loadingStravaIds: {},
    bulkStravaProgress: null,
    onLoadStrava: vi.fn(),
    onLoadStravaAll: vi.fn(),
    assignedOverlay: {},
    assigningZwiftId: null,
    assignErrors: {},
    onAssign: vi.fn(),
    ...overrides,
  };
  return { ...render(<CategoryPredictorRoster {...props} />), props };
}

describe('CategoryPredictorRoster', () => {
  it('lists riders with vELO category and Zwift lower/upper bounds', () => {
    renderRoster();

    expect(screen.getByRole('button', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'vELO' })).toBeInTheDocument();
    expect(screen.getAllByText('Gold').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Platinum').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Amethyst').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument();
    expect(within(screen.getByLabelText('Assign Ada')).getByRole('option', { name: 'Zwift (Platinum)' })).toBeInTheDocument();
  });

  it('populates Strava bounds only after a load', () => {
    renderRoster({
      stravaByRider: {
        '1': { power: { ...EMPTY_POWER, wkg20m: 4.4 }, activityCount: 8 },
      },
    });

    expect(screen.queryByRole('button', { name: 'Load' })).not.toBeInTheDocument();
    const assign = screen.getByLabelText('Assign Ada');
    expect(within(assign).getByRole('option', { name: /Strava \(Amethyst\)/ })).toBeInTheDocument();
  });

  it('assigns from the row control', async () => {
    const user = userEvent.setup();
    const { props } = renderRoster();

    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(props.onAssign).toHaveBeenCalledWith('1', 'zwift');
  });

  it('loads Strava for all visible riders', async () => {
    const user = userEvent.setup();
    const { props } = renderRoster();

    await user.click(screen.getByRole('button', { name: 'Load Strava (1)' }));
    expect(props.onLoadStravaAll).toHaveBeenCalledOnce();
  });
});
