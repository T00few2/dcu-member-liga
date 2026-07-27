'use client';

import { useEffect, useState, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { usePathname, useRouter } from 'next/navigation';
import {
    useRacesQuery,
    useLeagueSettingsQuery,
    useStageRacesQuery,
    useRaceDrVerificationsQuery,
    useRaceWeightVerificationsQuery,
    useParticipantsQuery,
} from '@/hooks/queries';
import { useFirestoreDoc } from '@/hooks/useFirestoreDoc';
import { normalizeRace } from '@/lib/firestore-normalizers';
import type {
    Race,
    Sprint,
    ResultEntry,
    StandingEntry,
} from '@/types/live';
import type { StageRace } from '@/types/admin';
import StandingsTable from './_components/StandingsTable';
import RaceResultsTable from './_components/RaceResultsTable';
import ErrorBoundary from '@/components/ErrorBoundary';
import { sortCategoriesByRank } from '@/lib/categories';
import {
    buildEventGcColumns,
    buildLegacyStandingColumns,
    buildSeasonStandingColumns,
    oneDayRaces,
    processStandingsForDisplay,
    raceOptionLabel,
    seasonClassLabel,
    tourEvents,
    tourStageRaces,
} from '@/lib/seasonUi';

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

type ResultsTab = 'standings' | 'results' | 'tour';

type ResultsView =
    | { mode: 'race'; raceId: string }
    | { mode: 'eventGc'; eventId: string };

function parseResultsView(key: string): ResultsView | null {
    if (key.startsWith('gc:')) {
        const eventId = key.slice(3);
        return eventId ? { mode: 'eventGc', eventId } : null;
    }
    if (key.startsWith('race:')) {
        const raceId = key.slice(5);
        return raceId ? { mode: 'race', raceId } : null;
    }
    // Backward-compatible bare race id
    if (key) return { mode: 'race', raceId: key };
    return null;
}

function resultsViewKey(view: ResultsView): string {
    return view.mode === 'eventGc' ? `gc:${view.eventId}` : `race:${view.raceId}`;
}

function parseTab(value: string | null, hasTour: boolean): ResultsTab {
    if (value === 'results') return 'results';
    if (value === 'tour' && hasTour) return 'tour';
    return 'standings';
}

function parseTourViewParam(value: string | null): ResultsView | null {
    if (!value) return null;
    if (value === 'gc') return null; // needs event id from ?event=
    if (value.startsWith('stage:')) {
        const raceId = value.slice(6);
        return raceId ? { mode: 'race', raceId } : null;
    }
    return parseResultsView(value);
}

export default function ResultsPage() {
    const { user, loading: authLoading, isRegistered } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    const [activeTab, setActiveTab] = useState<ResultsTab>('standings');
    const [oneDayViewKey, setOneDayViewKey] = useState<string>('');
    const [tourEventId, setTourEventId] = useState<string>('');
    const [tourViewKey, setTourViewKey] = useState<string>('');
    const [lastTourStageId, setLastTourStageId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('A');
    const [standingsCategory, setStandingsCategory] = useState<string>('');
    const [autoSelectStandingsCategory, setAutoSelectStandingsCategory] = useState(true);

    const racesQuery = useRacesQuery();
    const settingsQuery = useLeagueSettingsQuery();
    const stageRacesQuery = useStageRacesQuery();
    const participantsQuery = useParticipantsQuery();

    const stageRaces = stageRacesQuery.data ?? [];
    const tours = useMemo(() => tourEvents(stageRaces), [stageRaces]);
    const hasTour = tours.length > 0;

    const resultsViewKeyState = activeTab === 'tour' ? tourViewKey : oneDayViewKey;
    const resultsView = useMemo(
        () => parseResultsView(resultsViewKeyState),
        [resultsViewKeyState],
    );
    const selectedRaceId = resultsView?.mode === 'race' ? resultsView.raceId : '';
    const selectedGcEventId = resultsView?.mode === 'eventGc' ? resultsView.eventId : '';

    const drVerificationsQuery = useRaceDrVerificationsQuery(selectedRaceId || null);
    const weightVerificationsQuery = useRaceWeightVerificationsQuery(selectedRaceId || null);

    const liveRaceDoc = useFirestoreDoc<Race>('races', selectedRaceId || null);
    const liveStandingsDoc = useFirestoreDoc<{ standings: Record<string, StandingEntry[]> }>(
        'league',
        'standings',
    );

    const races = useMemo<Race[]>(() => {
        const base = (racesQuery.data ?? []) as Race[];
        if (!liveRaceDoc.data || !selectedRaceId) return base;
        const updated = normalizeRace(liveRaceDoc.data, selectedRaceId);
        return base.map(r => (r.id === selectedRaceId ? { ...r, ...updated } : r));
    }, [racesQuery.data, liveRaceDoc.data, selectedRaceId]);

    const eventsById = useMemo(
        () => new Map(stageRaces.map((e) => [e.id, e])),
        [stageRaces],
    );

    const seasonMode = stageRaces.length > 0;
    const standings = liveStandingsDoc.data?.standings ?? {};

    const sortedRaces = useMemo(
        () =>
            [...races].sort(
                (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime(),
            ),
        [races],
    );

    const oneDayRaceList = useMemo(
        () => (seasonMode ? oneDayRaces(sortedRaces, stageRaces) : sortedRaces),
        [seasonMode, sortedRaces, stageRaces],
    );

    const selectedTourEvent = tourEventId
        ? tours.find((t) => t.id === tourEventId) ?? tours[0]
        : tours[0];

    const selectedTourStages = useMemo(
        () => (selectedTourEvent ? tourStageRaces(sortedRaces, selectedTourEvent.id) : []),
        [sortedRaces, selectedTourEvent],
    );

    const seasonColumns = useMemo(
        () => (seasonMode
            ? buildSeasonStandingColumns(sortedRaces, stageRaces)
            : buildLegacyStandingColumns(sortedRaces)),
        [seasonMode, sortedRaces, stageRaces],
    );

    const bestCount = seasonMode
        ? (settingsQuery.data?.seasonBestResultsCount ?? 0)
        : (settingsQuery.data?.bestRacesCount ?? 5);

    const configuredCategoryNames = useMemo(() => {
        const cats = settingsQuery.data?.ligaCategories;
        return Array.isArray(cats) ? cats.map((c: { name: string }) => c.name) : [];
    }, [settingsQuery.data]);

    const drVerifications = drVerificationsQuery.data ?? new Map();
    const weightVerifications = weightVerificationsQuery.data ?? new Map();
    const clubByZwiftId = useMemo(() => {
        const map = new Map<string, string>();
        const participants = Array.isArray(participantsQuery.data) ? participantsQuery.data : [];
        participants.forEach((participant: unknown) => {
            const value = participant as { zwiftId?: string | number; club?: string };
            const zwiftId = String(value?.zwiftId ?? '').trim();
            const club = String(value?.club ?? '').trim();
            if (!zwiftId || !club) return;
            map.set(zwiftId, club);
        });
        return map;
    }, [participantsQuery.data]);

    const writeUrl = useCallback((opts: {
        tab?: ResultsTab;
        eventId?: string;
        view?: ResultsView | null;
    }) => {
        const params = new URLSearchParams(
            typeof window === 'undefined' ? '' : window.location.search,
        );
        const tab = opts.tab ?? activeTab;
        params.set('tab', tab);

        if (tab === 'tour' && hasTour) {
            const eventId = opts.eventId ?? tourEventId ?? tours[0]?.id;
            if (eventId) params.set('event', eventId);
            const view = opts.view;
            if (view?.mode === 'eventGc') {
                params.set('view', 'gc');
            } else if (view?.mode === 'race') {
                params.set('view', `stage:${view.raceId}`);
            } else if (opts.view === null) {
                params.delete('view');
            }
        } else {
            params.delete('event');
            params.delete('view');
        }

        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [activeTab, hasTour, tourEventId, tours, router, pathname]);

    const setResultsTab = (tab: ResultsTab) => {
        const next = tab === 'tour' && !hasTour ? 'standings' : tab;
        setActiveTab(next);
        writeUrl({ tab: next });
    };

    // Sync tab / tour selection from URL
    useEffect(() => {
        if (typeof window === 'undefined') return;
        const syncFromUrl = () => {
            const params = new URLSearchParams(window.location.search);
            const tab = parseTab(params.get('tab'), hasTour);
            setActiveTab(tab);

            if (tab === 'tour' && hasTour) {
                const eventParam = params.get('event');
                const matched = eventParam && tours.some((t) => t.id === eventParam)
                    ? eventParam
                    : tours[0]?.id;
                if (matched) setTourEventId(matched);

                const viewParam = params.get('view');
                if (viewParam === 'gc' && matched) {
                    setTourViewKey(resultsViewKey({ mode: 'eventGc', eventId: matched }));
                } else {
                    const parsed = parseTourViewParam(viewParam);
                    if (parsed?.mode === 'race') {
                        setTourViewKey(resultsViewKey(parsed));
                    }
                }
            }
        };
        syncFromUrl();
        window.addEventListener('popstate', syncFromUrl);
        return () => window.removeEventListener('popstate', syncFromUrl);
    }, [hasTour, tours]);

    // Default one-day race selection
    useEffect(() => {
        if (activeTab !== 'results') return;
        if (oneDayViewKey) {
            const parsed = parseResultsView(oneDayViewKey);
            if (parsed?.mode === 'race' && oneDayRaceList.some((r) => r.id === parsed.raceId)) {
                return;
            }
        }
        if (oneDayRaceList.length > 0) {
            setOneDayViewKey(resultsViewKey({ mode: 'race', raceId: oneDayRaceList[0].id }));
        } else {
            setOneDayViewKey('');
        }
    }, [activeTab, oneDayRaceList, oneDayViewKey]);

    // Default tour event + view
    useEffect(() => {
        if (!hasTour) {
            if (activeTab === 'tour') setActiveTab('standings');
            return;
        }
        if (!tourEventId || !tours.some((t) => t.id === tourEventId)) {
            setTourEventId(tours[0].id);
        }
    }, [hasTour, tours, tourEventId, activeTab]);

    useEffect(() => {
        if (activeTab !== 'tour' || !selectedTourEvent) return;
        const stages = selectedTourStages;
        const parsed = parseResultsView(tourViewKey);
        const validRace = parsed?.mode === 'race'
            && stages.some((r) => r.id === parsed.raceId);
        const validGc = parsed?.mode === 'eventGc'
            && parsed.eventId === selectedTourEvent.id;
        if (validRace) {
            if (parsed.mode === 'race') setLastTourStageId(parsed.raceId);
            return;
        }
        if (validGc) return;

        // Default to Tour GC; fall back to first stage if GC event missing somehow
        const nextView: ResultsView = { mode: 'eventGc', eventId: selectedTourEvent.id };
        setTourViewKey(resultsViewKey(nextView));
        writeUrl({ tab: 'tour', eventId: selectedTourEvent.id, view: nextView });
    }, [activeTab, selectedTourEvent, selectedTourStages, tourViewKey, writeUrl]);
    const selectedRace = races.find(r => r.id === selectedRaceId);
    const selectedEvent = selectedRace?.stageRaceId
        ? eventsById.get(selectedRace.stageRaceId)
        : undefined;
    const selectedGcEvent = selectedGcEventId
        ? eventsById.get(selectedGcEventId)
        : undefined;

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

    const gcStandings: Record<string, StandingEntry[]> = (() => {
        const raw = selectedGcEvent?.standings;
        if (!raw || typeof raw !== 'object') return {};
        return raw as Record<string, StandingEntry[]>;
    })();
    const availableGcCategories = useMemo(() => {
        const cats = Object.keys(gcStandings);
        if (cats.length > 0) return sortCategoriesByRank(cats, categoryRankOrder);
        return configuredCategoryNames.length > 0
            ? sortCategoriesByRank(configuredCategoryNames, categoryRankOrder)
            : ['A', 'B', 'C', 'D', 'E'];
    }, [gcStandings, configuredCategoryNames, categoryRankOrder]);

    const displayRaceCategory = (selectedRace?.results && !availableRaceCategories.includes(selectedCategory) && availableRaceCategories.length > 0)
        ? availableRaceCategories[0]
        : selectedCategory;

    const displayGcCategory = (!availableGcCategories.includes(selectedCategory) && availableGcCategories.length > 0)
        ? availableGcCategories[0]
        : selectedCategory;

    const raceResults: ResultEntry[] = selectedRace?.results?.[displayRaceCategory] || [];
    const leaguePointsByZwiftId = useMemo(() => {
        const map = new Map<string, number>();
        const raceKey = selectedRaceId;
        if (!raceKey) return map;
        (standings[displayRaceCategory] || []).forEach(entry => {
            const match = entry.results?.find(r => r.raceId === raceKey && r.source !== 'gc');
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
        if (!selectedRaceLoaded && seasonMode) {
            // still allow standings categories from season doc
        } else if (!selectedRaceLoaded) {
            return;
        }
        if (availableStandingsCategories.length === 0) return;
        setStandingsCategory(availableStandingsCategories[0]);
        setAutoSelectStandingsCategory(false);
    }, [autoSelectStandingsCategory, selectedRaceLoaded, availableStandingsCategories, seasonMode]);

    const handleStandingsCategoryChange = (cat: string) => {
        setStandingsCategory(cat);
        setAutoSelectStandingsCategory(false);
    };

    const currentStandings = useMemo(
        () => processStandingsForDisplay(
            standings[displayStandingsCategory] || [],
            seasonColumns,
            bestCount,
        ),
        [standings, displayStandingsCategory, seasonColumns, bestCount],
    );

    const eventGcColumns = useMemo(
        () => (selectedGcEvent ? buildEventGcColumns(selectedGcEvent, sortedRaces) : []),
        [selectedGcEvent, sortedRaces],
    );

    const eventGcStandings = useMemo(
        () => processStandingsForDisplay(
            gcStandings[displayGcCategory] || [],
            eventGcColumns,
            selectedGcEvent?.bestRacesCount ?? 0,
        ),
        [gcStandings, displayGcCategory, eventGcColumns, selectedGcEvent],
    );

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

    if (!isRegistered) return null;

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

    const getRaceLabel = (race: Race) =>
        raceOptionLabel(race, race.stageRaceId ? eventsById.get(race.stageRaceId) : null);

    const onOneDayViewChange = (key: string) => {
        setOneDayViewKey(key);
    };

    const onTourEventChange = (eventId: string) => {
        setTourEventId(eventId);
        setLastTourStageId('');
        const nextView: ResultsView = { mode: 'eventGc', eventId };
        setTourViewKey(resultsViewKey(nextView));
        writeUrl({ tab: 'tour', eventId, view: nextView });
    };

    const onTourViewChange = (key: string) => {
        setTourViewKey(key);
        const view = parseResultsView(key);
        if (view?.mode === 'race') setLastTourStageId(view.raceId);
        writeUrl({
            tab: 'tour',
            eventId: selectedTourEvent?.id,
            view,
        });
    };

    const tourSubTab: 'gc' | 'stages' =
        resultsView?.mode === 'eventGc' ? 'gc' : 'stages';

    const setTourSubTab = (sub: 'gc' | 'stages') => {
        if (!selectedTourEvent) return;
        if (sub === 'gc') {
            onTourViewChange(resultsViewKey({ mode: 'eventGc', eventId: selectedTourEvent.id }));
            return;
        }
        const stages = selectedTourStages;
        const preferred = lastTourStageId
            && stages.some((r) => r.id === lastTourStageId)
            ? lastTourStageId
            : stages[0]?.id;
        if (preferred) {
            onTourViewChange(resultsViewKey({ mode: 'race', raceId: preferred }));
        } else {
            onTourViewChange(resultsViewKey({ mode: 'eventGc', eventId: selectedTourEvent.id }));
        }
    };

    const tourTabLabel = (
        tourEventId
            ? tours.find((t) => t.id === tourEventId)?.name
            : undefined
    ) || tours[0]?.name || 'Tour';

    const raceResultsPanel = (
        <RaceResultsTable
            races={activeTab === 'tour' ? selectedTourStages : oneDayRaceList}
            selectedRaceId={selectedRaceId}
            setSelectedRaceId={(id) => {
                const key = resultsViewKey({ mode: 'race', raceId: id });
                if (activeTab === 'tour') onTourViewChange(key);
                else onOneDayViewChange(key);
            }}
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
            clubByZwiftId={clubByZwiftId}
            drVerifications={drVerifications}
            weightVerifications={weightVerifications}
            user={user}
            hideRaceSelector
            getRaceOptionLabel={getRaceLabel}
            eventContextLabel={selectedEvent
                ? `${selectedEvent.name}${selectedRace?.stageIndex != null && selectedEvent.seasonClass === 'tour' ? ` · Etape ${selectedRace.stageIndex}` : ''}`
                : undefined}
        />
    );

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Resultater & Stilling</h1>

            <div className="flex gap-4 mb-8 border-b border-border overflow-x-auto">
                <button
                    onClick={() => setResultsTab('standings')}
                    className={`shrink-0 pb-2 px-4 font-medium transition ${activeTab === 'standings' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    {seasonMode ? 'Sæsonstilling' : 'Ligastilling'}
                </button>
                <button
                    onClick={() => setResultsTab('results')}
                    className={`shrink-0 pb-2 px-4 font-medium transition ${activeTab === 'results' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Løbsresultater
                </button>
                {hasTour && (
                    <button
                        onClick={() => setResultsTab('tour')}
                        className={`shrink-0 pb-2 px-4 font-medium transition ${activeTab === 'tour' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                    >
                        {tourTabLabel}
                    </button>
                )}
            </div>

            {activeTab === 'standings' && (
                <ErrorBoundary label="Sæsonstilling">
                    <StandingsTable
                        currentStandings={currentStandings}
                        columns={seasonColumns}
                        availableStandingsCategories={availableStandingsCategories}
                        displayStandingsCategory={displayStandingsCategory}
                        standingsCategory={standingsCategory}
                        setStandingsCategory={handleStandingsCategoryChange}
                        clubByZwiftId={clubByZwiftId}
                        title={seasonMode ? 'Sæsonstilling' : 'Førertavle'}
                        countingHint={seasonMode
                            ? 'Tæller ikke (uden for sæson best-X)'
                            : 'Tæller ikke (uden for best-X)'}
                    />
                </ErrorBoundary>
            )}

            {activeTab === 'results' && (
                <ErrorBoundary label="Løbsresultater">
                    <div className="space-y-6">
                        <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card border border-border p-4 rounded-lg shadow-sm">
                            <div className="flex flex-col gap-1 w-full sm:w-auto">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Vælg løb
                                </label>
                                <select
                                    value={oneDayViewKey}
                                    onChange={(e) => onOneDayViewChange(e.target.value)}
                                    className="bg-background border border-input rounded px-3 py-2 text-foreground font-medium w-full sm:w-[28rem]"
                                >
                                    {oneDayRaceList.map((r) => (
                                        <option key={r.id} value={resultsViewKey({ mode: 'race', raceId: r.id })}>
                                            {getRaceLabel(r)}
                                        </option>
                                    ))}
                                    {oneDayRaceList.length === 0 && (
                                        <option value="" disabled>Ingen éndagsløb fundet</option>
                                    )}
                                </select>
                            </div>

                            {selectedRace && (
                                <div className="text-right hidden sm:block">
                                    {selectedEvent && (
                                        <div className="text-xs text-muted-foreground mb-0.5">
                                            {selectedEvent.name}
                                            {' · '}
                                            {seasonClassLabel(selectedEvent.seasonClass)}
                                        </div>
                                    )}
                                    <div className="text-sm font-medium text-card-foreground">{selectedRace.map}</div>
                                    <div className="text-xs text-muted-foreground">{selectedRace.routeName} • {displayLaps} omgange</div>
                                </div>
                            )}
                        </div>

                        {oneDayRaceList.length > 0 ? raceResultsPanel : (
                            <p className="text-muted-foreground text-sm">Ingen éndagsløb i denne sæson.</p>
                        )}
                    </div>
                </ErrorBoundary>
            )}

            {activeTab === 'tour' && hasTour && selectedTourEvent && (
                <ErrorBoundary label={tourTabLabel}>
                    <div className="space-y-6">
                        {tours.length > 1 && (
                            <div className="flex flex-col gap-1 w-full sm:w-64">
                                <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                    Vælg tour
                                </label>
                                <select
                                    value={selectedTourEvent.id}
                                    onChange={(e) => onTourEventChange(e.target.value)}
                                    className="bg-background border border-input rounded px-3 py-2 text-foreground font-medium w-full"
                                >
                                    {tours.map((ev) => (
                                        <option key={ev.id} value={ev.id}>{ev.name}</option>
                                    ))}
                                </select>
                            </div>
                        )}

                        <div className="flex gap-2 border-b border-border">
                            <button
                                type="button"
                                onClick={() => setTourSubTab('gc')}
                                className={`pb-2 px-4 text-sm font-medium transition ${tourSubTab === 'gc' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                GC
                            </button>
                            <button
                                type="button"
                                onClick={() => setTourSubTab('stages')}
                                className={`pb-2 px-4 text-sm font-medium transition ${tourSubTab === 'stages' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                            >
                                Etaper
                            </button>
                        </div>

                        {tourSubTab === 'gc' && selectedGcEvent ? (
                            <EventGcPanel
                                event={selectedGcEvent}
                                columns={eventGcColumns}
                                standings={eventGcStandings}
                                availableCategories={availableGcCategories}
                                displayCategory={displayGcCategory}
                                selectedCategory={selectedCategory}
                                setSelectedCategory={setSelectedCategory}
                                clubByZwiftId={clubByZwiftId}
                                title={`${selectedGcEvent.name} — GC`}
                            />
                        ) : tourSubTab === 'gc' ? (
                            <p className="text-muted-foreground text-sm">Ingen Tour GC endnu.</p>
                        ) : (
                            <div className="space-y-6">
                                <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card border border-border p-4 rounded-lg shadow-sm">
                                    <div className="flex flex-col gap-1 w-full sm:w-auto">
                                        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                                            Vælg etape
                                        </label>
                                        <select
                                            value={
                                                resultsView?.mode === 'race'
                                                    ? resultsViewKey(resultsView)
                                                    : (selectedTourStages[0]
                                                        ? resultsViewKey({ mode: 'race', raceId: selectedTourStages[0].id })
                                                        : '')
                                            }
                                            onChange={(e) => onTourViewChange(e.target.value)}
                                            className="bg-background border border-input rounded px-3 py-2 text-foreground font-medium w-full sm:w-[28rem]"
                                            disabled={selectedTourStages.length === 0}
                                        >
                                            {selectedTourStages.map((r) => (
                                                <option key={r.id} value={resultsViewKey({ mode: 'race', raceId: r.id })}>
                                                    {r.stageIndex != null ? `Etape ${r.stageIndex}: ${r.name}` : r.name}
                                                </option>
                                            ))}
                                            {selectedTourStages.length === 0 && (
                                                <option value="" disabled>Ingen etaper fundet</option>
                                            )}
                                        </select>
                                    </div>

                                    {selectedRace && (
                                        <div className="text-right hidden sm:block">
                                            <div className="text-xs text-muted-foreground mb-0.5">
                                                {selectedTourEvent.name}
                                                {selectedRace.stageIndex != null ? ` · Etape ${selectedRace.stageIndex}` : ''}
                                            </div>
                                            <div className="text-sm font-medium text-card-foreground">{selectedRace.map}</div>
                                            <div className="text-xs text-muted-foreground">{selectedRace.routeName} • {displayLaps} omgange</div>
                                        </div>
                                    )}
                                </div>

                                {selectedTourStages.length > 0 ? raceResultsPanel : (
                                    <p className="text-muted-foreground text-sm">Ingen etaper i denne tour.</p>
                                )}
                            </div>
                        )}
                    </div>
                </ErrorBoundary>
            )}
        </div>
    );
}

function EventGcPanel({
    event,
    columns,
    standings,
    availableCategories,
    displayCategory,
    selectedCategory,
    setSelectedCategory,
    clubByZwiftId,
    title,
}: {
    event: StageRace;
    columns: ReturnType<typeof buildEventGcColumns>;
    standings: ReturnType<typeof processStandingsForDisplay>;
    availableCategories: string[];
    displayCategory: string;
    selectedCategory: string;
    setSelectedCategory: (cat: string) => void;
    clubByZwiftId: Map<string, string>;
    title?: string;
}) {
    return (
        <StandingsTable
            currentStandings={standings}
            columns={columns}
            availableStandingsCategories={availableCategories}
            displayStandingsCategory={displayCategory}
            standingsCategory={selectedCategory}
            setStandingsCategory={setSelectedCategory}
            clubByZwiftId={clubByZwiftId}
            title={title ?? `${event.name} — Event GC`}
            countingHint="Tæller ikke (uden for event best-X)"
        />
    );
}

function getConfiguredSprintsForCategory(race: Race | undefined, category: string): Sprint[] {
    if (!race) return [];

    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups.find(g => (g.categories || []).some(c => c.category === category));
        const catCfg = group?.categories?.find(c => c.category === category);
        const fallbackGroup = race.raceGroups.find(g => (g.sprints || []).length > 0);
        return pickFirstNonEmpty(
            catCfg?.sprints,
            group?.sprints,
            fallbackGroup?.sprints,
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
