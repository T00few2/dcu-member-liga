'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { usePathname, useRouter } from 'next/navigation';
import {
    useRacesQuery,
    useLeagueSettingsQuery,
    useRaceDrVerificationsQuery,
    useRaceWeightVerificationsQuery,
} from '@/hooks/queries';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { normalizeRace } from '@/lib/firestore-normalizers';
import type {
    Race,
    Sprint,
    ResultEntry,
    StandingEntry,
} from '@/types/live';
import StandingsTable from './_components/StandingsTable';
import RaceResultsTable from './_components/RaceResultsTable';
import ErrorBoundary from '@/components/ErrorBoundary';

type ProcessedRider = StandingEntry & { calculatedTotal: number; countingRaceIds: Set<string> };

const DEFAULT_CATEGORY_RANK = [
    'Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Amethyst', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Copper',
    'A', 'B', 'C', 'D', 'E',
];

const pickFirstNonEmpty = (...lists: (Sprint[] | undefined)[]): Sprint[] => {
    for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list;
    }
    return [];
};

export default function ResultsPage() {
    const { user, loading: authLoading, isRegistered } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    const parseTab = (value: string | null): 'standings' | 'results' => {
        return value === 'results' ? 'results' : 'standings';
    };

    const [activeTab, setActiveTab] = useState<'standings' | 'results'>('standings');
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('A');
    const [standingsCategory, setStandingsCategory] = useState<string>('');
    const [autoSelectStandingsCategory, setAutoSelectStandingsCategory] = useState(true);

    // ── Data fetching ────────────────────────────────────────────────────────
    const racesQuery = useRacesQuery();
    const settingsQuery = useLeagueSettingsQuery();
    const drVerificationsQuery = useRaceDrVerificationsQuery(selectedRaceId || null);
    const weightVerificationsQuery = useRaceWeightVerificationsQuery(selectedRaceId || null);

    // Real-time Firestore subscriptions replace onSnapshot useEffects
    const liveRaceDoc = useFirestoreDoc<Race>('races', selectedRaceId || null);
    const liveStandingsDoc = useFirestoreDoc<{ standings: Record<string, StandingEntry[]> }>(
        'league',
        'standings',
    );

    // ── Derived data ─────────────────────────────────────────────────────────

    // Merge real-time race update into the cached races list
    const races = useMemo<Race[]>(() => {
        const base = racesQuery.data ?? [];
        if (!liveRaceDoc.data || !selectedRaceId) return base;
        const updated = normalizeRace(liveRaceDoc.data, selectedRaceId);
        return base.map(r => (r.id === selectedRaceId ? { ...r, ...updated } : r));
    }, [racesQuery.data, liveRaceDoc.data, selectedRaceId]);

    // Prefer real-time Firestore standings; fall back to empty while loading
    const standings = liveStandingsDoc.data?.standings ?? {};

    const sortedRaces = useMemo(
        () =>
            [...races].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            ),
        [races],
    );

    const bestRacesCount = settingsQuery.data?.bestRacesCount ?? 5;
    const configuredCategoryNames = useMemo(() => {
        const cats = settingsQuery.data?.ligaCategories;
        return Array.isArray(cats) ? cats.map((c: { name: string }) => c.name) : [];
    }, [settingsQuery.data]);

    const drVerifications = drVerificationsQuery.data ?? new Map();
    const weightVerifications = weightVerificationsQuery.data ?? new Map();

    // Auto-select first race once loaded
    useEffect(() => {
        if (sortedRaces.length > 0 && !selectedRaceId) {
            setSelectedRaceId(sortedRaces[0].id);
        }
    }, [sortedRaces, selectedRaceId]);

    // Sync active tab from URL
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const syncFromUrl = () => {
            const params = new URLSearchParams(window.location.search);
            setActiveTab(parseTab(params.get('tab')));
        };
        syncFromUrl();
        window.addEventListener('popstate', syncFromUrl);
        return () => window.removeEventListener('popstate', syncFromUrl);
    }, []);

    const selectedRace = races.find(r => r.id === selectedRaceId);

    const categoryRankOrder = useMemo(
        () => configuredCategoryNames.length > 0
            ? [...configuredCategoryNames, ...DEFAULT_CATEGORY_RANK]
            : DEFAULT_CATEGORY_RANK,
        [configuredCategoryNames],
    );

    const availableRaceCategories = useMemo(() => {
        let cats: string[];
        if (selectedRace?.results && Object.keys(selectedRace.results).length > 0) {
            cats = Object.keys(selectedRace.results);
        } else if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
            cats = selectedRace.eventConfiguration.map(c => c.customCategory).filter(Boolean) as string[];
        } else if (selectedRace?.singleModeCategories?.length) {
            cats = selectedRace.singleModeCategories.map(c => c.category).filter(Boolean) as string[];
        } else {
            cats = configuredCategoryNames.length > 0 ? configuredCategoryNames : ['A', 'B', 'C', 'D', 'E'];
        }
        return sortCategoriesByRank(cats, categoryRankOrder);
    }, [selectedRace, configuredCategoryNames, categoryRankOrder]);

    const displayRaceCategory = (selectedRace?.results && !availableRaceCategories.includes(selectedCategory) && availableRaceCategories.length > 0)
        ? availableRaceCategories[0]
        : selectedCategory;

    const raceResults: ResultEntry[] = selectedRace?.results?.[displayRaceCategory] || [];
    const leaguePointsByZwiftId = useMemo(() => {
        const map = new Map<string, number>();
        const raceKey = selectedRaceId;
        if (!raceKey) return map;
        (standings[displayRaceCategory] || []).forEach(entry => {
            const match = entry.results?.find(r => r.raceId === raceKey);
            if (match) map.set(entry.zwiftId, match.points);
        });
        return map;
    }, [standings, displayRaceCategory, selectedRaceId]);

    const displayLaps = useMemo(() => {
        if (!selectedRace) return undefined;
        if (selectedRace.eventMode === 'multi' && selectedRace.eventConfiguration) {
            const cfg = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
            if (cfg?.laps) return cfg.laps;
        } else if (selectedRace.singleModeCategories?.length) {
            const cfg = selectedRace.singleModeCategories.find(c => c.category === displayRaceCategory);
            if (cfg?.laps) return cfg.laps;
        }
        return selectedRace.laps;
    }, [selectedRace, displayRaceCategory]);

    const availableStandingsCategories = useMemo(() => {
        const cats = Object.keys(standings).length > 0 ? Object.keys(standings) : [...availableRaceCategories];
        return sortCategoriesByRank(cats, categoryRankOrder);
    }, [standings, availableRaceCategories, categoryRankOrder]);

    const displayStandingsCategory = (Object.keys(standings).length > 0 && !availableStandingsCategories.includes(standingsCategory))
        ? availableStandingsCategories[0]
        : standingsCategory;

    const selectedRaceLoaded = !selectedRaceId || races.some(r => r.id === selectedRaceId);

    useEffect(() => {
        if (!autoSelectStandingsCategory) return;
        if (!selectedRaceLoaded) return;
        if (availableStandingsCategories.length === 0) return;
        setStandingsCategory(availableStandingsCategories[0]);
        setAutoSelectStandingsCategory(false);
    }, [autoSelectStandingsCategory, selectedRaceLoaded, availableStandingsCategories]);

    const handleStandingsCategoryChange = (cat: string) => {
        setStandingsCategory(cat);
        setAutoSelectStandingsCategory(false);
    };

    const currentStandings = useMemo<ProcessedRider[]>(() => {
        return (standings[displayStandingsCategory] || [])
            .map(rider => {
                const sorted = [...(rider.results ?? [])].sort((a, b) => b.points - a.points);
                const countingRaceIds = new Set(sorted.slice(0, bestRacesCount).map(r => r.raceId));
                const calculatedTotal = sorted.slice(0, bestRacesCount).reduce((sum, r) => sum + r.points, 0);
                return { ...rider, results: rider.results ?? [], calculatedTotal, countingRaceIds };
            })
            .sort((a, b) => b.calculatedTotal - a.calculatedTotal);
    }, [standings, displayStandingsCategory, bestRacesCount]);

    const { sprintColumns, bestSplitTimes } = useMemo(() => {
        const allSprintKeys = new Set<string>();
        raceResults.forEach(r => {
            if (r.sprintDetails) Object.keys(r.sprintDetails).forEach(k => allSprintKeys.add(k));
        });

        const orderedSprints = getConfiguredSprintsForCategory(selectedRace, displayRaceCategory);

        const columns: string[] = [];
        orderedSprints.forEach(s => {
            const key = [s.key, `${s.id}_${s.count}`, s.id].filter(Boolean).find(k => allSprintKeys.has(k!)) as string | undefined;
            if (key) { columns.push(key); allSprintKeys.delete(key); }
        });

        const finalColumns = [...columns, ...Array.from(allSprintKeys).sort()];
        const splitTimes: Record<string, number> = {};
        finalColumns.forEach(key => {
            const sample = raceResults.find(r => r.sprintDetails?.[key])?.sprintDetails?.[key];
            if (typeof sample === 'number' && sample > 1_000_000) {
                const times = raceResults.map(r => r.sprintDetails?.[key]).filter((v): v is number => typeof v === 'number' && v > 0);
                if (times.length > 0) splitTimes[key] = Math.min(...times);
            }
        });

        return { sprintColumns: finalColumns, bestSplitTimes: splitTimes };
    }, [selectedRace, raceResults, displayRaceCategory]);

    const isLoading = authLoading || racesQuery.isLoading || settingsQuery.isLoading || liveStandingsDoc.loading;

    if (isLoading) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser resultater...</div>;
    }

    const getSprintHeader = (key: string): string => {
        const sourceSprints = getConfiguredSprintsForCategory(selectedRace, displayRaceCategory);

        if (sourceSprints.length === 0) return key.replace(/_/g, ' ');
        const sprint = sourceSprints.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
        if (sprint) return `${sprint.name} #${sprint.count}`;

        const parts = key.split('_');
        if (parts.length >= 2) {
            const match = sourceSprints.find(s => s.id == parts[0] && s.count == parseInt(parts[1]));
            if (match) return `${match.name} #${match.count}`;
        }
        return key.replace(/_/g, ' ');
    };

    const setResultsTab = (tab: 'standings' | 'results') => {
        setActiveTab(tab);
        const params = new URLSearchParams(
            typeof window === 'undefined' ? '' : window.location.search,
        );
        params.set('tab', tab);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    };

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Resultater & Stilling</h1>

            <div className="flex gap-4 mb-8 border-b border-border">
                <button
                    onClick={() => setResultsTab('standings')}
                    className={`pb-2 px-4 font-medium transition ${activeTab === 'standings' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Ligastilling
                </button>
                <button
                    onClick={() => setResultsTab('results')}
                    className={`pb-2 px-4 font-medium transition ${activeTab === 'results' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Løbsresultater
                </button>
            </div>

            {activeTab === 'standings' && (
                <ErrorBoundary label="Ligastilling">
                    <StandingsTable
                        currentStandings={currentStandings}
                        races={races}
                        availableStandingsCategories={availableStandingsCategories}
                        displayStandingsCategory={displayStandingsCategory}
                        standingsCategory={standingsCategory}
                        setStandingsCategory={handleStandingsCategoryChange}
                    />
                </ErrorBoundary>
            )}

            {activeTab === 'results' && (
                <ErrorBoundary label="Løbsresultater">
                    <RaceResultsTable
                        races={races}
                        selectedRaceId={selectedRaceId}
                        setSelectedRaceId={setSelectedRaceId}
                        selectedRace={selectedRace}
                        availableRaceCategories={availableRaceCategories}
                        displayRaceCategory={displayRaceCategory}
                        selectedCategory={selectedCategory}
                        setSelectedCategory={setSelectedCategory}
                        displayLaps={displayLaps}
                        raceResults={raceResults}
                        sprintColumns={sprintColumns}
                        bestSplitTimes={bestSplitTimes}
                        getSprintHeader={getSprintHeader}
                        leaguePointsByZwiftId={leaguePointsByZwiftId}
                        drVerifications={drVerifications}
                        weightVerifications={weightVerifications}
                        user={user}
                    />
                </ErrorBoundary>
            )}
        </div>
    );
}

