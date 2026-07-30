import { describe, it, expect } from 'vitest';
import { estimateMinutesPerLap, estimateTotalMinutes, solveLapsForTimeSpan, formatMinutes } from '@/lib/timeEstimate';

const BON_VOYAGE_ESTIMATES = [
    { wkg: 4, minutes: 43 },
    { wkg: 3, minutes: 48 },
    { wkg: 2, minutes: 57 },
];

// ZI minutes cover lead-in + first lap (distance + leadinDistance)
const ROUTE = { distance: 20, leadinDistance: 1 };

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

describe('estimateTotalMinutes', () => {
    it('treats ZI minutes as lead-in + first lap, then adds lap-only time', () => {
        // 43 min covers 21 km (20 lap + 1 lead-in); 1 lap total stays 43
        expect(estimateTotalMinutes(ROUTE, 43, 1)).toBeCloseTo(43);
    });

    it('scales extra laps without repeating lead-in', () => {
        // 2 laps = 41 km at 43/21 pace -> 43 * 41/21
        expect(estimateTotalMinutes(ROUTE, 43, 2)).toBeCloseTo(43 * 41 / 21);
    });

    it('returns null when route distance is zero', () => {
        expect(estimateTotalMinutes({ distance: 0, leadinDistance: 1 }, 43, 1)).toBeNull();
    });

    it('returns null when per-lap minutes is not positive', () => {
        expect(estimateTotalMinutes(ROUTE, 0, 1)).toBeNull();
    });
});

describe('solveLapsForTimeSpan', () => {
    it('finds the lap count landing inside the target span', () => {
        // 1 lap = 43min, 2 laps ~= 83.95min -> 2 laps is the only fit for [80, 100]
        const result = solveLapsForTimeSpan(ROUTE, 43, 80, 100);
        expect(result?.laps).toBe(2);
        expect(result?.totalMinutes).toBeCloseTo(43 * 41 / 21);
        expect(result?.withinSpan).toBe(true);
    });

    it('picks the closest lap count when no integer count fits the span', () => {
        // [60, 70] falls strictly between 1 lap (43min) and 2 laps (~84min);
        // 2 laps is closer to the span (14min over vs 17min under).
        const result = solveLapsForTimeSpan(ROUTE, 43, 60, 70);
        expect(result?.laps).toBe(2);
        expect(result?.totalMinutes).toBeCloseTo(43 * 41 / 21);
        expect(result?.withinSpan).toBe(false);
    });

    it('never returns fewer than 1 lap even for a span below the shortest possible ride', () => {
        const result = solveLapsForTimeSpan(ROUTE, 43, 1, 2);
        expect(result?.laps).toBe(1);
        expect(result?.withinSpan).toBe(false);
    });

    it('treats a reversed min/max span the same as a normal one', () => {
        const result = solveLapsForTimeSpan(ROUTE, 43, 100, 80);
        expect(result?.laps).toBe(2);
        expect(result?.withinSpan).toBe(true);
    });

    it('returns null when route distance is zero', () => {
        expect(solveLapsForTimeSpan({ distance: 0, leadinDistance: 1 }, 43, 80, 100)).toBeNull();
    });

    it('returns null when per-lap minutes is not positive', () => {
        expect(solveLapsForTimeSpan(ROUTE, 0, 80, 100)).toBeNull();
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
