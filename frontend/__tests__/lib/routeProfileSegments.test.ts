import { describe, it, expect } from 'vitest';
import {
    catalogSegmentsIncludeLeadIn,
    mergeElevationProfileWithLapBanners,
    mergeLapBannerProfileSegments,
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

    it('rounds float noise from lead-in subtraction', () => {
        // 4.882 - 3.185 → 1.6969999999999996 without rounding
        const out = shiftSegmentsByLeadIn(
            [{ name: 'Montmartre KOM', type: 'climb', fromKm: 4.882, toKm: 6.11, direction: 'forward' }],
            3.185,
        );
        expect(out).toEqual([
            { name: 'Montmartre KOM', type: 'climb', fromKm: 1.697, toKm: 2.925, direction: 'forward' },
        ]);
    });

    it('keeps zero-width on-course point banners after lead-in shift', () => {
        const out = shiftSegmentsByLeadIn(
            [{ name: 'Champs-Élysées', type: 'sprint', fromKm: 19.185, toKm: 19.185, direction: 'forward' }],
            3.185,
        );
        expect(out).toEqual([
            { name: 'Champs-Élysées', type: 'sprint', fromKm: 16, toKm: 16, direction: 'forward' },
        ]);
    });
});

describe('mergeLapBannerProfileSegments', () => {
    const lapLengthKm = 16;
    const catalog = [
        { name: 'Lutece Sprint', type: 'sprint' as const, fromKm: 1.178, toKm: 1.33, direction: 'forward' as const },
        { name: 'Monceau Sprint', type: 'sprint' as const, fromKm: 2.732, toKm: 3.026, direction: 'forward' as const },
        { name: 'Montmartre KOM', type: 'climb' as const, fromKm: 4.882, toKm: 6.11, direction: 'forward' as const },
        { name: 'Tchou Tchou Sprint', type: 'sprint' as const, fromKm: 8.664, toKm: 8.817, direction: 'reverse' as const },
    ];

    const eventSegments = [
        { id: 'lutece', count: 1, lap: 1, direction: 'forward', name: 'Lutece Sprint' },
        { id: 'monceau', count: 1, lap: 1, direction: 'forward', name: 'Monceau Sprint' },
        { id: 'montmartre', count: 1, lap: 1, direction: 'forward', name: 'Montmartre KOM' },
        { id: 'tchou', count: 1, lap: 1, direction: 'reverse', name: 'Tchou Tchou Sprint' },
        { id: '1056322864', count: 1, lap: 1, direction: 'forward', name: 'Champs-Élysées' },
        { id: 'lutece', count: 2, lap: 2, direction: 'forward', name: 'Lutece Sprint' },
        { id: 'monceau', count: 2, lap: 2, direction: 'forward', name: 'Monceau Sprint' },
        { id: 'montmartre', count: 2, lap: 2, direction: 'forward', name: 'Montmartre KOM' },
        { id: 'tchou', count: 2, lap: 2, direction: 'reverse', name: 'Tchou Tchou Sprint' },
        { id: '1056322864', count: 2, lap: 2, direction: 'forward', name: 'Champs-Élysées' },
        { id: 'lutece', count: 3, lap: 3, direction: 'forward', name: 'Lutece Sprint' },
        { id: 'monceau', count: 3, lap: 3, direction: 'forward', name: 'Monceau Sprint' },
        { id: 'montmartre', count: 3, lap: 3, direction: 'forward', name: 'Montmartre KOM' },
        { id: 'tchou', count: 3, lap: 3, direction: 'reverse', name: 'Tchou Tchou Sprint' },
        { id: '1056322864', count: 3, lap: 3, direction: 'forward', name: 'Champs-Élysées' },
    ];

    const champsSprints = [
        { id: '1056322864', name: 'Champs-Élysées', count: 1, lap: 1, direction: 'forward' },
        { id: '1056322864', name: 'Champs-Élysées', count: 2, lap: 2, direction: 'forward' },
        { id: '1056322864', name: 'Champs-Élysées', count: 3, lap: 3, direction: 'forward' },
    ];

    it('synthesizes end-of-lap markers for Champs-Élysées when missing from catalog', () => {
        const tiled = [
            ...catalog,
            ...catalog.map((s) => ({ ...s, fromKm: s.fromKm + lapLengthKm, toKm: s.toKm + lapLengthKm })),
            ...catalog.map((s) => ({ ...s, fromKm: s.fromKm + 2 * lapLengthKm, toKm: s.toKm + 2 * lapLengthKm })),
        ];
        const out = mergeLapBannerProfileSegments(tiled, champsSprints, eventSegments, lapLengthKm);
        const champs = out.filter((s) => s.name === 'Champs-Élysées');
        expect(champs).toHaveLength(3);
        expect(champs.map((s) => s.fromKm)).toEqual([16, 32, 48]);
        expect(champs.every((s) => s.fromKm === s.toKm && s.type === 'sprint')).toBe(true);
        // Existing catalog segments unchanged
        expect(out.filter((s) => s.name !== 'Champs-Élysées')).toHaveLength(tiled.length);
        expect(out.slice(0, tiled.length)).toEqual(tiled);
    });

    it('does not duplicate when Champs already has profile coords', () => {
        const withChamps = [
            ...catalog,
            { name: 'Champs-Élysées', type: 'sprint' as const, fromKm: 15.95, toKm: 16, direction: 'forward' as const },
        ];
        const out = mergeLapBannerProfileSegments(
            withChamps,
            [champsSprints[0]],
            eventSegments.filter((e) => e.lap === 1),
            lapLengthKm,
        );
        expect(out.filter((s) => s.name === 'Champs-Élysées')).toHaveLength(1);
        expect(out).toEqual(withChamps);
    });

    it('ignores configured sprints that are not the last segment of their lap', () => {
        const out = mergeLapBannerProfileSegments(
            catalog,
            [{ id: 'montmartre', name: 'Montmartre KOM', count: 1, lap: 1, direction: 'forward' }],
            eventSegments.filter((e) => e.lap === 1),
            lapLengthKm,
        );
        expect(out).toEqual(catalog);
    });

    it('normalizes accented banner names for profile matching', () => {
        const withAscii = [
            ...catalog,
            { name: 'Champs Elysees', type: 'sprint' as const, fromKm: 16, toKm: 16, direction: 'forward' as const },
        ];
        const out = mergeLapBannerProfileSegments(
            withAscii,
            [champsSprints[0]],
            eventSegments.filter((e) => e.lap === 1),
            lapLengthKm,
        );
        expect(out.filter((s) => /champs/i.test(s.name))).toHaveLength(1);
    });
});

