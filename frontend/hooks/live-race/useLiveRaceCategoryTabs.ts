'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import {
    getLiveRaceCategoryTabs,
    groupLiveRaceCategoryTabs,
    type LiveRaceCategoryTab,
} from '@/lib/live-race/categoryTabs';
import type { CurrentLiveRace } from '@/types/live';

export function useLiveRaceCategoryTabs(race: CurrentLiveRace | null | undefined) {
    const router = useRouter();
    const searchParams = useSearchParams();

    const tabs = useMemo(
        () => (race ? getLiveRaceCategoryTabs(race) : []),
        [race],
    );

    const activeCat = searchParams.get('cat') || tabs[0]?.cat || 'A';
    const activeTab: LiveRaceCategoryTab | undefined = tabs.find((t) => t.cat === activeCat) ?? tabs[0];

    useEffect(() => {
        if (!tabs.length || !tabs[0]) return;
        if (tabs.find((t) => t.cat === activeCat)) return;
        const params = new URLSearchParams(searchParams.toString());
        params.set('cat', tabs[0].cat);
        router.replace(`/live-race?${params.toString()}`);
    }, [tabs, activeCat, router, searchParams]);

    const setCategory = useCallback(
        (cat: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('cat', cat);
            router.replace(`/live-race?${params.toString()}`);
        },
        [router, searchParams],
    );

    const tabsByGroup = useMemo(() => groupLiveRaceCategoryTabs(tabs), [tabs]);

    return { tabs, tabsByGroup, activeCat, activeTab, setCategory };
}