function getConfiguredSprintsForCategory(race: Race | undefined, category: string): Sprint[] {
    if (!race) return [];

    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups.find(g => (g.categories || []).some(c => c.category === category));
        const catCfg = group?.categories?.find(c => c.category === category);
        return pickFirstNonEmpty(
            catCfg?.sprints,
            group?.sprints,
            race.sprints,
            race.sprintData,
        );
    }

    if (race.eventMode === 'multi' && race.eventConfiguration) {
        const catConfig = race.eventConfiguration.find(c => c.customCategory === category);
        return pickFirstNonEmpty(catConfig?.sprints, race.sprints, race.sprintData);
    }

    if (race.singleModeCategories?.length) {
        const catConfig = race.singleModeCategories.find(c => c.category === category);
        return pickFirstNonEmpty(catConfig?.sprints, race.sprints, race.sprintData);
    }

    return pickFirstNonEmpty(race.sprints, race.sprintData);
}

function sortCategoriesByRank(categories: string[], rankOrder: string[]): string[] {
    const orderMap = new Map<string, number>();
    rankOrder.forEach((name, idx) => {
        const key = String(name || '').trim().toLowerCase();
        if (key && !orderMap.has(key)) orderMap.set(key, idx);
    });
    return [...categories].sort((a, b) => {
        const aKey = String(a || '').trim().toLowerCase();
        const bKey = String(b || '').trim().toLowerCase();
        const aRank = orderMap.get(aKey);
        const bRank = orderMap.get(bKey);
        if (aRank !== undefined && bRank !== undefined) return aRank - bRank;
        if (aRank !== undefined) return -1;
        if (bRank !== undefined) return 1;
        return a.localeCompare(b);
    });
}
