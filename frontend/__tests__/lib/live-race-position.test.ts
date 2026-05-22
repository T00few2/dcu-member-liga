import { describe, it, expect } from 'vitest';
import { chartKmFromLiveData, liveCumulativeDistanceM } from '@/lib/live-race/position';

describe('live-race position', () => {
    it('prefers totalDistanceInMeters over distanceCovered', () => {
        // Real Zwift payload: distanceCovered is session lifetime (~700 km),
        // totalDistanceInMeters is race-cumulative (~27 km).
        const m = liveCumulativeDistanceM(
            {
                distanceCovered: 954705,
                totalDistanceInMeters: 27023,
                routeDistanceInCentimeters: 2704386,
                lap: 0,
            },
            53500,
        );
        expect(m).toBe(27023);
    });

    it('falls back to routeDistanceInCentimeters when total is missing', () => {
        const m = liveCumulativeDistanceM(
            { distanceCovered: 999999, routeDistanceInCentimeters: 2500000 },
            10000,
        );
        expect(m).toBe(25000);
    });

    it('uses distanceCovered only when plausible vs lap length', () => {
        const m = liveCumulativeDistanceM({ distanceCovered: 5000, lap: 1 }, 10000);
        expect(m).toBe(5000);
    });

    it('subtracts lead-in for chart km', () => {
        const { chartKm, inLeadIn } = chartKmFromLiveData(
            { totalDistanceInMeters: 500 },
            { leadInKm: 1, totalDistanceKm: 20, lapLengthKm: 20 },
        );
        expect(chartKm).toBe(0);
        expect(inLeadIn).toBe(true);
    });

    it('clamps chart km to total distance', () => {
        const { chartKm } = chartKmFromLiveData(
            { totalDistanceInMeters: 25000 },
            { leadInKm: 0, totalDistanceKm: 20, lapLengthKm: 20 },
        );
        expect(chartKm).toBe(20);
    });
});
