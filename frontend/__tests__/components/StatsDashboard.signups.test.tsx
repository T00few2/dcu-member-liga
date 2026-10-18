import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Race } from '@/types/live';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

const useAdminStatsQuery = vi.fn();
const useRacesQuery = vi.fn();
vi.mock('@/hooks/queries', () => ({
    useAdminStatsQuery: () => useAdminStatsQuery(),
    useRacesQuery: () => useRacesQuery(),
}));

const { default: StatsDashboard } = await import('@/components/admin/StatsDashboard');

function race(partial: Partial<Race> & Pick<Race, 'id' | 'name'>): Race {
    return {
        date: '2026-09-10T10:00:00Z',
        preRegisterAllowed: true,
        ...partial,
    } as Race;
}

const STATS = {
    total: 4,
    clubCount: 2,
    lockedCount: 0,
    selfSelectedCount: 0,
    growthSeries: [
        { date: '2026-04-03', signups: 2, clubs: 1 },
        { date: '2026-04-10', signups: 4, clubs: 2 },
    ],
    raceGrowth: [
        {
            raceId: 'r1',
            series: [
                { date: '2026-09-01', signups: 2, clubs: 2 },
                { date: '2026-09-08', signups: 3, clubs: 2 },
            ],
        },
    ],
    registrationStatus: [{ status: 'complete', count: 4 }],
    categoryDistribution: [],
    clubDistribution: [],
    trainerDistribution: [],
    trainerByCategory: [],
    dualRecordingDistribution: [],
    dualRecordingByCategory: [],
    verificationStatus: [],
    phenotypeDistribution: [],
};

describe('StatsDashboard signup growth', () => {
    it('switches the growth chart between total signups and one race', async () => {
        const user = userEvent.setup();
        useAdminStatsQuery.mockReturnValue({ isLoading: false, isError: false, data: STATS });
        useRacesQuery.mockReturnValue({
            data: [
                race({ id: 'r1', name: 'Race One' }),
                race({ id: 'r2', name: 'Race Two' }),
                race({ id: 'hidden', name: 'No signup', preRegisterAllowed: false, eventId: undefined }),
            ],
            isLoading: false,
        });

        render(<StatsDashboard />);

        const select = screen.getByLabelText('Signed up for');
        expect(screen.getByRole('option', { name: 'Total signups' })).toBeInTheDocument();
        expect(screen.getByRole('option', { name: 'Race One' })).toBeInTheDocument();
        expect(screen.queryByRole('option', { name: 'No signup' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Race One ·/)).not.toBeInTheDocument();

        await user.selectOptions(select, 'r1');
        expect(screen.getByText('Race One · 3 signups · 2 clubs')).toBeInTheDocument();

        await user.selectOptions(select, 'r2');
        expect(screen.getByText('No signups for this race yet.')).toBeInTheDocument();

        await user.selectOptions(select, '');
        expect(screen.queryByText(/signups ·/)).not.toBeInTheDocument();
        expect(screen.queryByText('No signups for this race yet.')).not.toBeInTheDocument();
    });
});