describe('mergeElevationProfileWithLapBanners', () => {
    const lapLengthKm = 16;
    const catalog = [
        { name: 'Lutece Sprint', type: 'sprint' as const, fromKm: 1.178, toKm: 1.33, direction: 'forward' as const },
        { name: 'Montmartre KOM', type: 'climb' as const, fromKm: 4.882, toKm: 6.11, direction: 'forward' as const },
    ];
    const eventSegments = [
        { id: 'lutece', count: 1, lap: 1, direction: 'forward' },
        { id: 'montmartre', count: 1, lap: 1, direction: 'forward' },
        { id: '1056322864', count: 1, lap: 1, direction: 'forward' },
        { id: 'lutece', count: 2, lap: 2, direction: 'forward' },
        { id: 'montmartre', count: 2, lap: 2, direction: 'forward' },
        { id: '1056322864', count: 2, lap: 2, direction: 'forward' },
        { id: 'lutece', count: 3, lap: 3, direction: 'forward' },
        { id: 'montmartre', count: 3, lap: 3, direction: 'forward' },
        { id: '1056322864', count: 3, lap: 3, direction: 'forward' },
    ];
    const champsSprints = [
        { id: '1056322864', name: 'Champs-Élysées', count: 1, lap: 1, direction: 'forward' },
        { id: '1056322864', name: 'Champs-Élysées', count: 2, lap: 2, direction: 'forward' },
        { id: '1056322864', name: 'Champs-Élysées', count: 3, lap: 3, direction: 'forward' },
    ];

    it('derives lap length from tiled elevation and synthesizes missing banners', () => {
        const tiled = [
            ...catalog,
            ...catalog.map((s) => ({ ...s, fromKm: s.fromKm + lapLengthKm, toKm: s.toKm + lapLengthKm })),
            ...catalog.map((s) => ({ ...s, fromKm: s.fromKm + 2 * lapLengthKm, toKm: s.toKm + 2 * lapLengthKm })),
        ];
        const out = mergeElevationProfileWithLapBanners(
            { distance: [0, 16_000, 32_000, 48_000], profileSegments: tiled },
            champsSprints,
            eventSegments,
            3,
        );
        expect(out.filter((s) => s.name === 'Champs-Élysées').map((s) => s.fromKm)).toEqual([16, 32, 48]);
    });
});

