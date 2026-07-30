import { calculateRouteTotals, scaleRaceDistanceKm } from '@/hooks/useLeagueData';

describe('calculateRouteTotals', () => {
    it('adds lead-in once, not per lap', () => {
        const route = {
            id: 'r1',
            name: 'Test',
            map: 'Watopia',
            distance: 10,
            elevation: 100,
            leadinDistance: 2,
            leadinElevation: 20,
        };
        expect(calculateRouteTotals(route, 3)).toEqual({
            totalDistance: 32, // 10*3 + 2
            totalElevation: 320, // 100*3 + 20
            lapDistance: 10,
            leadinDistance: 2,
        });
    });
});

describe('scaleRaceDistanceKm', () => {
    it('keeps lead-in once when scaling to fewer laps', () => {
        // Saved as 3 laps: 10*3 + 2 = 32
        expect(scaleRaceDistanceKm(32, 3, 1, 2)).toBe(12); // 10 + 2
        expect(scaleRaceDistanceKm(32, 3, 2, 2)).toBe(22); // 20 + 2
        expect(scaleRaceDistanceKm(32, 3, 3, 2)).toBe(32);
    });

    it('keeps lead-in once when scaling to more laps', () => {
        expect(scaleRaceDistanceKm(12, 1, 4, 2)).toBe(42); // 10*4 + 2
    });

    it('without lead-in falls back to proportional scaling', () => {
        expect(scaleRaceDistanceKm(30, 3, 1, 0)).toBe(10);
    });
});
