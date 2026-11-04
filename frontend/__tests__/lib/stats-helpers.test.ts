import { describe, expect, it } from 'vitest';
import {
    buildDivisionPowerComparison,
    buildSharedSprintComparison,
    formatConvertedPower,
    formatDisplayPower,
    formatExcludedRidersNote,
    formatOmittedSprintNote,
    groupPowerLegendEntries,
    median,
    parsePowerUnit,
    parseWeightKg,
    powerAxisLabel,
    toDisplayPower,
} from '@/app/stats/_lib/stats-helpers';
import type { CriticalPower } from '@/types/live';
import type { DivisionEffortRider } from '@/app/stats/_lib/stats-types';

describe('parsePowerUnit', () => {
    it('reads wkg from the query string and defaults everything else to watts', () => {
        expect(parsePowerUnit('wkg')).toBe('wkg');
        expect(parsePowerUnit('watts')).toBe('watts');
        expect(parsePowerUnit(null)).toBe('watts');
        expect(parsePowerUnit('nope')).toBe('watts');
    });
});

describe('parseWeightKg', () => {
    it('converts positive gram values to kilograms', () => {
        expect(parseWeightKg(75000)).toBe(75);
        expect(parseWeightKg('80000')).toBe(80);
    });

    it('returns null for missing or invalid weights', () => {
        expect(parseWeightKg(null)).toBeNull();
        expect(parseWeightKg(0)).toBeNull();
        expect(parseWeightKg('N/A')).toBeNull();
    });
});

describe('toDisplayPower', () => {
    it('returns watts unchanged', () => {
        expect(toDisplayPower(500, 75, 'watts')).toBe(500);
    });

    it('divides by kilograms for W/kg', () => {
        expect(toDisplayPower(500, 80, 'wkg')).toBe(6.25);
    });

    it('returns null in W/kg mode when weight is missing', () => {
        expect(toDisplayPower(500, null, 'wkg')).toBeNull();
        expect(toDisplayPower(500, 0, 'wkg')).toBeNull();
    });
});

describe('formatDisplayPower', () => {
    it('formats watts as whole watts', () => {
        expect(formatDisplayPower(501.4, 75, 'watts')).toBe('501 W');
    });

    it('formats W/kg to two decimals', () => {
        expect(formatDisplayPower(500, 75, 'wkg')).toBe('6.67 W/kg');
    });

    it('shows an em dash when W/kg cannot be computed', () => {
        expect(formatDisplayPower(500, null, 'wkg')).toBe('—');
        expect(formatConvertedPower(null, 'wkg')).toBe('—');
    });
});

describe('powerAxisLabel', () => {
    it('matches the selected unit', () => {
        expect(powerAxisLabel('watts')).toBe('Watts');
        expect(powerAxisLabel('wkg')).toBe('W/kg');
    });
});

describe('groupPowerLegendEntries', () => {
    const entries = [
        { rider: { category: '2. Division', name: 'Kim' } },
        { rider: { category: '1. Division', name: 'Alex' } },
        { rider: { category: '2. Division', name: 'Morten' } },
    ];

    it('keeps a single unlabeled group when not grouping by category', () => {
        expect(groupPowerLegendEntries(entries, false)).toEqual([
            { key: 'all', label: null, entries },
        ]);
    });

    it('groups in first-seen category order', () => {
        const groups = groupPowerLegendEntries(entries, true);
        expect(groups.map((group) => group.label)).toEqual(['2. Division', '1. Division']);
        expect(groups[0].entries.map((entry) => entry.rider.name)).toEqual(['Kim', 'Morten']);
        expect(groups[1].entries.map((entry) => entry.rider.name)).toEqual(['Alex']);
    });
});

describe('median', () => {
    it('returns the middle value, the mean of the two middle values, or null', () => {
        expect(median([3, 1, 2])).toBe(2);
        expect(median([4, 1, 3, 2])).toBe(2.5);
        expect(median([])).toBeNull();
    });
});

const power = (w15: number, w1: number, w5: number, w20: number): CriticalPower => ({
    criticalP15Seconds: w15,
    criticalP1Minute: w1,
    criticalP5Minutes: w5,
    criticalP20Minutes: w20,
});

const effortRider = (overrides: Partial<DivisionEffortRider> & Pick<DivisionEffortRider, 'zwiftId' | 'category'>): DivisionEffortRider => ({
    name: overrides.zwiftId,
    weightKg: 75,
    criticalPower: power(900, 700, 400, 300),
    ...overrides,
});

