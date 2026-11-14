import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RaceCard from '@/components/races/RaceCard';
import type { Race } from '@/types/live';

const profile = vi.hoisted(() => ({ method: 'strava' }));

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('@/lib/auth-context', () => ({
    useAuth: () => ({ user: { uid: 'rider', getIdToken: async () => 'token' }, isRegistered: true }),
}));
vi.mock('@/hooks/queries', () => ({
    useRouteElevationQuery: () => ({ data: null }),
    useRaceSegmentsQuery: () => ({ data: [] }),
    useMyRaceSignupsQuery: () => ({ data: { 'race-1': { status: 'registered' } } }),
    useRaceSignupCountsQuery: () => ({ data: {}, isLoading: false }),
}));
vi.mock('@/hooks/queries/useProfileQuery', () => ({
    useProfileQuery: () => ({ data: { dualRecordingMethod: profile.method } }),
}));
vi.mock('@/lib/dualRecording/window', async () => {
    const actual = await vi.importActual<typeof import('@/lib/dualRecording/window')>('@/lib/dualRecording/window');
    return { ...actual, browserCanRecord: () => true };
});
vi.mock('@/components/races/RouteElevationChart', () => ({ default: () => null }));

const race = {
    id: 'race-1',
    name: 'Aftenløb',
    date: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    preRegisterAllowed: true,
    laps: 1,
} as Race;

function renderCard() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
        <QueryClientProvider client={client}>
            <RaceCard race={race} leagueSettings={{ finishPoints: [10], sprintPoints: [5], bestRacesCount: 5 }} />
        </QueryClientProvider>,
    );
}

describe('RaceCard dual recorder', () => {
    it('stays quiet when the rider uses Strava', () => {
        profile.method = 'strava';
        renderCard();
        expect(screen.queryByRole('link', { name: 'Optag dual' })).toBeNull();
    });

    it('stays quiet when the rider uploads a file', () => {
        profile.method = 'upload';
        renderCard();
        expect(screen.queryByRole('link', { name: 'Optag dual' })).toBeNull();
    });

    it('opens the recorder when that is the profile choice', async () => {
        profile.method = 'direct';
        renderCard();
        expect(await screen.findByRole('link', { name: 'Optag dual' })).toHaveAttribute('href', '/dual-record/race-1');
    });
});
