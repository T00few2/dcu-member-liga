import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LiveResultsView } from '@/components/live-race/LiveRaceResultsTable';
import type { Race, ResultEntry } from '@/types/live';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

vi.mock('@/hooks/queries', () => ({
    useRouteElevationQuery: () => ({ data: null }),
    useRaceSegmentsQuery: () => ({ data: [] }),
}));

function rider(overrides: Partial<ResultEntry>): ResultEntry {
    return {
        zwiftId: '0',
        name: 'Rider',
        finishTime: 3_600_000,
        finishRank: 1,
        finishPoints: 130,
        sprintPoints: 0,
        totalPoints: 130,
        raceStatus: 'FIN',
        ...overrides,
    };
}

const race: Race = {
    id: 'eckd',
    name: 'eCKD løbet',
    date: '2026-09-17T19:00',
    results: {
        '1. Division': [
            rider({ zwiftId: '2', name: 'Aleksej Calmann', finishRank: 9, finishPoints: 116, sprintPoints: 25, totalPoints: 141 }),
            rider({ zwiftId: '1', name: 'Sebastian Bech Rask', finishRank: 1, finishPoints: 130, sprintPoints: 19, totalPoints: 149 }),
        ],
    },
};

describe('LiveResultsView ranking', () => {
    it('numbers rows by points order, not finishRank', () => {
        const sorted: Race = {
            ...race,
            results: {
                '1. Division': [...(race.results?.['1. Division'] ?? [])].sort(
                    (a, b) => b.totalPoints - a.totalPoints,
                ),
            },
        };

        render(<LiveResultsView race={sorted} category="1. Division" isLive />);

        const rows = screen.getAllByRole('row').slice(1);
        expect(within(rows[0]).getByText('1')).toBeInTheDocument();
        expect(within(rows[0]).getByText('Sebastian Bech Rask')).toBeInTheDocument();
        expect(within(rows[1]).getByText('2')).toBeInTheDocument();
        expect(within(rows[1]).getByText('Aleksej Calmann')).toBeInTheDocument();
        expect(screen.queryByText('9')).not.toBeInTheDocument();
    });
});