describe('buildDivisionPowerComparison', () => {
    const riders: DivisionEffortRider[] = [
        effortRider({ zwiftId: 'a1', name: 'Ane', category: 'A', criticalPower: power(900, 700, 400, 300) }),
        effortRider({ zwiftId: 'a2', name: 'Bo', category: 'A', criticalPower: power(600, 500, 300, 250) }),
        effortRider({ zwiftId: 'a3', name: 'Cia', category: 'A', weightKg: null, criticalPower: power(800, 600, 350, 280) }),
        effortRider({ zwiftId: 'a1', name: 'Ane again', category: 'A', criticalPower: power(2000, 2000, 2000, 2000) }),
        effortRider({ zwiftId: 'b1', name: 'Dan', category: 'B', weightKg: null, criticalPower: power(1000, 800, 500, 400) }),
        effortRider({ zwiftId: 'b2', name: 'Eva', category: 'B', disqualified: true }),
        effortRider({ zwiftId: 'b3', name: 'Finn', category: 'B', declassified: true }),
        effortRider({ zwiftId: 'b4', name: 'Gia', category: 'B', criticalPower: null }),
        effortRider({ zwiftId: 'c1', name: 'Hidden', category: 'C', criticalPower: power(500, 400, 300, 200) }),
    ];

    it('summarises watts for selected divisions and skips riders who cannot be compared', () => {
        const result = buildDivisionPowerComparison(riders, {
            unit: 'watts',
            categories: ['A', 'B'],
            currentUserZwiftId: 'a2',
        });

        expect(result.summaries.map((row) => row.category)).toEqual(['A', 'B']);
        expect(result.summaries[0]).toMatchObject({
            riderCount: 3,
            median: { criticalP15Seconds: 800, criticalP20Minutes: 280 },
            best: { criticalP15Seconds: 900, criticalP20Minutes: 300 },
        });
        expect(result.summaries[1]).toMatchObject({
            riderCount: 1,
            best: { criticalP20Minutes: 400 },
        });
        expect(result.riders.find((rider) => rider.zwiftId === 'a2')?.isMe).toBe(true);
        expect(result.riders.find((rider) => rider.zwiftId === 'a1')?.values.criticalP20Minutes).toBe(300);
        expect(result.riders.some((rider) => rider.category === 'C')).toBe(false);
        expect(result.excluded).toEqual({
            dq: 1,
            declassified: 1,
            missingPower: 1,
            missingWeight: 0,
        });
    });

    it('uses W/kg and drops riders without a weight', () => {
        const result = buildDivisionPowerComparison(riders, {
            unit: 'wkg',
            categories: ['A', 'B'],
        });

        expect(result.summaries.map((row) => row.category)).toEqual(['A']);
        expect(result.summaries[0].riderCount).toBe(2);
        expect(result.summaries[0].median.criticalP15Seconds).toBe(10);
        expect(result.summaries[0].best.criticalP15Seconds).toBe(12);
        expect(result.excluded.missingWeight).toBe(2);
        expect(formatExcludedRidersNote(result.excluded)).toBe(
            '5 ryttere er udeladt: 1 diskvalificeret, 1 deklassificeret, 1 uden effektkurve, 2 uden vægt.',
        );
    });
});

describe('buildSharedSprintComparison', () => {
    const champs = (count: number) => ({
        id: '10',
        name: 'Champs',
        count,
        key: `10_${count}`,
    });

    it('compares only segments ridden by at least two divisions', () => {
        const groups = buildSharedSprintComparison(
            {
                '1. Division': [champs(1)],
                '2. Division': [champs(1)],
                '3. Division': [{ id: '99', name: 'Box Hill', count: 1, key: '99_1' }],
            },
            [
                effortRider({
                    zwiftId: 'a',
                    category: '1. Division',
                    weightKg: 80,
                    sprintData: { '10_1': { time: 12000, avgPower: 800 } },
                }),
                effortRider({
                    zwiftId: 'b',
                    category: '1. Division',
                    weightKg: 70,
                    sprintData: { '10_1': { time: 14000, avgPower: 600 } },
                }),
                effortRider({
                    zwiftId: 'dq',
                    category: '1. Division',
                    disqualified: true,
                    sprintData: { '10_1': { time: 10000, avgPower: 1100 } },
                }),
                effortRider({
                    zwiftId: 'c',
                    category: '2. Division',
                    weightKg: 75,
                    sprintData: { '10_1': { time: 15000, avgPower: 500 } },
                }),
                effortRider({
                    zwiftId: 'd',
                    category: '3. Division',
                    sprintData: { '99_1': { time: 20000, avgPower: 400 } },
                }),
            ],
            { unit: 'watts', categories: ['1. Division', '2. Division', '3. Division'] },
        );

        expect(groups).toHaveLength(1);
        expect(groups[0].label).toBe('Champs #1');
        expect(groups[0].omittedCategories).toEqual(['3. Division']);
        expect(formatOmittedSprintNote(groups[0].omittedCategories)).toBe('3. Division kørte et andet segment.');
        expect(groups[0].rows[0]).toEqual({
            category: '1. Division',
            riderCount: 2,
            medianTimeSec: 13,
            bestTimeSec: 12,
            medianPower: 700,
        });
        expect(groups[0].rows[1]).toMatchObject({
            category: '2. Division',
            riderCount: 1,
            bestTimeSec: 15,
            medianPower: 500,
        });
    });

    it('does not line up the same segment id when the lap count differs', () => {
        const groups = buildSharedSprintComparison(
            {
                '1. Division': [champs(1)],
                '2. Division': [champs(2)],
            },
            [],
            { unit: 'watts', categories: ['1. Division', '2. Division'] },
        );
        expect(groups).toEqual([]);
    });

    it('keeps sprint times when W/kg cannot be calculated', () => {
        const groups = buildSharedSprintComparison(
            {
                A: [champs(1)],
                B: [champs(1)],
            },
            [
                effortRider({
                    zwiftId: 'light',
                    category: 'A',
                    weightKg: null,
                    sprintData: { '10_1': { time: 10000, avgPower: 500 } },
                }),
                effortRider({
                    zwiftId: 'heavy',
                    category: 'A',
                    weightKg: 100,
                    sprintData: { '10_1': { time: 20000, avgPower: 500 } },
                }),
                effortRider({
                    zwiftId: 'other',
                    category: 'B',
                    weightKg: 80,
                    sprintData: { '10_1': { time: 16000, avgPower: 400 } },
                }),
            ],
            { unit: 'wkg', categories: ['A', 'B'] },
        );

        expect(groups[0].rows[0]).toMatchObject({
            riderCount: 2,
            medianTimeSec: 15,
            bestTimeSec: 10,
            medianPower: 5,
        });
    });
});
