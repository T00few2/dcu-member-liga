import { describe, expect, it } from 'vitest';
import { getLiveRaceCategoryTabs, groupLiveRaceCategoryTabs } from '@/lib/live-race/categoryTabs';
import type { CurrentLiveRace } from '@/types/live';

describe('getLiveRaceCategoryTabs', () => {
    it('builds grouped tabs with group/category lap and sprint fallbacks', () => {
        const race = {
            eventMode: 'grouped',
            laps: 2,
            sprints: [{ id: 'race', name: 'Race sprint', count: 1 }],
            raceGroups: [
                {
                    name: 'High end',
                    laps: 3,
                    sprints: [{ id: 'high', name: 'High sprint', count: 1 }],
                    categories: [
                        { category: 'Diamond', laps: null },
                        {
                            category: 'Ruby',
                            sprints: [{ id: 'ruby', name: 'Ruby sprint', count: 1 }],
                        },
                    ],
                },
                {
                    name: 'Mid',
                    categories: [{ category: 'Emerald' }, { category: 'Sapphire' }],
                },
            ],
        } as unknown as CurrentLiveRace;

        const tabs = getLiveRaceCategoryTabs(race);
        expect(tabs.map((t) => t.cat)).toEqual(['Diamond', 'Ruby', 'Emerald', 'Sapphire']);
        expect(tabs[0]).toMatchObject({
            cat: 'Diamond',
            groupName: 'High end',
            laps: 3,
            sprints: [{ id: 'high', name: 'High sprint', count: 1 }],
        });
        expect(tabs[1].sprints).toEqual([{ id: 'ruby', name: 'Ruby sprint', count: 1 }]);
        expect(tabs[2]).toMatchObject({ cat: 'Emerald', groupName: 'Mid', laps: 2 });
        expect(tabs[2].sprints).toEqual([{ id: 'race', name: 'Race sprint', count: 1 }]);
    });

    it('uses eventConfiguration for multi-mode races', () => {
        const race = {
            eventMode: 'multi',
            laps: 2,
            eventConfiguration: [
                { eventId: '1', customCategory: 'A', laps: 3, sprints: [{ id: 'a', name: 'A sprint', count: 1 }] },
                { eventId: '2', customCategory: 'B' },
            ],
        } as CurrentLiveRace;

        const tabs = getLiveRaceCategoryTabs(race);
        expect(tabs).toEqual([
            { cat: 'A', label: 'A', laps: 3, sprints: [{ id: 'a', name: 'A sprint', count: 1 }] },
            { cat: 'B', label: 'B', laps: 2, sprints: [] },
        ]);
    });

    it('uses singleModeCategories when present', () => {
        const race = {
            laps: 4,
            singleModeCategories: [
                { category: 'A', laps: 5 },
                { category: 'B' },
            ],
        } as CurrentLiveRace;

        expect(getLiveRaceCategoryTabs(race).map((t) => [t.cat, t.laps])).toEqual([
            ['A', 5],
            ['B', 4],
        ]);
    });

    it('falls back to a single A tab', () => {
        const race = { laps: 2, sprints: [{ id: 's', name: 'S', count: 1 }] } as CurrentLiveRace;
        expect(getLiveRaceCategoryTabs(race)).toEqual([
            { cat: 'A', label: 'A', laps: 2, sprints: [{ id: 's', name: 'S', count: 1 }] },
        ]);
    });
});

describe('groupLiveRaceCategoryTabs', () => {
    it('keeps group order and buckets categories', () => {
        const groups = groupLiveRaceCategoryTabs([
            { cat: 'Diamond', label: 'Diamond', groupName: 'High end', laps: 3, sprints: [] },
            { cat: 'Ruby', label: 'Ruby', groupName: 'High end', laps: 3, sprints: [] },
            { cat: 'Gold', label: 'Gold', groupName: 'Low end', laps: 2, sprints: [] },
        ]);
        expect(groups.map((g) => g.groupName)).toEqual(['High end', 'Low end']);
        expect(groups[0].tabs.map((t) => t.cat)).toEqual(['Diamond', 'Ruby']);
        expect(groups[1].tabs.map((t) => t.cat)).toEqual(['Gold']);
    });
});
