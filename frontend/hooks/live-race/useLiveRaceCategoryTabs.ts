'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
    getLiveRaceCategoryTabs,
    groupLiveRaceCategoryTabs,
    type LiveRaceCategoryTab,
} from '@/lib/live-race/categoryTabs';
import { sortCategoriesByRank } from '@/lib/categories';
import type { CurrentLiveRace } from '@/types/live';

interface Options {
    /**
     * Category names ordered best -> worst (e.g. `categoryRankOrder(leagueSettings)`).
     * When given, the default category is the best-ranked tab rather than the first
     * tab in the race configuration. Omit to keep the configuration order.
     */
    rankOrder?: string[];
}

export function useLiveRaceCategoryTabs(
    race: CurrentLiveRace | null | undefined,
    { rankOrder }: Options = {},
) {
    const router = useRouter();
    const pathname = usePathname();
    const searchParams = useSearchParams();

    const tabs = useMemo(
        () => (race ? getLiveRaceCategoryTabs(race) : []),
        [race],
    );

    // Default tab: the best-ranked category when a rank order is supplied,
    // otherwise the first tab as configured on the race.
    const defaultCat = useMemo(() => {
        if (!tabs.length) return undefined;
        if (!rankOrder?.length) return tabs[0].cat;
        const [best] = sortCategoriesByRank(tabs.map((t) => t.cat), rankOrder);
        return best ?? tabs[0].cat;
    }, [tabs, rankOrder]);

    const activeCat = searchParams.get('cat') || defaultCat || 'A';
    const activeTab: LiveRaceCategoryTab | undefined = tabs.find((t) => t.cat === activeCat) ?? tabs[0];

    useEffect(() => {
        if (!tabs.length || !defaultCat) return;
        if (tabs.find((t) => t.cat === activeCat)) return;
        const params = new URLSearchParams(searchParams.toString());
        params.set('cat', defaultCat);
        router.replace(`${pathname}?${params.toString()}`);
    }, [tabs, defaultCat, activeCat, router, pathname, searchParams]);

    const setCategory = useCallback(
        (cat: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('cat', cat);
            router.replace(`${pathname}?${params.toString()}`);
        },
        [router, pathname, searchParams],
    );

    const tabsByGroup = useMemo(() => groupLiveRaceCategoryTabs(tabs), [tabs]);

    return { tabs, tabsByGroup, activeCat, activeTab, setCategory };
}
