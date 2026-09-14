'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import LiveRaceProfileCard from '@/components/live-race/LiveRaceProfileCard';
import { useLiveRaceOverlay } from '@/hooks/live-race/useLiveRaceOverlay';

function ProfileOverlay() {
    const searchParams = useSearchParams();
    const { race, laps, activeTab, groups } = useLiveRaceOverlay();

    // Browser sources are a fixed size; let the chart be sized to match.
    const height = useMemo(() => {
        const raw = searchParams.get('height');
        const n = raw ? parseInt(raw, 10) : NaN;
        return Number.isFinite(n) && n > 0 ? n : undefined;
    }, [searchParams]);

    if (!race) return null;

    return (
        <LiveRaceProfileCard
            race={race}
            laps={laps}
            pointSegments={activeTab?.sprints}
            groups={groups}
            selectedRiderIds={null}
            height={height}
            bare
        />
    );
}

export default function LiveRaceProfileOverlayPage() {
    return (
        <Suspense fallback={null}>
            <ProfileOverlay />
        </Suspense>
    );
}
