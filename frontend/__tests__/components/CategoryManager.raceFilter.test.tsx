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
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
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

    await user.selectOptions(screen.getByLabelText('Signed up for'), 'race-1');

    expect(screen.getByText('1 signed up for Opening Race')).toBeInTheDocument();
    expect(screen.queryByText('Ada Lovelace')).not.toBeInTheDocument();
    expect(screen.getByText('Grace Hopper')).toBeInTheDocument();
  });
});
