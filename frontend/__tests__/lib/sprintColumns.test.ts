import { describe, expect, it } from 'vitest';
import { getConfiguredSprintsForCategory, resolveSprintColumns } from '@/lib/sprintColumns';
import type { Race, Sprint } from '@/types/live';

const champs = (count: number): Sprint => ({
    id: '1056322864',
    count,
    name: 'Champs-Élysées',
    lap: count,
});

const montmartre = (count: number): Sprint => ({
    id: '1055881124',
    count,
    name: 'Montmartre KOM',
    lap: count,
});

describe('resolveSprintColumns', () => {
    it('keeps configured sprints even when no rider has sprintDetails yet', () => {
        const configured = [montmartre(1), montmartre(2), montmartre(3), champs(1), champs(2)];
        expect(resolveSprintColumns(configured, [{ sprintDetails: {} }])).toEqual([
            '1055881124_1',
            '1055881124_2',
            '1055881124_3',
            '1056322864_1',
            '1056322864_2',
        ]);
    });

    it('orders configured sprints first, then leftover rider keys', () => {
        const configured = [champs(1)];
        const rows = [{ sprintDetails: { extra_1: 10, '1056322864_1': 5 } }];
        expect(resolveSprintColumns(configured, rows)).toEqual(['1056322864_1', 'extra_1']);
    });
});

describe('getConfiguredSprintsForCategory', () => {
    it('uses grouped race group sprints', () => {
        const race: Race = {
            id: 'r1',
            name: 'eCKD',
            date: '2026-09-17',
            eventMode: 'grouped',
            raceGroups: [
                {
                    categories: [{ category: '2. Division' }],
                    sprints: [montmartre(1), champs(1), champs(2)],
                },
            ],
        };
        expect(getConfiguredSprintsForCategory(race, '2. Division').map((s) => `${s.id}_${s.count}`)).toEqual([
            '1055881124_1',
            '1056322864_1',
            '1056322864_2',
        ]);
    });
});
