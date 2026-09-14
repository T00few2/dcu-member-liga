import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useLiveRaceCategoryTabs } from '@/hooks/live-race/useLiveRaceCategoryTabs';
import type { CurrentLiveRace } from '@/types/live';

const replace = vi.fn();
let search = '';
let pathname = '/live-race';

vi.mock('next/navigation', () => ({
    useRouter: () => ({ replace }),
    usePathname: () => pathname,
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
        pathname = '/live-race';
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

    it('stays on the current route instead of navigating to /live-race', () => {
        pathname = '/live-race/overlay/points';
        const { result } = renderHook(() => useLiveRaceCategoryTabs(race));

        act(() => {
            result.current.setCategory('Ruby');
        });
        expect(replace).toHaveBeenCalledWith('/live-race/overlay/points?cat=Ruby');
    });

    it('defaults to the best-ranked category when a rank order is given', () => {
        const rankOrder = ['Gold', 'Ruby', 'Diamond'];
        const { result } = renderHook(() => useLiveRaceCategoryTabs(race, { rankOrder }));
        expect(result.current.activeCat).toBe('Gold');
        expect(result.current.activeTab?.cat).toBe('Gold');
    });

    it('rewrites a stale category to the best-ranked tab when ranked', () => {
        search = 'cat=Nope';
        renderHook(() => useLiveRaceCategoryTabs(race, { rankOrder: ['Gold', 'Ruby', 'Diamond'] }));
        expect(replace).toHaveBeenCalledWith('/live-race?cat=Gold');
    });

    it('keeps ?cat= when it names a real tab', () => {
        search = 'cat=Ruby';
        const { result } = renderHook(() =>
            useLiveRaceCategoryTabs(race, { rankOrder: ['Diamond', 'Ruby', 'Gold'] }),
        );
        expect(result.current.activeCat).toBe('Ruby');
        expect(replace).not.toHaveBeenCalled();
    });
});
