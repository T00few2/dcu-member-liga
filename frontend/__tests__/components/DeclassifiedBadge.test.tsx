import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import RaceResultsTable from '@/app/results/_components/RaceResultsTable';
import { LiveResultsView } from '@/components/live-race/LiveRaceResultsTable';
import type { Race, ResultEntry } from '@/types/live';
import { isRiderDeclassified } from '@/components/DeclassifiedBadge';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));
vi.mock('@/components/DualRecordingResultModal', () => ({ default: () => null }));
vi.mock('@/hooks/queries', () => ({
    useRouteElevationQuery: () => ({ data: null }),
    useRaceSegmentsQuery: () => ({ data: [] }),
    useRegisteredClubsQuery: () => ({ data: {} }),
}));

function rider(overrides: Partial<ResultEntry> = {}): ResultEntry {
    return {
        zwiftId: '1',
        name: 'Winner',
        finishTime: 3_600_000,
        finishRank: 1,
        finishPoints: 130,
        sprintPoints: 0,
        totalPoints: 130,
        raceStatus: 'FIN',
        ...overrides,
    };
}

function race(overrides: Partial<Race> = {}): Race {
    return {
        id: 'eckd',
        name: 'eCKD løbet',
        date: '2026-09-17T19:00',
        results: {
            '1. Division': [
                rider(),
                rider({ zwiftId: '2', name: 'Declassed Rider', finishRank: 2, finishPoints: 50, totalPoints: 50 }),
            ],
        },
        ...overrides,
    };
}

describe('isRiderDeclassified', () => {
    it('matches race list or rider flag', () => {
        expect(isRiderDeclassified('2', { manualDeclassifications: ['2'] })).toBe(true);
        expect(isRiderDeclassified('2', { manualDeclassifications: [] }, { declassified: true })).toBe(true);
        expect(isRiderDeclassified('2', { manualDeclassifications: ['1'] })).toBe(false);
    });
});

describe('RaceResultsTable declassified badge', () => {
    it('shows a DC badge next to declassified riders only', () => {
        const selected = race({ manualDeclassifications: ['2'] });
        render(
            <RaceResultsTable
                races={[selected]}
                selectedRaceId="eckd"
                setSelectedRaceId={() => undefined}
                selectedRace={selected}
                availableRaceCategories={['1. Division']}
                displayRaceCategory="1. Division"
                selectedCategory="1. Division"
                setSelectedCategory={() => undefined}
                displayLaps={3}
                raceResults={selected.results!['1. Division']}
                sprintColumns={[]}
                bestSplitTimes={{}}
                getSprintHeader={(key) => key}
            />,
        );

        const rows = screen.getAllByRole('row').slice(1);
        expect(within(rows[0]).queryByLabelText('Deklasseret')).not.toBeInTheDocument();
        expect(within(rows[1]).getByLabelText('Deklasseret')).toHaveTextContent('DC');
        expect(within(rows[1]).getByText('Declassed Rider')).toBeInTheDocument();
    });
});

describe('LiveResultsView declassified badge', () => {
    it('shows DC from the race declassification list', () => {
        render(
            <LiveResultsView
                race={race({ manualDeclassifications: ['2'] })}
                category="1. Division"
                isLive
            />,
        );
        expect(screen.getByLabelText('Deklasseret')).toHaveTextContent('DC');
    });
});
