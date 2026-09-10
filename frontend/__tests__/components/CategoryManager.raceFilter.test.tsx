import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

const refetchRiders = vi.fn();
const useLigaCategoriesQuery = vi.fn();
const useLeagueSettingsQuery = vi.fn();
const useRacesQuery = vi.fn();
const useRaceSignupsQuery = vi.fn();

vi.mock('@/lib/auth-context', () => ({
  useAuth: () => ({ user: { getIdToken: async () => 'token' } }),
}));

vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));

vi.mock('@/hooks/queries/useLigaCategoriesQuery', () => ({
  useLigaCategoriesQuery: () => useLigaCategoriesQuery(),
}));

vi.mock('@/hooks/queries/useLeagueSettingsQuery', () => ({
  useLeagueSettingsQuery: () => useLeagueSettingsQuery(),
}));

vi.mock('@/hooks/queries', () => ({
  useRacesQuery: () => useRacesQuery(),
  useRaceSignupsQuery: (raceId: string | null) => useRaceSignupsQuery(raceId),
}));

vi.mock('@/hooks/queries/useStreamRidersQuery', () => ({
  useStreamRidersQuery: () => ({ data: [], isFetching: false }),
  useAddStreamRiderMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useRemoveStreamRiderMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

const { default: CategoryManager } = await import('@/components/admin/CategoryManager');

const RIDERS = [
  {
    zwiftId: '1',
    name: 'Ada Lovelace',
    club: 'Analytical Club',
    currentRating: 1400,
    max30Rating: 1410,
    max90Rating: 1420,
    effectiveRating: 1410,
    ligaCategory: {
      category: 'Platinum',
      upperBoundary: 1450,
      graceLimit: 1485,
      assignedRating: 1400,
      status: 'ok' as const,
      lastCheckedRating: 1410,
    },
  },
  {
    zwiftId: '2',
    name: 'Grace Hopper',
    club: 'Navy CC',
    currentRating: 1800,
    max30Rating: 1810,
    max90Rating: 1820,
    effectiveRating: 1810,
    ligaCategory: {
      category: 'Emerald',
      upperBoundary: 1900,
      graceLimit: 1935,
      assignedRating: 1800,
      status: 'ok' as const,
      lastCheckedRating: 1810,
    },
  },
];

describe('CategoryManager race signup filter', () => {
  beforeEach(() => {
    useLigaCategoriesQuery.mockReturnValue({
      data: RIDERS,
      isFetching: false,
      refetch: refetchRiders,
    });
    useLeagueSettingsQuery.mockReturnValue({ data: { gracePeriod: 35, ligaCategories: [] } });
    useRacesQuery.mockReturnValue({
      isLoading: false,
      data: [
        {
          id: 'race-1',
          name: 'Opening Race',
          date: '2026-09-10T10:00:00Z',
          preRegisterAllowed: true,
        },
      ],
    });
    useRaceSignupsQuery.mockImplementation((raceId: string | null) => ({
      isLoading: false,
      data: raceId === 'race-1' ? [{ zwiftId: '2', name: 'Grace Hopper' }] : [],
    }));
  });

  it('defaults to all participants and can filter to a race', async () => {
    const user = userEvent.setup();
    render(<CategoryManager />);

    expect(screen.getByLabelText('Signed up for')).toBeInTheDocument();
    expect(screen.getByText('2 registered participants')).toBeInTheDocument();
    expect(screen.getByText('Ada Lovelace')).toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Stream riders' })).not.toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText('Signed up for'), 'race-1');

    expect(screen.getByRole('heading', { name: 'Stream riders' })).toBeInTheDocument();
    expect(screen.getByText('1 signed up for Opening Race')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
    expect(screen.getByText('Riders (1 assigned)')).toBeInTheDocument();
    expect(screen.getByLabelText('Name for category 3').closest('tr')).toHaveTextContent('1 (100%)');
  });

  it('shows assigned category counts rather than current vELO buckets', () => {
    useLigaCategoriesQuery.mockReturnValue({
      data: [
        {
          ...RIDERS[0],
          effectiveRating: 2300,
          ligaCategory: {
            ...RIDERS[0].ligaCategory,
            category: 'Platinum',
            manualAssignedCategory: 'Platinum',
          },
        },
        RIDERS[1],
      ],
      isFetching: false,
      refetch: refetchRiders,
    });

    render(<CategoryManager />);

    expect(screen.getByText('Riders (2 assigned)')).toBeInTheDocument();
    expect(screen.getByLabelText('Name for category 1').closest('tr')).toHaveTextContent('0 (0%)');
    expect(screen.getByLabelText('Name for category 6').closest('tr')).toHaveTextContent('1 (50%)');
    expect(screen.getByLabelText('Name for category 3').closest('tr')).toHaveTextContent('1 (50%)');
  });

  it('Assign posts an empty body and is disabled while the editor is dirty', async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ assigned: 1, skipped: 0 }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    vi.spyOn(window, 'alert').mockImplementation(() => {});

    render(<CategoryManager />);
    const assignBtn = screen.getByRole('button', { name: 'Assign Liga Categories' });
    expect(assignBtn).toBeEnabled();

    await user.click(assignBtn);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/admin/assign-liga-categories'),
      expect.objectContaining({ body: JSON.stringify({}) }),
    );

    await user.click(screen.getByRole('button', { name: 'Load ZR Defaults' }));
    expect(assignBtn).toBeDisabled();
  });
});
