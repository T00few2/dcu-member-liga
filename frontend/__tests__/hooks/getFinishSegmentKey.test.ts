import { describe, expect, it } from 'vitest';
import { getFinishSegmentKey } from '@/hooks/useLeagueData';
import type { Segment } from '@/types/admin';

function seg(partial: Partial<Segment> & Pick<Segment, 'id' | 'name'>): Segment {
    return {
        count: 1,
        direction: 'forward',
        lap: 1,
        ...partial,
    };
}

describe('getFinishSegmentKey', () => {
    it('does not treat the last climb as the finish', () => {
        const segments = [
            seg({ id: 'sprint', name: 'SPRINT' }),
            seg({ id: 'broad', name: 'BROAD ST.' }),
            seg({ id: 'kom', name: 'KOM' }),
            seg({ id: '23rd', name: '23RD ST.' }),
        ];
        expect(getFinishSegmentKey(segments, 1)).toBeNull();
    });

    it('tags only the banner that ends the race lap', () => {
        const segments = [
            seg({ id: 'sprint', name: 'SPRINT', lap: 1 }),
            seg({ id: 'finish', name: 'UCI COURSE', lap: 1, isFinish: true }),
            seg({ id: 'sprint', name: 'SPRINT', lap: 2, count: 2 }),
            seg({ id: 'finish', name: 'UCI COURSE', lap: 2, count: 2, isFinish: true }),
        ];
        expect(getFinishSegmentKey(segments, 1)).toBe('finish_1');
        expect(getFinishSegmentKey(segments)).toBe('finish_2');
    });
});
