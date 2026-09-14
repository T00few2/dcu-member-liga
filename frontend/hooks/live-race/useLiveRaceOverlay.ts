'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useLeagueSettingsQuery } from '@/hooks/queries';
import { useLiveRaceView } from '@/hooks/live-race/useLiveRaceView';
import { categoryRankOrder } from '@/lib/ligaCategories';

interface Options {
    /**
     * Drive the server-side results recalculation. Only one overlay should do
     * this, otherwise every open browser source triggers its own refresh.
     */
    autoRefresh?: boolean;
}

/**
 * `useLiveRaceView` with the stream-overlay defaults: the best division per the
 * league's category ranking is selected unless `?cat=` says otherwise, and
 * polling keeps running even when the browser source reports itself hidden.
 */
export function useLiveRaceOverlay({ autoRefresh = false }: Options = {}) {
    const searchParams = useSearchParams();
    const { data: leagueSettings } = useLeagueSettingsQuery();

    const rankOrder = useMemo(() => categoryRankOrder(leagueSettings), [leagueSettings]);

    const gapMeters = useMemo(() => {
        const raw = searchParams.get('gap');
        const n = raw ? parseInt(raw, 10) : 50;
        return Number.isFinite(n) && n > 0 ? n : 50;
    }, [searchParams]);

    return useLiveRaceView({ gapMeters, rankOrder, autoRefresh, refetchInBackground: true });
}
