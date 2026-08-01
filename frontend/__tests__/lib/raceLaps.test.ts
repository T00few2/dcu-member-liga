import { describe, it, expect } from 'vitest';
import { formatOmgangeDisplay, getAllLapsValues } from '@/lib/raceLaps';
import type { Race } from '@/types/live';

describe('getAllLapsValues', () => {
    it('inherits race.laps for grouped categories with null group/category laps', () => {
        // eCKD / La Boucle shape: High end overrides to 3; Mid/Low inherit race.laps = 2
        const race = {
            eventMode: 'grouped',
            laps: 2,
            raceGroups: [
                {
                    name: 'High end',
                    laps: 3,
                    categories: [
                        { category: 'Diamond', laps: null },
                        { category: 'Ruby', laps: null },
                    ],
                },
                {
                    name: 'Mid',
                    laps: null,
                    categories: [
                        { category: 'Emerald', laps: null },
                        { category: 'Sapphire', laps: null },
                    ],
                },
                {
                    name: 'Low end',
                    laps: null,
                    categories: [{ category: 'Gold', laps: null }],
                },
            ],
        } as unknown as Race;

        expect(getAllLapsValues(race)).toEqual([3, 2]);
    });

    it('uses category override over group and race laps', () => {
        const race = {
            eventMode: 'grouped',
            laps: 2,
            raceGroups: [
                {
                    name: 'High end',
                    laps: 3,
                    categories: [
                        { category: 'Diamond', laps: 4 },
                        { category: 'Ruby', laps: null },
                    ],
                },
            ],
        } as unknown as Race;

        expect(getAllLapsValues(race)).toEqual([4, 3]);
    });

    it('falls back to race.laps for multi when category laps omitted', () => {
        const race = {
            eventMode: 'multi',
            laps: 2,
            eventConfiguration: [
                { category: 'A', laps: 3 },
                { category: 'B' },
            ],
        } as unknown as Race;

        expect(getAllLapsValues(race)).toEqual([3, 2]);
    });
});

describe('formatOmgangeDisplay', () => {
    const race = {
        eventMode: 'grouped',
        laps: 2,
        raceGroups: [
            {
                name: 'High end',
                laps: 3,
                categories: [{ category: 'Diamond', laps: null }],
            },
            {
                name: 'Mid',
                laps: null,
                categories: [{ category: 'Emerald', laps: null }],
            },
        ],
    } as unknown as Race;

    it('shows union for public cards even when a category is known', () => {
        expect(
            formatOmgangeDisplay(race, {
                userCategory: 'Diamond',
                categoryLaps: 3,
                forceUnion: true,
            }),
        ).toBe('3/2');
    });

    it('shows category laps on full cards for a known rider category', () => {
        expect(
            formatOmgangeDisplay(race, {
                userCategory: 'Diamond',
                categoryLaps: 3,
            }),
        ).toBe('3');
    });

    it('shows union when no category', () => {
        expect(formatOmgangeDisplay(race, {})).toBe('3/2');
    });
});
