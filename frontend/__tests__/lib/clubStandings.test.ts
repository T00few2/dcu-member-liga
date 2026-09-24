import { describe, expect, it } from 'vitest';
import { buildClubStandings } from '@/lib/clubStandings';
import type { StandingEntry } from '@/types/live';

function rider(zwiftId: string, name: string, totalPoints: number): StandingEntry {
    return { zwiftId, name, totalPoints, raceCount: 1, results: [] };
}

describe('buildClubStandings', () => {
    it('sums the three highest season totals per club across divisions', () => {
        const standings = {
            A: [
                rider('1', 'Ada', 100),
                rider('2', 'Bea', 80),
                rider('3', 'Cid', 10),
            ],
            B: [
                rider('4', 'Dan', 70),
                rider('5', 'Eve', 5),
                rider('1', 'Ada', 40),
            ],
        };
        const clubs = new Map([
            ['1', 'North'],
            ['2', 'North'],
            ['3', 'North'],
            ['4', 'North'],
            ['5', 'South'],
            ['9', ''],
        ]);
        const rows = buildClubStandings(standings, clubs);
        expect(rows.map((row) => row.club)).toEqual(['North', 'South']);
        expect(rows[0].points).toBe(100 + 80 + 70);
        expect(rows[0].riders.map((r) => r.name)).toEqual(['Ada', 'Bea', 'Dan']);
        expect(rows[1].points).toBe(5);
    });

    it('counts a moved rider only in the division they are in now', () => {
        const standings = {
            A: [rider('1', 'Ada', 100)],
            B: [rider('1', 'Ada', 8), rider('2', 'Bea', 40)],
        };
        const clubs = new Map([['1', 'North'], ['2', 'North']]);
        const categories = new Map([['1', 'B']]);
        const rows = buildClubStandings(standings, clubs, categories);
        expect(rows[0].points).toBe(48);
        expect(rows[0].riders.map((r) => r.zwiftId)).toEqual(['2', '1']);
    });

    it('leaves out riders without a club and keeps a club with fewer than three riders', () => {
        const rows = buildClubStandings(
            { A: [rider('1', 'Ada', 12), rider('2', 'Bea', 30)] },
            new Map([['1', 'Solo']]),
        );
        expect(rows).toEqual([
            { club: 'Solo', points: 12, riders: [{ zwiftId: '1', name: 'Ada', points: 12 }] },
        ]);
    });
});
