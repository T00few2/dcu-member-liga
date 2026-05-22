'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import RouteElevationChart from '@/components/races/RouteElevationChart';
import LiveRiderOverlay from '@/components/live-race/LiveRiderOverlay';
import LiveRiderTooltip from '@/components/live-race/LiveRiderTooltip';
import LiveRaceInfoCards from '@/components/live-race/LiveRaceInfoCards';
import LiveRaceResultsTable from '@/components/live-race/LiveRaceResultsTable';
import { useCurrentLiveRaceQuery, useLiveRidersQuery, useRouteElevationQuery } from '@/hooks/queries';
import { useLiveRaceDoc } from '@/hooks/live-race/useLiveRaceDoc';
import { clusterRiders, positionRiders, type RiderGroup } from '@/lib/live-race/cluster';
import type { CurrentLiveRace, Sprint } from '@/types/live';

interface CategoryTab {
    cat: string;
    label: string;
    groupName?: string;
    laps: number;
    sprints: Sprint[];
}

function getCategoryTabs(race: CurrentLiveRace): CategoryTab[] {
    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const tabs: CategoryTab[] = [];
        for (const group of race.raceGroups) {
            for (const cat of group.categories ?? []) {
                if (!cat?.category) continue;
                tabs.push({
                    cat: cat.category,
                    label: cat.category,
                    groupName: group.name || undefined,
                    laps: cat.laps ?? group.laps ?? race.laps ?? 1,
                    sprints: cat.sprints ?? group.sprints ?? [],
                });
            }
        }
        if (tabs.length) return tabs;
    }
    if (race.eventConfiguration?.length) {
        return race.eventConfiguration.map((cfg) => ({
            cat: cfg.customCategory,
            label: cfg.customCategory,
            laps: cfg.laps ?? race.laps ?? 1,
            sprints: cfg.sprints ?? [],
        }));
    }
    if (race.singleModeCategories?.length) {
        return race.singleModeCategories.map((cfg) => ({
            cat: cfg.category,
            label: cfg.category,
            laps: cfg.laps ?? race.laps ?? 1,
            sprints: cfg.sprints ?? [],
        }));
    }
    return [{ cat: 'A', label: 'A', laps: race.laps ?? 1, sprints: [] }];
}

export default function LiveRacePage() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const chartWrapRef = useRef<HTMLDivElement>(null);

    const { data: currentRace, isLoading: raceLoading } = useCurrentLiveRaceQuery();
    const tabs = useMemo(
        () => (currentRace ? getCategoryTabs(currentRace) : []),
        [currentRace],
    );

    const activeCat = searchParams.get('cat') || tabs[0]?.cat || 'A';
    const activeTab = tabs.find((t) => t.cat === activeCat) ?? tabs[0];

    const tabsByGroup = useMemo(() => {
        const buckets = new Map<string | undefined, CategoryTab[]>();
        const order: (string | undefined)[] = [];
        for (const t of tabs) {
            if (!buckets.has(t.groupName)) {
                buckets.set(t.groupName, []);
                order.push(t.groupName);
            }
            buckets.get(t.groupName)!.push(t);
        }
        return order.map((groupName) => ({
            groupName,
            tabs: buckets.get(groupName)!,
        }));
    }, [tabs]);

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

    const tabTotalDistanceKm = useMemo(() => {
        if (!currentRace) return 0;
        const raceLaps = Math.max(1, currentRace.laps ?? 1);
        const lapLengthKm = (currentRace.totalDistance ?? 0) / raceLaps;
        const tabLaps = Math.max(1, activeTab?.laps ?? raceLaps);
        return lapLengthKm > 0 ? lapLengthKm * tabLaps : currentRace.totalDistance ?? 0;
    }, [currentRace, activeTab]);

    const groups = useMemo(() => {
        if (!currentRace || !liveRiders.length) return [];
        const raceLaps = Math.max(1, currentRace.laps ?? 1);
        const lapLengthKm = (currentRace.totalDistance ?? 0) / raceLaps;
        const positioned = positionRiders(liveRiders, {
            leadInKm,
            totalDistanceKm: tabTotalDistanceKm,
            lapLengthKm: lapLengthKm || 1,
        });
        return clusterRiders(positioned, gapMeters);
    }, [currentRace, liveRiders, gapMeters, leadInKm, tabTotalDistanceKm]);

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

    const setCategory = useCallback(
        (cat: string) => {
            const params = new URLSearchParams(searchParams.toString());
            params.set('cat', cat);
            router.replace(`/live-race?${params.toString()}`);
        },
        [router, searchParams],
    );

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

    if (raceLoading) {
        return (
            <div className="container mx-auto px-4 py-12 text-center text-muted-foreground">
                Henter live løb…
            </div>
        );
    }

    if (!currentRace) {
        return (
            <div className="container mx-auto px-4 py-12 text-center">
                <h1 className="text-xl font-bold text-card-foreground mb-2">Live løb</h1>
                <p className="text-muted-foreground">
                    Ingen aktive løb lige nu.
                </p>
            </div>
        );
    }

    const laps = lapsForQuery;

    return (
        <div className="container mx-auto px-4 py-6 max-w-5xl">
            <header className="mb-4">
                <h1 className="text-2xl font-bold text-card-foreground">{currentRace.name}</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    {currentRace.map} · {currentRace.routeName} · {laps} omgang{laps !== 1 ? 'e' : ''}
                    {tabTotalDistanceKm > 0 && ` · ${tabTotalDistanceKm.toFixed(1)} km`}
                </p>
            </header>

            {tabs.length > 1 && (
                <div className="mb-4 space-y-2">
                    {tabsByGroup.map(({ groupName, tabs: groupTabs }) => (
                        <div key={groupName ?? '__nogroup'} className="flex flex-wrap items-center gap-2">
                            {groupName && (
                                <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground min-w-20">
                                    {groupName}
                                </span>
                            )}
                            {groupTabs.map((t) => (
                                <button
                                    key={`${groupName ?? ''}::${t.cat}`}
                                    type="button"
                                    onClick={() => setCategory(t.cat)}
                                    className={`px-3 py-1.5 rounded text-sm font-semibold border ${
                                        t.cat === activeCat
                                            ? 'bg-primary text-primary-foreground border-primary'
                                            : 'bg-card border-border text-muted-foreground hover:border-primary/50'
                                    }`}
                                >
                                    {t.label}
                                </button>
                            ))}
                        </div>
                    ))}
                </div>
            )}

            <div className="border border-border rounded-lg bg-card p-4">
                <h2 className="text-sm font-semibold text-card-foreground mb-2">Ruteprofil · live</h2>
                {currentRace.map && currentRace.routeName ? (
                    <div ref={chartWrapRef} className="relative">
                        <RouteElevationChart
                            worldName={currentRace.map}
                            routeName={currentRace.routeName}
                            laps={laps}
                            pointSegments={activeTab?.sprints}
                            overlay={(ctx) => (
                                <LiveRiderOverlay
                                    groups={groups}
                                    selectedGroup={selectedGroup}
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
                totalDistanceKm={tabTotalDistanceKm}
                groups={groups}
                frontGroup={frontGroup}
                selectedGroup={selectedGroup}
                onSelectGroup={handleSelectGroup}
            />

            <LiveRaceResultsTable
                race={liveRaceDoc}
                category={activeCat}
                loading={resultsLoading}
            />
        </div>
    );
}
