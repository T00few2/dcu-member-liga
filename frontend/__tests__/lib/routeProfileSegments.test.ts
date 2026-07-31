import { describe, it, expect } from 'vitest';
import {
    resolveRaceRelativeProfileSegments,
    shiftSegmentsByLeadIn,
} from '@/lib/routeProfileSegments';

describe('shiftSegmentsByLeadIn', () => {
    it('shifts catalog coords onto race-start = 0', () => {
        const out = shiftSegmentsByLeadIn(
            [
                { name: 'Mayan Mountainside KOM', type: 'climb', fromKm: 3.532, toKm: 5.52, direction: 'forward' },
                { name: 'Itza KOM', type: 'climb', fromKm: 6.126, toKm: 9.869, direction: 'forward' },
            ],
            3.077,
        );
        expect(out[0].fromKm).toBeCloseTo(0.455, 3);
        expect(out[0].toKm).toBeCloseTo(2.443, 3);
        expect(out[1].fromKm).toBeCloseTo(3.049, 3);
    });

    it('drops segments that finish entirely in the lead-in', () => {
        const out = shiftSegmentsByLeadIn(
            [{ name: 'Early Sprint', type: 'sprint', fromKm: 1.0, toKm: 2.0, direction: 'forward' }],
            2.692,
        );
        expect(out).toEqual([]);
    });

    it('keeps the on-course remnant of a segment that crosses race start', () => {
        const out = shiftSegmentsByLeadIn(
            [{ name: 'Yorkshire Sprint Reverse', type: 'sprint', fromKm: 2.573, toKm: 2.976, direction: 'reverse' }],
            2.692,
        );
        expect(out).toHaveLength(1);
        expect(out[0].fromKm).toBe(0);
        expect(out[0].toKm).toBeCloseTo(0.284, 3);
    });
});

describe('resolveRaceRelativeProfileSegments', () => {
    const catalog = [
        { name: 'Zwift KOM', type: 'climb' as const, fromKm: 0.831, toKm: 1.731, direction: 'forward' as const },
        { name: 'Itza KOM', type: 'climb' as const, fromKm: 42.339, toKm: 46.098, direction: 'forward' as const },
    ];

    it('uses shifted catalog when cache is empty', () => {
        const out = resolveRaceRelativeProfileSegments(null, catalog, 0.497);
        expect(out[0].fromKm).toBeCloseTo(0.334, 3);
        expect(out[1].toKm).toBeCloseTo(45.601, 3);
    });

    it('keeps race-relative cache as-is', () => {
        const cached = shiftSegmentsByLeadIn(catalog, 0.497);
        const out = resolveRaceRelativeProfileSegments(cached, catalog, 0.497);
        expect(out).toEqual(cached);
    });

    it('converts cache that still has lead-in-inclusive catalog coords', () => {
        const out = resolveRaceRelativeProfileSegments(catalog, catalog, 0.497);
        expect(out[0].fromKm).toBeCloseTo(0.334, 3);
    });
});
