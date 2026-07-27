import { describe, it, expect } from 'vitest';
import { estimateMinutesPerLap, formatMinutes } from '@/lib/timeEstimate';

const BON_VOYAGE_ESTIMATES = [
    { wkg: 4, minutes: 43 },
    { wkg: 3, minutes: 48 },
    { wkg: 2, minutes: 57 },
];

describe('estimateMinutesPerLap', () => {
    it('returns null for empty estimates', () => {
        expect(estimateMinutesPerLap([], 3)).toBeNull();
    });

    it('returns the only value when a single estimate exists', () => {
        expect(estimateMinutesPerLap([{ wkg: 3, minutes: 48 }], 4)).toBe(48);
    });

    it('returns the exact value when the target matches a known tier', () => {
        expect(estimateMinutesPerLap(BON_VOYAGE_ESTIMATES, 3)).toBe(48);
    });

    it('interpolates linearly between two bracketing tiers', () => {
        // Halfway between 3 W/kg (48min) and 4 W/kg (43min) -> 45.5min
        expect(estimateMinutesPerLap(BON_VOYAGE_ESTIMATES, 3.5)).toBeCloseTo(45.5);
    });

    it('extrapolates above the fastest known tier using its slope', () => {
        // Slope from 3->4 W/kg is -5min per W/kg; one more W/kg above 4 -> 38min
        expect(estimateMinutesPerLap(BON_VOYAGE_ESTIMATES, 5)).toBeCloseTo(38);
    });

    it('extrapolates below the slowest known tier using its slope', () => {
        // Slope from 2->3 W/kg is -9min per W/kg; one W/kg below 2 -> 66min
        expect(estimateMinutesPerLap(BON_VOYAGE_ESTIMATES, 1)).toBeCloseTo(66);
    });

    it('handles unsorted input the same as sorted input', () => {
        const shuffled = [BON_VOYAGE_ESTIMATES[2], BON_VOYAGE_ESTIMATES[0], BON_VOYAGE_ESTIMATES[1]];
        expect(estimateMinutesPerLap(shuffled, 3.5)).toBeCloseTo(45.5);
    });
});

describe('formatMinutes', () => {
    it('formats sub-hour durations as "Xm"', () => {
        expect(formatMinutes(48)).toBe('48m');
    });

    it('formats durations over an hour as "Xh Ym"', () => {
        expect(formatMinutes(125)).toBe('2h 5m');
    });

    it('rounds to the nearest minute', () => {
        expect(formatMinutes(45.6)).toBe('46m');
    });

    it('formats exactly zero minutes', () => {
        expect(formatMinutes(0)).toBe('0m');
    });
});
