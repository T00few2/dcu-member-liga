'use client';

import { Suspense } from 'react';
import { LiveResultsView } from '@/components/live-race/LiveRaceResultsTable';
import { useLiveRaceOverlay } from '@/hooks/live-race/useLiveRaceOverlay';

function PointsOverlay() {
    // This overlay drives the results recalculation so the table stays current
    // even when nobody has /live-race open.
    const { race, currentRace, activeCat, activeTab, liveRaceDoc, resultsLoading, liveRiders } =
        useLiveRaceOverlay({ autoRefresh: true });

    if (!race) return null;

    return (
        <LiveResultsView
            race={liveRaceDoc}
            category={activeCat}
            loading={resultsLoading}
            prerace={!currentRace}
            liveRiders={liveRiders}
            isLive={!!currentRace && currentRace.resultsPhase !== 'finalized'}
            sprints={activeTab?.sprints}
        />
    );
}

export default function LiveRacePointsOverlayPage() {
    return (
        <Suspense fallback={null}>
            <PointsOverlay />
        </Suspense>
    );
}
