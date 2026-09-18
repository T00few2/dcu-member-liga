import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import { LiveResultsView } from '@/components/live-race/LiveRaceResultsTable';
import type { Race, ResultEntry } from '@/types/live';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

vi.mock('@/hooks/queries', () => ({
    useRouteElevationQuery: () => ({ data: null }),
    useRaceSegmentsQuery: () => ({ data: [] }),
    useRegisteredClubsQuery: () => ({ data: { '1': 'Danish Zwift Racers' } }),
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

    it('shows club from registered riders when the result row has none', () => {
        render(<LiveResultsView race={race} category="1. Division" isLive />);
        expect(screen.getByText('Danish Zwift Racers')).toBeInTheDocument();
    });

    it('shows club from the result row when live riders are gone', () => {
        const withClub: Race = {
            ...race,
            results: {
                '1. Division': [
                    rider({ zwiftId: '1', name: 'Sebastian Bech Rask', club: 'Danish Zwift Racers' }),
                ],
            },
        };
        render(<LiveResultsView race={withClub} category="1. Division" isLive />);
        expect(screen.getByText('Danish Zwift Racers')).toBeInTheDocument();
    });

    it('shows configured Champs-Élysées columns even without sprintDetails', () => {
        const withSprints: Race = {
            ...race,
            eventMode: 'grouped',
            raceGroups: [
                {
                    id: 'g1',
                    name: 'High end',
                    eventId: 'evt-1',
                    categories: [{ category: '1. Division' }],
                    sprints: [
                        { id: '1055881124', count: 1, name: 'Montmartre KOM', key: '1055881124_1', direction: 'forward', lap: 1 },
                        { id: '1056322864', count: 1, name: 'Champs-Élysées', key: '1056322864_1', direction: 'forward', lap: 1 },
                        { id: '1056322864', count: 2, name: 'Champs-Élysées', key: '1056322864_2', direction: 'forward', lap: 2 },
                    ],
                },
            ],
        };
        render(<LiveResultsView race={withSprints} category="1. Division" isLive />);
        expect(screen.getByText(/Champs-Élysées #1/i)).toBeInTheDocument();
        expect(screen.getByText(/Champs-Élysées #2/i)).toBeInTheDocument();
    });
});
