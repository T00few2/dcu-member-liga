'use client';

import { useEffect, useMemo, useState } from 'react';
import {
    useCurrentLiveRaceQuery,
    useLiveRidersQuery,
    useRouteElevationQuery,
    useUpcomingRaceQuery,
} from '@/hooks/queries';
import { useLiveRaceAutoRefresh } from '@/hooks/queries/useLiveRaceAutoRefresh';
import { useLiveRaceDoc } from '@/hooks/live-race/useLiveRaceDoc';
import { useLiveRaceCategoryTabs } from '@/hooks/live-race/useLiveRaceCategoryTabs';
import { clusterRiders, positionRiders } from '@/lib/live-race/cluster';
import { fromTimestamp } from '@/lib/formatDate';
import { scaleRaceDistanceKm } from '@/hooks/useLeagueData';

interface Options {
    /** Cluster distance in metres used to group riders on the profile. */
    gapMeters?: number;
    /** Category names ordered best -> worst; makes the best division the default tab. */
    rankOrder?: string[];
    /**
     * Whether this view should drive the server-side results recalculation.
     * Every consumer that enables this POSTs `/live-race/active/results/refresh`
     * on an interval, so read-only views (e.g. stream overlays) should pass false.
     */
    autoRefresh?: boolean;
    /**
     * Keep polling while the document reports hidden. OBS browser sources can be
     * reported as hidden, which would otherwise pause react-query's intervals.
     */
    refetchInBackground?: boolean;
}

/**
 * All live-race data for a single category: the active (or upcoming) race, the
 * category tabs, the live rider positions clustered into groups, the route
 * elevation profile and the realtime race document behind the results table.
 *
 * Single source of truth for `/live-race` and the stream overlay pages.
 */
export function useLiveRaceView({
    gapMeters = 50,
    rankOrder,
    autoRefresh = true,
    refetchInBackground = false,
}: Options = {}) {
    const { data: upcomingRace, isLoading: upcomingLoading } = useUpcomingRaceQuery();

    // Flip to fast polling once the upcoming race's start time arrives so the
    // auto-activation is picked up within a few seconds.
    const upcomingDate = useMemo(
        () => (upcomingRace?.date ? fromTimestamp(upcomingRace.date) : null),
        [upcomingRace?.date],
    );
    const [isRaceDue, setIsRaceDue] = useState(
        () => (upcomingDate ? upcomingDate.getTime() <= Date.now() : false),
    );
    useEffect(() => {
        if (!upcomingDate || isRaceDue) return;
        const ms = upcomingDate.getTime() - Date.now();
        if (ms <= 0) { setIsRaceDue(true); return; }
        const tid = setTimeout(() => setIsRaceDue(true), ms);
        return () => clearTimeout(tid);
    }, [upcomingDate, isRaceDue]);

    const { data: currentRace, isLoading: raceLoading } = useCurrentLiveRaceQuery(
        isRaceDue ? 5_000 : 30_000,
        refetchInBackground,
    );

    useLiveRaceAutoRefresh({
        enabled: autoRefresh && !!currentRace && currentRace.resultsPhase !== 'finalized',
        intervalSeconds: currentRace?.resultsAutomation?.pollingIntervalSeconds ?? 30,
    });

    const race = currentRace ?? upcomingRace ?? null;

    const { tabs, tabsByGroup, activeCat, activeTab, setCategory } = useLiveRaceCategoryTabs(
        race,
        { rankOrder },
    );

    const { data: liveRidersResp } = useLiveRidersQuery(currentRace?.id, activeCat, refetchInBackground);
    const liveRiders = useMemo(() => liveRidersResp?.riders ?? [], [liveRidersResp]);

    const laps = activeTab?.laps ?? currentRace?.laps ?? 1;
    const { data: elevationData } = useRouteElevationQuery(
        race?.map,
        race?.routeName,
        laps,
    );
    const leadInKm = Number(elevationData?.leadInDistance) || 0;

    const { race: liveRaceDoc, loading: resultsLoading } = useLiveRaceDoc(currentRace?.id);

    // Chart / positioning use race-only km (lead-in stripped). Info cards use full ride km.
    const { tabTotalWithLeadInKm, tabRaceOnlyKm, lapLengthKm } = useMemo(() => {
        if (!currentRace) {
            return { tabTotalWithLeadInKm: 0, tabRaceOnlyKm: 0, lapLengthKm: 1 };
        }
        const raceLaps = Math.max(1, currentRace.laps ?? 1);
        const tabLaps = Math.max(1, activeTab?.laps ?? raceLaps);
        const withLeadIn = scaleRaceDistanceKm(
            currentRace.totalDistance ?? 0,
            raceLaps,
            tabLaps,
            leadInKm,
        );
        const raceOnly = Math.max(0, withLeadIn - leadInKm);
        const perLap = raceOnly / tabLaps;
        return {
            tabTotalWithLeadInKm: withLeadIn,
            tabRaceOnlyKm: raceOnly,
            lapLengthKm: perLap > 0 ? perLap : 1,
        };
    }, [currentRace, activeTab, leadInKm]);

    const groups = useMemo(() => {
        if (!currentRace || !liveRiders.length) return [];
        const positioned = positionRiders(liveRiders, {
            leadInKm,
            totalDistanceKm: tabRaceOnlyKm,
            lapLengthKm,
        });
        return clusterRiders(positioned, gapMeters);
    }, [currentRace, liveRiders, gapMeters, leadInKm, tabRaceOnlyKm, lapLengthKm]);

    const frontGroup = groups.length ? groups[groups.length - 1] : null;

    return {
        currentRace: currentRace ?? null,
        upcomingRace: upcomingRace ?? null,
        /** The race to render metadata from: the active one, else the upcoming one. */
        race,
        raceLoading,
        upcomingLoading,
        tabs,
        tabsByGroup,
        activeCat,
        activeTab,
        setCategory,
        liveRiders,
        elevationData,
        leadInKm,
        laps,
        tabTotalWithLeadInKm,
        tabRaceOnlyKm,
        lapLengthKm,
        groups,
        frontGroup,
        liveRaceDoc,
        resultsLoading,
    };
}
