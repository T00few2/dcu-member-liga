import { describe, expect, it } from 'vitest';
import {
    formatConvertedPower,
    formatDisplayPower,
    groupPowerLegendEntries,
    parsePowerUnit,
    parseWeightKg,
    powerAxisLabel,
    toDisplayPower,
} from '@/app/stats/_lib/stats-helpers';

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
