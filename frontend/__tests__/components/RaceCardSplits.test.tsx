import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RaceCard from '@/components/races/RaceCard';
import type { Race } from '@/types/live';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('@/lib/auth-context', () => ({
    useAuth: () => ({ user: { uid: 'rider' }, isRegistered: true }),
}));
vi.mock('@/hooks/queries', () => ({
    useRouteElevationQuery: () => ({
        data: {
            leadInDistance: 0.3,
            distance: [0, 16200],
            altitude: [10, 20],
            profileSegments: [
                { name: 'SPRINT', type: 'sprint', fromKm: 0.2, toKm: 0.4 },
            ],
        },
    }),
    useRaceSegmentsQuery: () => ({ data: [] }),
    useMyRaceSignupsQuery: () => ({ data: {} }),
    useRaceSignupCountsQuery: () => ({ data: {}, isLoading: false }),
}));
vi.mock('@/components/races/RouteElevationChart', () => ({
    default: () => <div data-testid="elevation-chart" />,
}));

const stage1 = {
    id: 'stage-1',
    name: 'Stage 1',
    date: '2026-11-04T18:00:00.000Z',
    map: 'RICHMOND',
    routeName: 'Richmond UCI Worlds',
    routeId: '2196019512',
    type: 'time-trial',
    segmentType: 'split',
    eventMode: 'grouped',
    laps: 1,
    totalDistance: 16.5,
    totalElevation: 160,
    sprints: [],
    selectedSegments: [],
    raceGroups: [
        {
            name: 'Division 1-3',
            segmentType: 'split',
            sprints: [
                { id: '5338791988', key: '5338791988_1', name: 'SPRINT', count: 1, lap: 1 },
                { id: '13937662126', key: '13937662126_1', name: 'BROAD ST.', count: 1, lap: 1 },
            ],
            categories: [{ category: 'A' }],
        },
    ],
} as Race;

function renderCard(race: Race) {
    const client = new QueryClient();
    return render(
        <QueryClientProvider client={client}>
            <RaceCard race={race} leagueSettings={{ finishPoints: [10], sprintPoints: [5], bestRacesCount: 5 }} />
        </QueryClientProvider>,
    );
}

describe('RaceCard time trial labels', () => {
    it('labels split banners as split times and hides the points pie', () => {
        renderCard(stage1);
        expect(screen.getByText('Splittid')).toBeInTheDocument();
        expect(screen.getByText('Splittider')).toBeInTheDocument();
        expect(screen.queryByText('Pointspurt')).not.toBeInTheDocument();
        expect(screen.queryByText('Pointsprint')).not.toBeInTheDocument();
        expect(screen.queryByText('Pointfordeling')).not.toBeInTheDocument();
        expect(screen.getByText('SPRINT')).toBeInTheDocument();
        expect(screen.getByText('BROAD ST.')).toBeInTheDocument();
    });

    it('keeps the points labels on a points race', () => {
        renderCard({
            ...stage1,
            type: 'points',
            segmentType: 'sprint',
            raceGroups: [{
                ...stage1.raceGroups![0],
                segmentType: 'sprint',
            }],
        });
        expect(screen.getByText('Pointspurt')).toBeInTheDocument();
        expect(screen.getByText('Pointsprint')).toBeInTheDocument();
        expect(screen.getByText('Pointfordeling')).toBeInTheDocument();
    });
});
