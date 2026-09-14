'use client';

import { Suspense } from 'react';
import { InfoView } from '@/components/live-race/LiveRaceResultsTable';
import { useLiveRaceOverlay } from '@/hooks/live-race/useLiveRaceOverlay';

function InfoOverlay() {
    const { race, laps, activeTab } = useLiveRaceOverlay();

    if (!race) return null;

    return (
        <InfoView
            sprints={activeTab?.sprints ?? []}
            laps={laps}
            routeId={race.routeId}
            worldName={race.map}
            routeName={race.routeName}
        />
    );
}

export default function LiveRaceInfoOverlayPage() {
    return (
        <Suspense fallback={null}>
            <InfoOverlay />
        </Suspense>
    );
}
