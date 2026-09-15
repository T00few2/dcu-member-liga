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
  rating: 1050,
  max30Rating: 1100,
  ligaCategory: null,
  zwiftActivityCount: 12,
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
    showZeroVeloOnly: false,
    onSetShowZeroVeloOnly: vi.fn(),
    showNo30dVeloOnly: false,
    onSetShowNo30dVeloOnly: vi.fn(),
    stravaByRider: {},
    loadingStravaIds: {},
    bulkStravaProgress: null,
    onLoadStrava: vi.fn(),
    onLoadStravaAll: vi.fn(),
    assignedOverlay: {},
    assigningZwiftId: null,
    assignErrors: {},
    onAssign: vi.fn(),
    onRelease: vi.fn(),
    ...overrides,
  };
  return { ...render(<CategoryPredictorRoster {...props} />), props };
}

describe('CategoryPredictorRoster', () => {
  it('lists riders with current vELO, 30d max, category, and Zwift bounds', () => {
    renderRoster({
      riders: [{ ...ada, ligaCategory: { category: 'Gold' } }],
    });

    expect(screen.getByRole('button', { name: 'Ada' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Current' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: '30d max' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'ZRS' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Category' })).toBeInTheDocument();
    expect(screen.getByLabelText('Category for Ada')).toHaveValue('Gold');
    const row = screen.getByRole('button', { name: 'Ada' }).closest('tr');
    expect(row).toBeTruthy();
    const cells = within(row!).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('1050');
    expect(cells[2]).toHaveTextContent('1100');
    expect(cells[3]).toHaveTextContent('500');
    expect(screen.getAllByText('Gold').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Platinum').length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText('Amethyst').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Load' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader', { name: 'Rides' })).toHaveLength(2);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Assign as' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Assign' })).toBeInTheDocument();
    expect(screen.getByRole('columnheader', { name: 'Release' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Release' })).not.toBeInTheDocument();
  });

  it('shows Release only for manually assigned riders', async () => {
    const user = userEvent.setup();
    const { props } = renderRoster({
      riders: [{
        ...ada,
        ligaCategory: { category: 'Platinum', manualAssignedCategory: 'Platinum' },
      }],
    });

    await user.click(screen.getByRole('button', { name: 'Release' }));
    expect(props.onRelease).toHaveBeenCalledWith('1', 'Ada');
  });

  it('populates Strava bounds only after a load', () => {
    renderRoster({
      stravaByRider: {
        '1': { power: { ...EMPTY_POWER, wkg20m: 4.4 }, activityCount: 8 },
      },
    });

    expect(screen.queryByRole('button', { name: 'Load' })).not.toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
    const assign = screen.getByLabelText('Assign Ada');
    expect(within(assign).getByRole('option', { name: /Strava \(Amethyst\)/ })).toBeInTheDocument();
  });

  it('assigns a category from the Category dropdown', async () => {
    const user = userEvent.setup();
    const { props } = renderRoster();

    await user.selectOptions(screen.getByLabelText('Category for Ada'), 'Gold');
    expect(props.onAssign).toHaveBeenCalledWith('1', 'Gold');
  });

  it('assigns from the row control', async () => {
    const user = userEvent.setup();
    const { props } = renderRoster();

    await user.click(screen.getByRole('button', { name: 'Assign' }));
    expect(props.onAssign).toHaveBeenCalledWith('1', 'zwift');
  });

  it('lets you select a rider with vELO 0', async () => {
    const user = userEvent.setup();
    const zeroVelo: Participant = { ...ada, name: 'Bea', zwiftId: '9', rating: 0 };
    const { props } = renderRoster({ riders: [zeroVelo] });

    expect(screen.getByText('0')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Bea' }));
    expect(props.onSelectRider).toHaveBeenCalledWith('9');
  });

  it('loads Strava for all visible riders', async () => {
    const user = userEvent.setup();
    const { props } = renderRoster();

    await user.click(screen.getByRole('button', { name: 'Load Strava (1)' }));
    expect(props.onLoadStravaAll).toHaveBeenCalledOnce();
  });
});