describe('catalogSegmentsIncludeLeadIn', () => {
    it('detects lead-in-inclusive Watopia-style coords', () => {
        expect(
            catalogSegmentsIncludeLeadIn(
                [{ name: 'KOM', type: 'climb', fromKm: 3.532, toKm: 5.52 }],
                3.077,
            ),
        ).toBe(true);
    });

    it('detects Paris race-relative coords (sprints before lead-in distance)', () => {
        expect(
            catalogSegmentsIncludeLeadIn(
                [
                    { name: 'Lutece Sprint', type: 'sprint', fromKm: 1.178, toKm: 1.33 },
                    { name: 'Monceau Sprint', type: 'sprint', fromKm: 2.732, toKm: 3.026 },
                ],
                3.185,
            ),
        ).toBe(false);
    });
});

describe('resolveRaceRelativeProfileSegments', () => {
    const catalog = [
        { name: 'Zwift KOM', type: 'climb' as const, fromKm: 0.831, toKm: 1.731, direction: 'forward' as const },
        { name: 'Itza KOM', type: 'climb' as const, fromKm: 42.339, toKm: 46.098, direction: 'forward' as const },
    ];

    it('uses shifted catalog when cache is empty and coords include lead-in', () => {
        // Force inclusive path: first segment after lead-in
        const inclusive = [
            { name: 'Zwift KOM', type: 'climb' as const, fromKm: 3.532, toKm: 5.52, direction: 'forward' as const },
        ];
        const out = resolveRaceRelativeProfileSegments(null, inclusive, 3.077);
        expect(out[0].fromKm).toBeCloseTo(0.455, 3);
    });

    it('does not shift Paris-style race-relative catalog against lead-in metadata', () => {
        const paris = [
            { name: 'Lutece Sprint', type: 'sprint' as const, fromKm: 1.178, toKm: 1.33, direction: 'forward' as const },
            { name: 'Monceau Sprint', type: 'sprint' as const, fromKm: 2.732, toKm: 3.026, direction: 'forward' as const },
            { name: 'Montmartre KOM', type: 'climb' as const, fromKm: 4.882, toKm: 6.11, direction: 'forward' as const },
            { name: 'Tchou Tchou Sprint', type: 'sprint' as const, fromKm: 8.664, toKm: 8.817, direction: 'reverse' as const },
        ];
        const out = resolveRaceRelativeProfileSegments(null, paris, 3.185);
        expect(out).toHaveLength(4);
        expect(out[0].fromKm).toBe(1.178);
        expect(out.map((s) => s.name)).toEqual([
            'Lutece Sprint',
            'Monceau Sprint',
            'Montmartre KOM',
            'Tchou Tchou Sprint',
        ]);
    });

    it('keeps race-relative cache as-is', () => {
        const inclusive = [
            { name: 'Zwift KOM', type: 'climb' as const, fromKm: 3.532, toKm: 5.52, direction: 'forward' as const },
        ];
        const cached = shiftSegmentsByLeadIn(inclusive, 3.077);
        const out = resolveRaceRelativeProfileSegments(cached, inclusive, 3.077);
        expect(out).toEqual(cached);
    });

    it('converts cache that still has lead-in-inclusive catalog coords', () => {
        const inclusive = [
            { name: 'Zwift KOM', type: 'climb' as const, fromKm: 3.532, toKm: 5.52, direction: 'forward' as const },
        ];
        const out = resolveRaceRelativeProfileSegments(inclusive, inclusive, 3.077);
        expect(out[0].fromKm).toBeCloseTo(0.455, 3);
    });

    it('honors streamIncludesLeadIn=false even if catalog looks inclusive', () => {
        const inclusive = [
            { name: 'Zwift KOM', type: 'climb' as const, fromKm: 3.532, toKm: 5.52, direction: 'forward' as const },
        ];
        const out = resolveRaceRelativeProfileSegments(null, inclusive, 3.077, false);
        expect(out[0].fromKm).toBe(3.532);
    });
});
