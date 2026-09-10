import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UpcomingRaceCountdown from '@/components/live-race/UpcomingRaceCountdown';
import { getLiveRaceCategoryTabs, groupLiveRaceCategoryTabs } from '@/lib/live-race/categoryTabs';
import type { CurrentLiveRace } from '@/types/live';

vi.mock('@/lib/firebase', () => ({ app: {}, auth: {}, db: {}, storage: {} }));

vi.mock('@/hooks/queries', () => ({
    useRouteElevationQuery: () => ({ data: { leadInDistance: 1.1 } }),
    useRaceSegmentsQuery: () => ({ data: null }),
}));

vi.mock('@/components/races/RouteElevationChart', () => ({
    default: ({ laps, pointSegments }: { laps?: number; pointSegments?: { name?: string }[] }) => (
        <div data-testid="elevation-chart">
            laps:{laps} sprints:{(pointSegments ?? []).map((s) => s.name).join(',')}
        </div>
    ),
}));

const RACE = {
    id: 'eckd',
    name: 'eCKD løbet',
    map: 'PARIS',
    routeName: 'La Boucle',
    date: new Date(Date.now() + 7 * 86400000).toISOString(),
    laps: 2,
    // lead-in 1.1 + 2 laps of 16.666... km
    totalDistance: 34.433333,
    eventMode: 'grouped',
    raceGroups: [
        {
            name: 'High end',
            laps: 3,
            sprints: [{ id: 'high', name: 'Pont de Bir-Hakeim', count: 1 }],
            categories: [{ category: 'Diamond' }, { category: 'Ruby' }],
        },
        {
            name: 'Mid',
            categories: [{ category: 'Emerald' }, { category: 'Sapphire' }],
        },
        {
            name: 'Low end',
            categories: [{ category: 'Gold' }],
        },
    ],
} as unknown as CurrentLiveRace;

const tabs = getLiveRaceCategoryTabs(RACE);
const tabsByGroup = groupLiveRaceCategoryTabs(tabs);

function renderCountdown(cat: string, onSelectCategory = vi.fn()) {
    const activeTab = tabs.find((t) => t.cat === cat) ?? tabs[0];
    return {
        onSelectCategory,
        ...render(
            <UpcomingRaceCountdown
                race={RACE}
                tabsByGroup={tabsByGroup}
                activeCat={cat}
                activeTab={activeTab}
                onSelectCategory={onSelectCategory}
            />,
        ),
    };
}

describe('UpcomingRaceCountdown category picker', () => {
    it('lets the user pick a category and updates laps, distance, and sprints', async () => {
        const user = userEvent.setup();
        const { onSelectCategory, rerender } = renderCountdown('Diamond');

        expect(screen.getByRole('group', { name: 'Kategori' })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Diamond', pressed: true })).toBeInTheDocument();
        expect(screen.getByText(/3 omgange/)).toBeInTheDocument();
        expect(screen.getByText(/51\.1 km/)).toBeInTheDocument();
        expect(screen.getByTestId('elevation-chart')).toHaveTextContent('laps:3');
        expect(screen.getByTestId('elevation-chart')).toHaveTextContent('Pont de Bir-Hakeim');
        expect(screen.getByRole('button', { name: 'Live resultater · Diamond' })).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Gold' }));
        expect(onSelectCategory).toHaveBeenCalledWith('Gold');

        const goldTab = tabs.find((t) => t.cat === 'Gold');
        rerender(
            <UpcomingRaceCountdown
                race={RACE}
                tabsByGroup={tabsByGroup}
                activeCat="Gold"
                activeTab={goldTab}
                onSelectCategory={onSelectCategory}
            />,
        );

        expect(screen.getByRole('button', { name: 'Gold', pressed: true })).toBeInTheDocument();
        expect(screen.getByText(/2 omgange/)).toBeInTheDocument();
        expect(screen.getByText(/34\.4 km/)).toBeInTheDocument();
        expect(screen.getByTestId('elevation-chart')).toHaveTextContent('laps:2');
        expect(screen.getByRole('button', { name: 'Live resultater · Gold' })).toBeInTheDocument();
    });

    it('hides the picker when there is only one category', () => {
        const singleRace = {
            ...RACE,
            eventMode: 'single',
            raceGroups: undefined,
            singleModeCategories: [{ category: 'A', laps: 2 }],
        } as CurrentLiveRace;
        const singleTabs = getLiveRaceCategoryTabs(singleRace);
        render(
            <UpcomingRaceCountdown
                race={singleRace}
                tabsByGroup={groupLiveRaceCategoryTabs(singleTabs)}
                activeCat="A"
                activeTab={singleTabs[0]}
                onSelectCategory={vi.fn()}
            />,
        );
        expect(screen.queryByRole('group', { name: 'Kategori' })).not.toBeInTheDocument();
    });
});
