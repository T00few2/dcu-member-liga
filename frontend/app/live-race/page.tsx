'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import RouteElevationChart from '@/components/races/RouteElevationChart';
import LiveRiderOverlay from '@/components/live-race/LiveRiderOverlay';
import LiveRiderTooltip from '@/components/live-race/LiveRiderTooltip';
import LiveRaceInfoCards from '@/components/live-race/LiveRaceInfoCards';
import LiveRaceResultsTable from '@/components/live-race/LiveRaceResultsTable';
import LiveRaceCategoryTabs from '@/components/live-race/LiveRaceCategoryTabs';
import UpcomingRaceCountdown from '@/components/live-race/UpcomingRaceCountdown';
import { useCurrentLiveRaceQuery, useLiveRidersQuery, useRouteElevationQuery, useUpcomingRaceQuery } from '@/hooks/queries';
import { useLiveRaceAutoRefresh } from '@/hooks/queries/useLiveRaceAutoRefresh';
import { useLiveRaceDoc } from '@/hooks/live-race/useLiveRaceDoc';
import { useLiveRaceCategoryTabs } from '@/hooks/live-race/useLiveRaceCategoryTabs';
import { clusterRiders, positionRiders, type RiderGroup } from '@/lib/live-race/cluster';
import { fromTimestamp } from '@/lib/formatDate';
import { scaleRaceDistanceKm } from '@/hooks/useLeagueData';

function LiveRacePageContent() {
    const searchParams = useSearchParams();
    const chartWrapRef = useRef<HTMLDivElement>(null);

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

    const { data: currentRace, isLoading: raceLoading } = useCurrentLiveRaceQuery(isRaceDue ? 5_000 : 30_000);

    useLiveRaceAutoRefresh({
        enabled: !!currentRace && currentRace.resultsPhase !== 'finalized',
        intervalSeconds: currentRace?.resultsAutomation?.pollingIntervalSeconds ?? 30,
    });

    const { tabsByGroup, activeCat, activeTab, setCategory } = useLiveRaceCategoryTabs(
        currentRace ?? upcomingRace,
    );

    const { data: liveRidersResp } = useLiveRidersQuery(currentRace?.id, activeCat);
    const liveRiders = liveRidersResp?.riders ?? [];

    const lapsForQuery = activeTab?.laps ?? currentRace?.laps ?? 1;
    const { data: elevationData } = useRouteElevationQuery(
        currentRace?.map,
        currentRace?.routeName,
        lapsForQuery,
    );
    const leadInKm = Number(elevationData?.leadInDistance) || 0;

    const { race: liveRaceDoc, loading: resultsLoading } = useLiveRaceDoc(currentRace?.id);

    const [selectedRiderIds, setSelectedRiderIds] = useState<Set<string> | null>(null);
    const [hoverGroup, setHoverGroup] = useState<RiderGroup | null>(null);
    const [hoverPos, setHoverPos] = useState({ x: 0, y: 0 });

    // Reset selection when category or race changes.
    useEffect(() => {
        setSelectedRiderIds(null);
    }, [activeCat, currentRace?.id]);

    const gapMeters = useMemo(() => {
        const raw = searchParams.get('gap');
        const n = raw ? parseInt(raw, 10) : 50;
        return Number.isFinite(n) && n > 0 ? n : 50;
    }, [searchParams]);

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

    const handleGroupHover = useCallback(
        (group: RiderGroup | null, clientX: number, clientY: number) => {
            if (!group || !chartWrapRef.current) {
                setHoverGroup(null);
                return;
            }
            const rect = chartWrapRef.current.getBoundingClientRect();
            setHoverGroup(group);
            setHoverPos({ x: clientX - rect.left, y: clientY - rect.top });
        },
        [],
    );

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

    const laps = lapsForQuery;

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

            <div className="border border-border rounded-lg bg-card p-4">
                <h2 className="text-sm font-semibold text-card-foreground mb-2">Ruteprofil · live</h2>
                {currentRace.map && currentRace.routeName ? (
                    <div ref={chartWrapRef} className="relative">
                        <RouteElevationChart
                            worldName={currentRace.map}
                            routeName={currentRace.routeName}
                            laps={laps}
                            routeId={currentRace.routeId}
                            pointSegments={activeTab?.sprints}
                            overlay={(ctx) => (
                                <LiveRiderOverlay
                                    groups={groups}
                                    selectedRiderIds={selectedRiderIds}
                                    onGroupClick={handleSelectGroup}
                                    onGroupHover={handleGroupHover}
                                    {...ctx}
                                />
                            )}
                        />
                        <LiveRiderTooltip group={hoverGroup} anchorX={hoverPos.x} anchorY={hoverPos.y} />
                    </div>
                ) : (
                    <p className="text-sm text-muted-foreground">Ruteprofil ikke tilgængelig.</p>
                )}
            </div>

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
