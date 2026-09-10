import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveRaceCategoryTabs } from '@/hooks/live-race/useLiveRaceCategoryTabs';
import type { CurrentLiveRace } from '@/types/live';

const replace = vi.fn();
let search = '';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace }),
    useSearchParams: () => new URLSearchParams(search),
}));

const race = {
    eventMode: 'grouped',
    laps: 2,
    raceGroups: [
        {
            name: 'High end',
            laps: 3,
            categories: [{ category: 'Diamond' }, { category: 'Ruby' }],
        },
        {
            name: 'Low end',
            categories: [{ category: 'Gold' }],
        },
    ],
} as unknown as CurrentLiveRace;

describe('useLiveRaceCategoryTabs', () => {
    beforeEach(() => {
        replace.mockClear();
        search = '';
    });

    it('defaults to the first category and writes ?cat= on select', () => {
        const { result } = renderHook(() => useLiveRaceCategoryTabs(race));
        expect(result.current.activeCat).toBe('Diamond');
        expect(result.current.tabs.map((t) => t.cat)).toEqual(['Diamond', 'Ruby', 'Gold']);

        act(() => {
            result.current.setCategory('Gold');
        });
        expect(replace).toHaveBeenCalledWith('/live-race?cat=Gold');
    });

    it('rewrites a stale category back to the first tab', () => {
        search = 'cat=Nope';
        renderHook(() => useLiveRaceCategoryTabs(race));
        expect(replace).toHaveBeenCalledWith('/live-race?cat=Diamond');
    });
});
