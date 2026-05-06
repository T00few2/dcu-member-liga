'use client';

import { useEffect, useState, useMemo } from 'react';
import { API_URL } from '@/lib/api';
import type { Race, Sprint, ResultEntry, StandingEntry } from '@/types/live';
import StandingsTable from '@/app/results/_components/StandingsTable';
import RaceResultsTable from '@/app/results/_components/RaceResultsTable';

interface ArchiveSummary {
    id: string;
    name: string;
    archivedAt: number | null;
    raceCount: number;
}

interface ArchiveDetail {
    id: string;
    name: string;
    settings: { bestRacesCount?: number };
    standings: Record<string, StandingEntry[]>;
    races: { id: string; name: string; date: string; hasResults: boolean }[];
}

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

export default function HistorikPage() {
    const [archives, setArchives] = useState<ArchiveSummary[]>([]);
    const [selectedArchiveId, setSelectedArchiveId] = useState<string>('');
    const [archiveDetail, setArchiveDetail] = useState<ArchiveDetail | null>(null);
    const [races, setRaces] = useState<Race[]>([]);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);

    const [activeTab, setActiveTab] = useState<'standings' | 'results'>('standings');
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('A');
    const [standingsCategory, setStandingsCategory] = useState<string>('A');
    const [autoSelectStandingsCategory, setAutoSelectStandingsCategory] = useState(true);

    // Fetch archive list on mount
    useEffect(() => {
        fetch(`${API_URL}/archives`)
            .then(r => r.ok ? r.json() : { archives: [] })
            .then(data => {
                setArchives(data.archives || []);
                if (data.archives?.length > 0) setSelectedArchiveId(data.archives[0].id);
            })
            .catch(() => {})
            .finally(() => setLoadingList(false));
    }, []);

    // Fetch archive detail when selection changes
    useEffect(() => {
        if (!selectedArchiveId) return;
        setLoadingDetail(true);
        setAutoSelectStandingsCategory(true);
        setArchiveDetail(null);
        setRaces([]);
        setSelectedRaceId('');
        setStandingsCategory('');

        fetch(`${API_URL}/archives/${selectedArchiveId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data) return;
                setArchiveDetail(data);
                if (data.races?.length > 0) setSelectedRaceId(data.races[0].id);
            })
            .catch(() => {})
            .finally(() => setLoadingDetail(false));
    }, [selectedArchiveId]);

    // Fetch full race when selected race changes
    useEffect(() => {
        if (!selectedArchiveId || !selectedRaceId) return;
        fetch(`${API_URL}/archives/${selectedArchiveId}/races/${selectedRaceId}`)
            .then(r => r.ok ? r.json() : null)
            .then(data => {
                if (!data?.race) return;
                setRaces(prev => {
                    const exists = prev.find(r => r.id === data.race.id);
                    if (exists) return prev.map(r => r.id === data.race.id ? data.race : r);
                    return [...prev, data.race];
                });
            })
            .catch(() => {});
    }, [selectedArchiveId, selectedRaceId]);

    const bestRacesCount = archiveDetail?.settings?.bestRacesCount ?? 3;
    const standings = archiveDetail?.standings ?? {};
    const selectedRace = races.find(r => r.id === selectedRaceId);

    // Available race categories
    let availableRaceCategories: string[] = [];
    if (selectedRace?.results && Object.keys(selectedRace.results).length > 0) {
        availableRaceCategories = Object.keys(selectedRace.results);
    } else if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
        availableRaceCategories = selectedRace.eventConfiguration.map(c => c.customCategory).filter(Boolean);
    } else if (selectedRace?.singleModeCategories?.length) {
        availableRaceCategories = selectedRace.singleModeCategories.map(c => c.category).filter(Boolean);
    } else {
        availableRaceCategories = ['A', 'B', 'C', 'D', 'E'];
    }

    availableRaceCategories = sortCategoriesByRank(availableRaceCategories, DEFAULT_CATEGORY_RANK);

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

    let displayLaps = selectedRace?.laps;
    if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
        const cfg = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
        if (cfg?.laps) displayLaps = cfg.laps;
    } else if (selectedRace?.singleModeCategories?.length) {
        const cfg = selectedRace.singleModeCategories.find(c => c.category === displayRaceCategory);
        if (cfg?.laps) displayLaps = cfg.laps;
    }

    // Available standings categories
    let availableStandingsCategories = Object.keys(standings).length > 0 ? Object.keys(standings) : ['A', 'B', 'C', 'D', 'E'];
    availableStandingsCategories = sortCategoriesByRank(availableStandingsCategories, DEFAULT_CATEGORY_RANK);

    const displayStandingsCategory = (Object.keys(standings).length > 0 && !availableStandingsCategories.includes(standingsCategory))
        ? availableStandingsCategories[0]
        : standingsCategory;

    const selectedRaceLoaded = !selectedRaceId || races.some(r => r.id === selectedRaceId);

    // Default standings category should follow the same visible category order as the tabs.
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

    // Race list for the results tab (use summary from archiveDetail for the selector)
    const raceSummaries: Race[] = (archiveDetail?.races ?? []).map(r => ({
        id: r.id,
        name: r.name,
        date: r.date,
    }));

    // Merge fetched full race data into summaries
    const racesForTable: Race[] = raceSummaries.map(summary => {
        const full = races.find(r => r.id === summary.id);
        return full ?? summary;
    });

    if (loadingList) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser historik...</div>;
    }

    if (archives.length === 0) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-16 text-center">
                <h1 className="text-3xl font-bold mb-4 text-foreground">Historiske resultater</h1>
                <p className="text-muted-foreground text-lg">Ingen arkiverede sæsoner endnu.</p>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
                <h1 className="text-3xl font-bold text-foreground">Historiske resultater</h1>
                <select
                    value={selectedArchiveId}
                    onChange={e => setSelectedArchiveId(e.target.value)}
                    className="px-3 py-2 border border-input rounded bg-background text-foreground text-sm"
                >
                    {archives.map(a => (
                        <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                </select>
            </div>

            {loadingDetail ? (
                <div className="p-8 text-center text-muted-foreground">Indlæser sæson...</div>
            ) : archiveDetail && (
                <>
                    <div className="flex gap-4 mb-8 border-b border-border">
                        <button
                            onClick={() => setActiveTab('standings')}
                            className={`pb-2 px-4 font-medium transition ${activeTab === 'standings' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Ligastilling
                        </button>
                        <button
                            onClick={() => setActiveTab('results')}
                            className={`pb-2 px-4 font-medium transition ${activeTab === 'results' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                        >
                            Løbsresultater
                        </button>
                    </div>

                    {activeTab === 'standings' && (
                        <StandingsTable
                            currentStandings={currentStandings}
                            races={racesForTable}
                            availableStandingsCategories={availableStandingsCategories}
                            displayStandingsCategory={displayStandingsCategory}
                            standingsCategory={standingsCategory}
                            setStandingsCategory={handleStandingsCategoryChange}
                        />
                    )}

                    {activeTab === 'results' && (
                        <RaceResultsTable
                            races={racesForTable}
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
                        />
                    )}
                </>
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
