import { describe, expect, it } from 'vitest';
import {
    classificationLeaderIds,
    classificationRankKey,
    compareClassificationRank,
    latestClassificationRaceId,
} from '@/lib/classificationTiebreak';
import type { StandingEntry } from '@/types/live';

function rider(
    zwiftId: string,
    komPoints: number,
    lines: { raceId: string; points: number; lastBannerPoints: number }[],
): StandingEntry {
    return {
        zwiftId,
        name: zwiftId,
        totalPoints: 0,
        raceCount: lines.length,
        results: [],
        komPoints,
        komResults: lines,
    };
}

describe('classification tiebreak', () => {
    const races = [
        { id: 'old', date: '2026-05-01T18:00:00Z', resultsPhase: 'finalized' as const, stageRaceId: 'event' },
        { id: 'last', date: '2026-06-01T18:00:00Z', resultsPhase: 'finalized' as const, stageRaceId: 'event' },
        { id: 'open', date: '2026-07-01T18:00:00Z', resultsPhase: 'provisional' as const, stageRaceId: 'event' },
    ];

    it('uses the latest finalized season race', () => {
        expect(latestClassificationRaceId(races, new Set(['event']), true)).toBe('last');
    });

    it('ranks by season total, then the last race, then its last banner', () => {
        const lastRaceId = 'last';
        const higherLastRace = rider('a', 10, [
            { raceId: 'old', points: 4, lastBannerPoints: 1 },
            { raceId: 'last', points: 6, lastBannerPoints: 1 },
        ]);
        const higherLastBanner = rider('b', 10, [
            { raceId: 'old', points: 8, lastBannerPoints: 5 },
            { raceId: 'last', points: 2, lastBannerPoints: 2 },
        ]);
        const lowerTotal = rider('c', 9, [
            { raceId: 'last', points: 9, lastBannerPoints: 9 },
        ]);
        const keys = [higherLastBanner, higherLastRace, lowerTotal]
            .map((row) => classificationRankKey(row, 'kom', lastRaceId))
            .sort(compareClassificationRank);
        expect(keys.map((key) => key.total)).toEqual([10, 10, 9]);
        expect(keys[0]).toMatchObject({ lastRace: 6, lastBanner: 1 });
        expect(keys[1]).toMatchObject({ lastRace: 2, lastBanner: 2 });
    });

    it('shares the lead only when the last banner is also tied', () => {
        const tied = [
            rider('a', 10, [{ raceId: 'last', points: 4, lastBannerPoints: 3 }]),
            rider('b', 10, [{ raceId: 'last', points: 4, lastBannerPoints: 3 }]),
            rider('c', 10, [{ raceId: 'last', points: 4, lastBannerPoints: 1 }]),
        ];
        expect(classificationLeaderIds(tied, 'kom', 'last')).toEqual(new Set(['a', 'b']));
    });
});
