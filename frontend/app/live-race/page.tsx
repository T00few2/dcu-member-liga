'use client';

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import LiveRaceProfileCard from '@/components/live-race/LiveRaceProfileCard';
import LiveRaceInfoCards from '@/components/live-race/LiveRaceInfoCards';
import LiveRaceResultsTable from '@/components/live-race/LiveRaceResultsTable';
import LiveRaceCategoryTabs from '@/components/live-race/LiveRaceCategoryTabs';
import UpcomingRaceCountdown from '@/components/live-race/UpcomingRaceCountdown';
import { useLiveRaceView } from '@/hooks/live-race/useLiveRaceView';
import type { RiderGroup } from '@/lib/live-race/cluster';

function LiveRacePageContent() {
    const searchParams = useSearchParams();

    const gapMeters = useMemo(() => {
        const raw = searchParams.get('gap');
        const n = raw ? parseInt(raw, 10) : 50;
        return Number.isFinite(n) && n > 0 ? n : 50;
    }, [searchParams]);

    const {
        currentRace,
        upcomingRace,
        raceLoading,
        upcomingLoading,
        tabsByGroup,
        activeCat,
        activeTab,
        setCategory,
        liveRiders,
        laps,
        tabTotalWithLeadInKm,
        leadInKm,
        groups,
        frontGroup,
        liveRaceDoc,
        resultsLoading,
    } = useLiveRaceView({ gapMeters });

    const [selectedRiderIds, setSelectedRiderIds] = useState<Set<string> | null>(null);

    // Reset selection when category or race changes.
    useEffect(() => {
        setSelectedRiderIds(null);
    }, [activeCat, currentRace?.id]);

    // Map the previously selected rider set onto the latest groups so the
    // selection survives polling updates (riders shift between groups slightly).
    const selectedGroup: RiderGroup | null = useMemo(() => {
        if (!groups.length) return null;
        if (!selectedRiderIds || selectedRiderIds.size === 0) return frontGroup;
        let best: { group: RiderGroup; overlap: number } | null = null;
        for (const g of groups) {
            let overlap = 0;
            for (const r of g.riders) {
                if (selectedRiderIds.has(r.userId)) overlap += 1;
            }
            if (overlap > 0 && (!best || overlap > best.overlap)) {
                best = { group: g, overlap };
            }
        }
        return best?.group ?? frontGroup;
    }, [groups, frontGroup, selectedRiderIds]);

    const handleSelectGroup = useCallback((group: RiderGroup) => {
        setSelectedRiderIds(new Set(group.riders.map((r) => r.userId)));
    }, []);

    if (raceLoading || upcomingLoading) {
        return (
            <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
                Henter live løb…
            </div>
        );
    }

    if (!currentRace) {
        if (upcomingRace) {
            return (
                <UpcomingRaceCountdown
                    race={upcomingRace}
                    tabsByGroup={tabsByGroup}
                    activeCat={activeCat}
                    activeTab={activeTab}
                    onSelectCategory={setCategory}
                />
            );
        }
        return (
            <div className="container mx-auto px-4 py-12 text-center">
                <h1 className="text-xl font-bold text-card-foreground mb-2">Live løb</h1>
                <p className="text-muted-foreground">Ingen aktive løb lige nu.</p>
            </div>
        );
    }

    return (
        <div className="container mx-auto px-4 py-6 max-w-5xl">
            <header className="mb-4">
                <h1 className="text-2xl font-bold text-card-foreground">{currentRace.name}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {currentRace.map || 'TBD'} · {currentRace.routeName || 'TBD'}
                    {currentRace.routeName
                        ? ` · ${laps} omgang${laps !== 1 ? 'e' : ''}${tabTotalWithLeadInKm > 0 ? ` · ${tabTotalWithLeadInKm.toFixed(1)} km` : ''}`
                        : ''}
                </p>
            </header>

            <LiveRaceCategoryTabs
                tabsByGroup={tabsByGroup}
                activeCat={activeCat}
                onSelect={setCategory}
            />

            <LiveRaceProfileCard
                race={currentRace}
                laps={laps}
                pointSegments={activeTab?.sprints}
                groups={groups}
                selectedRiderIds={selectedRiderIds}
                onSelectGroup={handleSelectGroup}
            />

            <LiveRaceInfoCards
                race={currentRace}
                totalDistanceKm={tabTotalWithLeadInKm}
                leadInKm={leadInKm}
                groups={groups}
                frontGroup={frontGroup}
                selectedGroup={selectedGroup}
                selectedRiderIds={selectedRiderIds}
                onSelectGroup={handleSelectGroup}
            />

            <LiveRaceResultsTable
                race={liveRaceDoc}
                category={activeCat}
                loading={resultsLoading}
                sprints={activeTab?.sprints ?? []}
                laps={laps}
                routeId={currentRace.routeId}
                worldName={currentRace.map}
                routeName={currentRace.routeName}
                liveRiders={liveRiders}
                isLive={currentRace.resultsPhase !== 'finalized'}
            />
        </div>
    );
}

export default function LiveRacePage() {
    return (
        <Suspense
            fallback={
                <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
                    Henter live løb…
                </div>
            }
        >
            <LiveRacePageContent />
        </Suspense>
    );
}
