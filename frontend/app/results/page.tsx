'use client';

import { useEffect, useState, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, getDocs } from 'firebase/firestore';
import { API_URL } from '@/lib/api';
import type { Race, Sprint, ResultEntry, StandingEntry, DualRecordingVerification } from '@/types/live';
import StandingsTable from './_components/StandingsTable';
import RaceResultsTable from './_components/RaceResultsTable';

type ProcessedRider = StandingEntry & { calculatedTotal: number; countingRaceIds: Set<string> };

export default function ResultsPage() {
    const { user, loading: authLoading, isRegistered } = useAuth();

    const [races, setRaces] = useState<Race[]>([]);
    const [standings, setStandings] = useState<Record<string, StandingEntry[]>>({});
    const [loading, setLoading] = useState(true);

    const [activeTab, setActiveTab] = useState<'standings' | 'results'>('standings');
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [selectedCategory, setSelectedCategory] = useState<string>('A');
    const [drVerifications, setDrVerifications] = useState<Map<string, DualRecordingVerification>>(new Map());
    const [standingsCategory, setStandingsCategory] = useState<string>('');
    const [autoSelectStandingsCategory, setAutoSelectStandingsCategory] = useState(true);
    const [bestRacesCount, setBestRacesCount] = useState<number>(5);
    const [configuredCategoryNames, setConfiguredCategoryNames] = useState<string[]>([]);

    useEffect(() => {
        const fetchData = async () => {
            if (!user) return;
            try {
                const token = await user.getIdToken();

                const racesRes = await fetch(`${API_URL}/races`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });

                const [standingsRes, settingsRes] = await Promise.all([
                    fetch(`${API_URL}/league/standings`, { headers: { 'Authorization': `Bearer ${token}` } }),
                    fetch(`${API_URL}/league/settings`, { headers: { 'Authorization': `Bearer ${token}` } })
                ]);

                if (settingsRes.ok) {
                    const settingsData = await settingsRes.json();
                    if (settingsData.settings?.bestRacesCount) {
                        setBestRacesCount(settingsData.settings.bestRacesCount);
                    }
                    const cats = settingsData.settings?.ligaCategories;
                    if (Array.isArray(cats) && cats.length > 0) {
                        setConfiguredCategoryNames(cats.map((c: { name: string }) => c.name));
                    }
                }

                if (racesRes.ok) {
                    const data = await racesRes.json();
                    const sorted = (data.races || []).sort((a: Race, b: Race) =>
                        new Date(a.date).getTime() - new Date(b.date).getTime()
                    );
                    setRaces(sorted);
                    if (sorted.length > 0) setSelectedRaceId(sorted[0].id);
                }

                if (standingsRes.ok) {
                    const data = await standingsRes.json();
                    setStandings(data.standings || {});
                    setAutoSelectStandingsCategory(true);
                    setStandingsCategory('');
                }
            } catch (e) {
                console.error('Error fetching data', e);
            } finally {
                setLoading(false);
            }
        };

        if (user && isRegistered) fetchData();
    }, [user, isRegistered]);

    useEffect(() => {
        if (!selectedRaceId) return;
        const unsubscribe = onSnapshot(doc(db, 'races', selectedRaceId), (snap) => {
            if (snap.exists()) {
                const updated = { ...snap.data(), id: snap.id } as Race;
                setRaces(prev => prev.map(r => r.id === updated.id ? { ...r, ...updated } : r));
            }
        }, (err) => console.error('Error listening to race updates:', err));
        return () => unsubscribe();
    }, [selectedRaceId]);

    useEffect(() => {
        if (!selectedRaceId) return;
        const colRef = collection(db, 'races', selectedRaceId, 'dr_verifications');
        getDocs(colRef).then(snap => {
            const map = new Map<string, DualRecordingVerification>();
            snap.forEach(d => map.set(d.id, d.data() as DualRecordingVerification));
            setDrVerifications(map);
        }).catch(() => {});
    }, [selectedRaceId]);

    useEffect(() => {
        const unsubscribe = onSnapshot(doc(db, 'league', 'standings'), (snap) => {
            if (snap.exists()) {
                const data = snap.data();
                if (data.standings) setStandings(data.standings);
            }
        }, (err) => console.error('Error listening to standings updates:', err));
        return () => unsubscribe();
    }, []);

    // --- Derived data ---
    // NOTE: All hooks (useMemo below) must be called before any early return to satisfy Rules of Hooks.

    const selectedRace = races.find(r => r.id === selectedRaceId);

    // Available race categories
    let availableRaceCategories: string[] = [];
    const raceOrderReference = [...races].reverse().find(r => r.eventMode === 'multi' && r.eventConfiguration?.length);
    if (selectedRace?.results && Object.keys(selectedRace.results).length > 0) {
        availableRaceCategories = Object.keys(selectedRace.results);
    } else if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
        availableRaceCategories = selectedRace.eventConfiguration.map(c => c.customCategory).filter(Boolean);
    } else if (selectedRace?.singleModeCategories?.length) {
        availableRaceCategories = selectedRace.singleModeCategories.map(c => c.category).filter(Boolean);
    } else {
        availableRaceCategories = configuredCategoryNames.length > 0 ? configuredCategoryNames : ['A', 'B', 'C', 'D', 'E'];
    }

    // Sort race categories by configured order
    if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
        const orderMap = new Map(selectedRace.eventConfiguration.map((cfg, idx) => [cfg.customCategory, idx]));
        availableRaceCategories.sort((a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999));
    } else if (selectedRace?.singleModeCategories?.length) {
        const orderMap = new Map(selectedRace.singleModeCategories.map((cfg, idx) => [cfg.category, idx]));
        availableRaceCategories.sort((a, b) => (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999));
    } else if (raceOrderReference?.eventConfiguration) {
        const orderMap = new Map(raceOrderReference.eventConfiguration.map((cfg, idx) => [cfg.customCategory, idx]));
        availableRaceCategories.sort((a, b) => {
            const diff = (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999);
            return diff !== 0 ? diff : a.localeCompare(b);
        });
    } else {
        availableRaceCategories.sort();
    }

    const displayRaceCategory = (selectedRace?.results && !availableRaceCategories.includes(selectedCategory) && availableRaceCategories.length > 0)
        ? availableRaceCategories[0]
        : selectedCategory;

    const raceResults = selectedRace?.results?.[displayRaceCategory] || [];
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

    // Available standings categories (never default to A-E).
    // If standings are empty, fall back to configured race categories.
    let availableStandingsCategories = Object.keys(standings).length > 0 ? Object.keys(standings) : [];
    if (availableStandingsCategories.length === 0) {
        availableStandingsCategories = [...availableRaceCategories];
    }

    const standingsOrderReference =
        selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration?.length
            ? selectedRace
            : [...races].reverse().find(r => r.eventMode === 'multi' && r.eventConfiguration?.length);

    if (standingsOrderReference?.eventConfiguration) {
        const orderMap = new Map(standingsOrderReference.eventConfiguration.map((cfg, idx) => [cfg.customCategory, idx]));
        availableStandingsCategories.sort((a, b) => {
            const diff = (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999);
            return diff !== 0 ? diff : a.localeCompare(b);
        });
    } else if (selectedRace?.singleModeCategories?.length) {
        const orderMap = new Map(selectedRace.singleModeCategories.map((cfg, idx) => [cfg.category, idx]));
        availableStandingsCategories.sort((a, b) => {
            const diff = (orderMap.get(a) ?? 999) - (orderMap.get(b) ?? 999);
            return diff !== 0 ? diff : a.localeCompare(b);
        });
    } else {
        availableStandingsCategories.sort();
    }

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

        let orderedSprints: Sprint[] = [];
        if (selectedRace) {
            if (selectedRace.eventMode === 'multi' && selectedRace.eventConfiguration) {
                const catConfig = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
                orderedSprints = catConfig?.sprints ?? selectedRace.sprints ?? [];
            } else {
                const catConfig = selectedRace.singleModeCategories?.find(c => c.category === displayRaceCategory);
                orderedSprints = catConfig?.sprints ?? selectedRace.sprintData ?? selectedRace.sprints ?? [];
            }
        }

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

    if (authLoading || loading) {
        return <div className="p-8 text-center text-muted-foreground">Indlæser resultater...</div>;
    }

    const getSprintHeader = (key: string): string => {
        let sourceSprints: Sprint[] = [];
        if (selectedRace?.eventMode === 'multi' && selectedRace.eventConfiguration) {
            const catConfig = selectedRace.eventConfiguration.find(c => c.customCategory === displayRaceCategory);
            sourceSprints = catConfig?.sprints ?? selectedRace.sprints ?? [];
        } else if (selectedRace?.singleModeCategories?.length) {
            const catConfig = selectedRace.singleModeCategories.find(c => c.category === displayRaceCategory);
            sourceSprints = catConfig?.sprints ?? selectedRace?.sprints ?? [];
        } else {
            sourceSprints = selectedRace?.sprints ?? [];
        }

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

    return (
        <div className="max-w-6xl mx-auto px-4 py-8">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Resultater & Stilling</h1>

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
                    races={races}
                    availableStandingsCategories={availableStandingsCategories}
                    displayStandingsCategory={displayStandingsCategory}
                    standingsCategory={standingsCategory}
                    setStandingsCategory={handleStandingsCategoryChange}
                />
            )}

            {activeTab === 'results' && (
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
                />
            )}
        </div>
    );
}
