'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';

import { ClubSnapshotCards } from './_components/ClubSnapshotCards';
import { PowerCurveSection } from './_components/PowerCurveSection';
import { SprintAnalysisSection } from './_components/SprintAnalysisSection';
import {
    buildCategoryColorMap,
    categoryRankIndex,
    formatTime,
    getConfiguredSprintsForCategory,
    normalizeCategoryKey,
    normalizeCriticalPower,
    STATS_PREFS_STORAGE_KEY,
} from './_lib/stats-helpers';
import type {
    ClubSnapshot,
    HiddenRiderIdsByMode,
    RiderWithCategory,
    RiderWithPower,
    SprintAnalysisRow,
    SprintScatterPoint,
    SprintXAxisMode,
    StatsMode,
} from './_lib/stats-types';
import { API_URL } from '@/lib/api';
import { useAuth } from '@/lib/auth-context';
import type { Race } from '@/types/live';

export default function MyStatsPage() {
    const { user, loading: authLoading, isRegistered } = useAuth();
    const router = useRouter();
    const pathname = usePathname();

    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [currentUserZwiftId, setCurrentUserZwiftId] = useState<string | null>(null);
    const [currentUserClub, setCurrentUserClub] = useState<string | null>(null);

    const [sprintXAxis, setSprintXAxis] = useState<SprintXAxisMode>('time');

    const [statsMode, setStatsMode] = useState<StatsMode>('all');
    const [clubByZwiftId, setClubByZwiftId] = useState<Record<string, string>>({});
    const [hiddenRiderIdsByMode, setHiddenRiderIdsByMode] = useState<HiddenRiderIdsByMode>({ all: [], club: [] });
    const [highlightedRiderId, setHighlightedRiderId] = useState<string | null>(null);
    const [sprintCategoryFilter, setSprintCategoryFilter] = useState<string>('all');
    const [prefsHydrated, setPrefsHydrated] = useState(false);
    const powerCurveChartRef = useRef<HTMLDivElement | null>(null);

    const parseStatsMode = (value: string | null): StatsMode => {
        return value === 'club' ? 'club' : 'all';
    };

    const parseSprintXAxis = (value: string | null): SprintXAxisMode => {
        return value === 'rank' ? 'rank' : 'time';
    };

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const raw = window.localStorage.getItem(STATS_PREFS_STORAGE_KEY);
            if (!raw) return;
            const parsed = JSON.parse(raw) as {
                statsMode?: string;
                sprintXAxis?: string;
                sprintCategoryFilter?: string;
                hiddenRiderIdsByMode?: { all?: unknown; club?: unknown };
            };

            if (parsed.statsMode === 'all' || parsed.statsMode === 'club') {
                setStatsMode(parsed.statsMode);
            }
            if (parsed.sprintXAxis === 'rank' || parsed.sprintXAxis === 'time') {
                setSprintXAxis(parsed.sprintXAxis);
            }
            if (typeof parsed.sprintCategoryFilter === 'string') {
                setSprintCategoryFilter(parsed.sprintCategoryFilter);
            }
            const hiddenByMode = parsed.hiddenRiderIdsByMode;
            if (hiddenByMode && typeof hiddenByMode === 'object') {
                const all = Array.isArray(hiddenByMode.all) ? hiddenByMode.all.filter((id): id is string => typeof id === 'string') : [];
                const club = Array.isArray(hiddenByMode.club) ? hiddenByMode.club.filter((id): id is string => typeof id === 'string') : [];
                setHiddenRiderIdsByMode({ all, club });
            }
        } catch (error) {
            console.warn('Could not hydrate stats page preferences', error);
        } finally {
            setPrefsHydrated(true);
        }
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const syncFromUrl = () => {
            const params = new URLSearchParams(window.location.search);
            setStatsMode(parseStatsMode(params.get('mode')));
            setSprintXAxis(parseSprintXAxis(params.get('x')));
            const categoryParam = params.get('cat');
            setSprintCategoryFilter(categoryParam && categoryParam.trim() ? categoryParam.trim() : 'all');
            const raceParam = params.get('race');
            if (raceParam && raceParam.trim()) {
                setSelectedRaceId(raceParam.trim());
            }
        };
        syncFromUrl();
        window.addEventListener('popstate', syncFromUrl);
        return () => window.removeEventListener('popstate', syncFromUrl);
    }, []);

    useEffect(() => {
        if (!prefsHydrated || typeof window === 'undefined') return;
        const payload = {
            statsMode,
            sprintXAxis,
            sprintCategoryFilter,
            hiddenRiderIdsByMode,
        };
        window.localStorage.setItem(STATS_PREFS_STORAGE_KEY, JSON.stringify(payload));
    }, [prefsHydrated, statsMode, sprintXAxis, sprintCategoryFilter, hiddenRiderIdsByMode]);

    // --- 1. Fetch Races & User Profile ---
    useEffect(() => {
        const fetchData = async () => {
            if (!user) return;
            try {
                const token = await user.getIdToken();

                // Get User Profile to know ZwiftID
                const profileRes = await fetch(`${API_URL}/profile`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (profileRes.ok) {
                    const profile = await profileRes.json();
                    setCurrentUserZwiftId(profile.zwiftId?.toString());
                    setCurrentUserClub(typeof profile.club === 'string' ? profile.club : null);
                }

                // Get Races
                const racesRes = await fetch(`${API_URL}/races`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (racesRes.ok) {
                    const data = await racesRes.json();
                    // Filter for races that have results
                    const finishedRaces = (data.races || []).filter((r: Race) => r.results && Object.keys(r.results).length > 0);

                    // Sort by date desc
                    finishedRaces.sort((a: Race, b: Race) =>
                        new Date(b.date).getTime() - new Date(a.date).getTime()
                    );

                    setRaces(finishedRaces);
                    if (finishedRaces.length > 0) {
                        const raceFromUrl = typeof window !== 'undefined'
                            ? new URLSearchParams(window.location.search).get('race')
                            : null;
                        const cleanedRaceFromUrl = raceFromUrl?.trim() || '';
                        const raceExistsInList = cleanedRaceFromUrl
                            ? finishedRaces.some((race: Race) => race.id === cleanedRaceFromUrl)
                            : false;
                        setSelectedRaceId(raceExistsInList ? cleanedRaceFromUrl : finishedRaces[0].id);
                    }
                }

                // Participant list is optional (club labels only). Network failures
                // here should not fail the entire stats page.
                try {
                    const participantsRes = await fetch(`${API_URL}/participants`, {
                        headers: { 'Authorization': `Bearer ${token}` }
                    });
                    if (participantsRes.ok) {
                        const participantsPayload = await participantsRes.json();
                        const participants = Array.isArray(participantsPayload?.participants) ? participantsPayload.participants : [];
                        const nextClubMap: Record<string, string> = {};
                        for (const participant of participants) {
                            const zwiftId = String(participant?.zwiftId || '').trim();
                            if (!zwiftId) continue;
                            if (typeof participant?.club === 'string' && participant.club.trim().length > 0) {
                                nextClubMap[zwiftId] = participant.club.trim();
                            }
                        }
                        setClubByZwiftId(nextClubMap);
                    }
                } catch (participantsError) {
                    console.warn('Participants lookup unavailable; club labels disabled for now', participantsError);
                    setClubByZwiftId({});
                }
            } catch (e) {
                console.error('Error fetching data', e);
            } finally {
                setLoading(false);
            }
        };

        if (user && isRegistered) {
            fetchData();
        }
    }, [user, isRegistered]);

    const selectedRace = useMemo(() => races.find((race) => race.id === selectedRaceId), [races, selectedRaceId]);

    const userCategory = useMemo(() => {
        if (!selectedRace?.results || !currentUserZwiftId) return null;
        for (const [cat, riders] of Object.entries(selectedRace.results)) {
            if (riders.some((r) => r.zwiftId === currentUserZwiftId)) {
                return cat;
            }
        }
        return null;
    }, [selectedRace, currentUserZwiftId]);

    const userResult = useMemo(() => {
        if (!selectedRace?.results || !userCategory || !currentUserZwiftId) return null;
        return selectedRace.results[userCategory].find((r) => r.zwiftId === currentUserZwiftId) ?? null;
    }, [selectedRace, userCategory, currentUserZwiftId]);

    const primaryRaceCategory = useMemo(() => {
        if (!selectedRace?.results) return null;
        const categories = Object.keys(selectedRace.results).filter((cat) => selectedRace.results?.[cat]?.length);
        if (categories.length === 0) return null;
        return categories.sort((a, b) => categoryRankIndex(a) - categoryRankIndex(b))[0];
    }, [selectedRace]);

    const referenceCategory = userCategory ?? primaryRaceCategory;

    const allRiders = useMemo(() => {
        if (!selectedRace?.results) return [];
        const all: RiderWithCategory[] = [];
        Object.entries(selectedRace.results).forEach(([cat, riders]) => {
            riders.forEach((rider) => all.push({ ...rider, category: cat }));
        });
        return all;
    }, [selectedRace]);

    const clubRiderIdsInRace = useMemo(() => {
        if (!currentUserClub) return new Set<string>();
        return new Set(
            allRiders
                .filter((rider) => clubByZwiftId[String(rider.zwiftId)] === currentUserClub)
                .map((rider) => String(rider.zwiftId))
        );
    }, [allRiders, clubByZwiftId, currentUserClub]);

    const displayRiders = useMemo<RiderWithCategory[]>(() => {
        let riders: RiderWithCategory[] = [];

        if (statsMode === 'all') {
            if (!referenceCategory || !selectedRace?.results) return [];
            riders = selectedRace.results[referenceCategory].map((rider) => ({ ...rider, category: referenceCategory }));
        } else if (statsMode === 'club') {
            riders = allRiders.filter((rider) =>
                clubRiderIdsInRace.has(String(rider.zwiftId)),
            );
        }

        return riders.sort((a, b) => {
            if (a.zwiftId === currentUserZwiftId) return 1;
            if (b.zwiftId === currentUserZwiftId) return -1;
            return 0;
        });
    }, [statsMode, selectedRace, referenceCategory, allRiders, currentUserZwiftId, clubRiderIdsInRace]);

    const displayRidersWithPower = useMemo<RiderWithPower[]>(() => {
        return displayRiders
            .map((rider) => {
                // Some race payloads store CP on `criticalP`, others inline on the rider.
                const raceCriticalPower = normalizeCriticalPower(rider.criticalP ?? rider);
                return raceCriticalPower ? { ...rider, resolvedCriticalPower: raceCriticalPower } : null;
            })
            .filter((rider): rider is RiderWithPower => rider !== null);
    }, [displayRiders]);

    const categoryColorMap = useMemo(() => {
        return buildCategoryColorMap(displayRiders.map((rider) => rider.category));
    }, [displayRiders]);

    const sprintSourceRiders = useMemo(() => {
        return statsMode === 'all' ? allRiders : displayRiders;
    }, [statsMode, allRiders, displayRiders]);

    const sprintCategoryColorMap = useMemo(() => {
        return buildCategoryColorMap(sprintSourceRiders.map((rider) => rider.category));
    }, [sprintSourceRiders]);

    const getLineStyle = (rider: RiderWithPower) => {
        const isMe = rider.zwiftId === currentUserZwiftId;
        const isTeammate = clubRiderIdsInRace.has(String(rider.zwiftId));
        const riderCategoryColor = categoryColorMap[rider.category] || '#8884d8';

        let strokeColor = '#8884d8';
        let strokeWidth = 1.5;
        let opacity = 0.45;
        let name = `${rider.name} (Kat ${rider.category})`;

        if (statsMode === 'club') {
            if (isMe) {
                strokeColor = riderCategoryColor;
                strokeWidth = 5;
                opacity = 1;
                name = "Mig";
            } else if (isTeammate) {
                strokeColor = riderCategoryColor;
                strokeWidth = 2.5;
                opacity = 0.7;
            }
        } else if (isMe) {
            strokeColor = riderCategoryColor;
            strokeWidth = 5;
            opacity = 1;
            name = "Mig";
        } else {
            strokeColor = '#7c6ee6';
            strokeWidth = 1.75;
            opacity = 0.55;
        }

        return { isMe, isTeammate, strokeColor, strokeWidth, opacity, name };
    };

    const hiddenRiderIds = useMemo(() => new Set(hiddenRiderIdsByMode[statsMode] || []), [hiddenRiderIdsByMode, statsMode]);

    const powerLegendEntries = useMemo(() => {
        return [...displayRidersWithPower]
            .sort((a, b) => {
                const aRank = categoryRankIndex(String(a.category));
                const bRank = categoryRankIndex(String(b.category));
                if (aRank !== bRank) return aRank - bRank;
                const cat = String(a.category).localeCompare(String(b.category));
                if (cat !== 0) return cat;
                return String(a.name).localeCompare(String(b.name));
            })
            .map((rider) => ({
                rider,
                style: getLineStyle(rider),
                isHidden: hiddenRiderIds.has(String(rider.zwiftId)),
            }));
    }, [displayRidersWithPower, hiddenRiderIds, statsMode, currentUserZwiftId, clubRiderIdsInRace, categoryColorMap]);

    const visibleDisplayRidersWithPower = useMemo(() => {
        return displayRidersWithPower.filter((rider) => !hiddenRiderIds.has(String(rider.zwiftId)));
    }, [displayRidersWithPower, hiddenRiderIds]);

    useEffect(() => {
        if (displayRidersWithPower.length > 0 && visibleDisplayRidersWithPower.length === 0) {
            setHiddenRiderIdsByMode((prev) => ({
                ...prev,
                [statsMode]: [],
            }));
        }
    }, [displayRidersWithPower, visibleDisplayRidersWithPower, statsMode]);

    const toggleRiderVisibility = (zwiftId: string) => {
        setHiddenRiderIdsByMode((prev) => {
            const current = new Set(prev[statsMode] || []);
            if (current.has(zwiftId)) current.delete(zwiftId);
            else current.add(zwiftId);
            return {
                ...prev,
                [statsMode]: [...current],
            };
        });
    };

    const showAllRiders = () => {
        setHiddenRiderIdsByMode((prev) => ({
            ...prev,
            [statsMode]: [],
        }));
    };

    const hideAllRiders = () => {
        const ids = displayRidersWithPower.map((rider) => String(rider.zwiftId));
        setHiddenRiderIdsByMode((prev) => ({
            ...prev,
            [statsMode]: ids,
        }));
    };

    const showOnlyMe = () => {
        const myId = String(currentUserZwiftId || '').trim();
        if (!myId) return;
        const ids = displayRidersWithPower
            .map((rider) => String(rider.zwiftId))
            .filter((id) => id !== myId);
        setHiddenRiderIdsByMode((prev) => ({
            ...prev,
            [statsMode]: ids,
        }));
    };

    const sprintFilterCategories = useMemo(() => {
        const categories = [...new Set(sprintSourceRiders.map((r) => String(r.category || '').trim()).filter(Boolean))];
        return categories.sort((a, b) => categoryRankIndex(a) - categoryRankIndex(b));
    }, [sprintSourceRiders]);

    useEffect(() => {
        if (sprintCategoryFilter === 'all') return;
        if (!sprintFilterCategories.includes(sprintCategoryFilter)) {
            setSprintCategoryFilter('all');
        }
    }, [sprintCategoryFilter, sprintFilterCategories]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        if (!selectedRaceId) return;
        const params = new URLSearchParams(window.location.search);
        params.set('race', selectedRaceId);
        params.set('mode', statsMode);
        params.set('x', sprintXAxis);
        if (sprintCategoryFilter === 'all') params.delete('cat');
        else params.set('cat', sprintCategoryFilter);
        const query = params.toString();
        router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    }, [selectedRaceId, statsMode, sprintXAxis, sprintCategoryFilter, pathname, router]);

    const comparisonCategory = useMemo(() => {
        if (referenceCategory) return referenceCategory;
        if (statsMode === 'club' && displayRiders.length > 0) return displayRiders[0].category;
        return null;
    }, [referenceCategory, statsMode, displayRiders]);

    const configuredSprints = useMemo(() => {
        return getConfiguredSprintsForCategory(selectedRace, comparisonCategory);
    }, [selectedRace, comparisonCategory]);

    const canRenderStatsSections = statsMode === 'club'
        ? displayRiders.length > 0
        : displayRiders.length > 0;

    const sprintAnalysisRows = useMemo<SprintAnalysisRow[]>(() => {
        return configuredSprints.map((sprint, index) => {
            const sprintKey = sprint.key || `${sprint.id}_${sprint.count}`;
            const myData = userResult?.sprintData?.[sprintKey] || null;

            const scatterData = sprintSourceRiders.reduce<SprintScatterPoint[]>((acc, rider) => {
                    const sData = rider.sprintData?.[sprintKey];
                    if (!sData) return acc;
                    const isMe = rider.zwiftId === currentUserZwiftId;
                    const isTeammate = clubRiderIdsInRace.has(String(rider.zwiftId));

                    let color = '#8884d8';
                    let opacity = 0.7;
                    let size = 75;

                    if (statsMode === 'club') {
                        if (isMe) {
                            color = sprintCategoryColorMap[rider.category] || '#ff0000';
                            opacity = 1;
                            size = 100;
                        } else if (isTeammate) {
                            color = sprintCategoryColorMap[rider.category] || '#8884d8';
                            opacity = 0.8;
                            size = 90;
                        }
                    } else {
                        if (isMe) {
                            color = sprintCategoryColorMap[rider.category] || '#ff0000';
                            opacity = 1;
                            size = 100;
                        } else {
                            color = sprintCategoryColorMap[rider.category] || '#6f5ff0';
                            opacity = 0.75;
                            size = 85;
                        }
                    }

                    acc.push({
                        id: rider.zwiftId,
                        name: rider.name,
                        category: rider.category,
                        time: sData.time / 1000,
                        rank: sData.rank,
                        power: sData.avgPower,
                        isMe,
                        color,
                        opacity,
                        size,
                    });
                    return acc;
                }, []);

            return {
                sprint,
                sprintKey,
                sprintIndex: index + 1,
                myData,
                scatterData,
            };
        });
    }, [configuredSprints, userResult, sprintSourceRiders, currentUserZwiftId, clubRiderIdsInRace, statsMode, sprintCategoryColorMap]);

    const sprintAnalysisRowsForDisplay = useMemo<SprintAnalysisRow[]>(() => {
        return sprintAnalysisRows.map((row) => ({
            ...row,
            scatterData: row.scatterData.filter((entry) => {
                if (sprintCategoryFilter === 'all') return true;
                return normalizeCategoryKey(entry.category) === normalizeCategoryKey(sprintCategoryFilter);
            }),
        }));
    }, [sprintAnalysisRows, sprintCategoryFilter]);

    const clubSnapshot = useMemo<ClubSnapshot | null>(() => {
        if (statsMode !== 'club' || displayRiders.length === 0) return null;

        const ridersWithRank = displayRiders.filter((r) => Number(r.finishRank) > 0);
        const avgRank = ridersWithRank.length > 0
            ? ridersWithRank.reduce((sum, rider) => sum + Number(rider.finishRank || 0), 0) / ridersWithRank.length
            : null;

        let bestSprint:
            | { label: string; riderName: string; timeSec: number }
            | null = null;

        sprintAnalysisRows.forEach((row) => {
            row.scatterData.forEach((entry) => {
                if (!bestSprint || Number(entry.time) < bestSprint.timeSec) {
                    bestSprint = {
                        label: `${row.sprint.name} #${row.sprint.count}`,
                        riderName: String(entry.name),
                        timeSec: Number(entry.time),
                    };
                }
            });
        });

        const bestCp20 = displayRidersWithPower.reduce<{
            riderName: string;
            watts: number;
        } | null>((best, rider) => {
            const watts = Number(rider.resolvedCriticalPower.criticalP20Minutes || 0);
            if (!best || watts > best.watts) {
                return { riderName: rider.name, watts };
            }
            return best;
        }, null);

        return {
            riderCount: displayRiders.length,
            avgRank,
            bestSprint,
            bestCp20,
        };
    }, [statsMode, displayRiders, sprintAnalysisRows, displayRidersWithPower]);

    const exportSprintCsv = () => {
        const rows: string[][] = [['Sprint', 'Rytter', 'Kategori', 'Rang', 'Tid (s)', 'Effekt (w)']];
        sprintAnalysisRowsForDisplay.forEach((row) => {
            row.scatterData.forEach((entry) => {
                rows.push([
                    `${row.sprint.name} #${row.sprint.count}`,
                    String(entry.name || ''),
                    String(entry.category || ''),
                    String(entry.rank ?? ''),
                    Number(entry.time).toFixed(2),
                    String(entry.power ?? ''),
                ]);
            });
        });
        const csv = rows
            .map((line) => line.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(','))
            .join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `sprintanalyse-${selectedRaceId || 'race'}.csv`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        URL.revokeObjectURL(url);
    };

    const exportPowerCurvePng = async () => {
        const container = powerCurveChartRef.current;
        const svg = container?.querySelector('svg');
        if (!container || !svg) return;

        const rect = container.getBoundingClientRect();
        const width = Math.max(1200, Math.round(rect.width));
        const height = Math.max(420, Math.round(rect.height));
        const svgData = new XMLSerializer().serializeToString(svg);
        const encoded = window.btoa(unescape(encodeURIComponent(svgData)));
        const imgSrc = `data:image/svg+xml;base64,${encoded}`;

        await new Promise<void>((resolve) => {
            const image = new Image();
            image.onload = () => {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (ctx) {
                    ctx.fillStyle = '#ffffff';
                    ctx.fillRect(0, 0, width, height);
                    ctx.drawImage(image, 0, 0, width, height);
                    const png = canvas.toDataURL('image/png');
                    const link = document.createElement('a');
                    link.href = png;
                    link.download = `effektkurve-${selectedRaceId || 'race'}.png`;
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                }
                resolve();
            };
            image.onerror = () => resolve();
            image.src = imgSrc;
        });
    };
    if (authLoading || loading) {
        return <div className="p-12 text-center text-muted-foreground">Indlæser din statistik...</div>;
    }

    if (!selectedRace) {
        return (
            <div className="max-w-6xl mx-auto px-4 py-8">
                <h1 className="text-3xl font-bold mb-8">Min Statistik</h1>
                <div className="p-8 bg-muted/20 rounded text-center text-muted-foreground">
                    Ingen afsluttede løb med resultater fundet.
                </div>
            </div>
        );
    }

    return (
        <div className="max-w-6xl mx-auto px-4 py-8 pb-24">
            <h1 className="text-3xl font-bold mb-8 text-foreground">Statistik</h1>

            {/* Main Tabs */}
            <div className="flex gap-4 mb-8 border-b border-border">
                <button
                    onClick={() => setStatsMode('all')}
                    className={`pb-2 px-4 font-medium transition ${statsMode === 'all' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Min Statistik
                </button>
                <button
                    onClick={() => setStatsMode('club')}
                    className={`pb-2 px-4 font-medium transition ${statsMode === 'club' ? 'text-primary border-b-2 border-primary' : 'text-muted-foreground hover:text-foreground'}`}
                >
                    Klubstatistik
                </button>
            </div>

            {/* 1. Race Selector */}
            <div className="bg-card border border-border p-6 rounded-lg shadow-sm mb-8">
                <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                    <div>
                        <label className="block text-xs font-medium text-muted-foreground uppercase tracking-wider mb-1">
                            Vælg løb
                        </label>
                        <select
                            value={selectedRaceId}
                            onChange={(e) => setSelectedRaceId(e.target.value)}
                            className="bg-background border border-input rounded px-3 py-2 text-foreground font-medium w-full sm:w-80"
                        >
                            {races.map(r => (
                                <option key={r.id} value={r.id}>
                                    {new Date(r.date).toLocaleDateString()} - {r.name}
                                </option>
                            ))}
                        </select>
                    </div>

                    {userResult ? (
                        <div className="text-right">
                            <div className="text-2xl font-bold text-primary">
                                Rang {userResult.finishRank}
                            </div>
                            <div className="text-sm text-muted-foreground">
                                Kat {userCategory} • {userResult.totalPoints} Point
                            </div>
                        </div>
                    ) : (
                        <div className="text-right text-muted-foreground italic">
                            Du deltog ikke i dette løb (eller resultater mangler)
                        </div>
                    )}
                </div>
            </div>

            {!canRenderStatsSections ? (
                <div className="p-6 bg-muted/20 rounded text-center text-muted-foreground">
                    {statsMode === 'club'
                        ? 'Ingen holdkammerater fra din klub har resultater i dette løb. Tjek at klubbens ryttere er registreret korrekt og at resultaterne er behandlet.'
                        : 'Du deltog ikke i dette løb (eller resultater mangler). Prøv et andet løb i vælgeren ovenfor.'}
                </div>
            ) : (
                <div className="space-y-12">
                    {statsMode === 'club' && clubSnapshot && <ClubSnapshotCards snapshot={clubSnapshot} />}

                    <PowerCurveSection
                        statsMode={statsMode}
                        userCategory={referenceCategory}
                        powerLegendEntries={powerLegendEntries}
                        visibleDisplayRidersWithPower={visibleDisplayRidersWithPower}
                        highlightedRiderId={highlightedRiderId}
                        powerCurveChartRef={powerCurveChartRef}
                        getLineStyle={getLineStyle}
                        toggleRiderVisibility={toggleRiderVisibility}
                        setHighlightedRiderId={setHighlightedRiderId}
                        showAllRiders={showAllRiders}
                        hideAllRiders={hideAllRiders}
                        showOnlyMe={showOnlyMe}
                        exportPowerCurvePng={exportPowerCurvePng}
                    />

                    <SprintAnalysisSection
                        sprintXAxis={sprintXAxis}
                        setSprintXAxis={setSprintXAxis}
                        sprintCategoryFilter={sprintCategoryFilter}
                        setSprintCategoryFilter={setSprintCategoryFilter}
                        sprintFilterCategories={sprintFilterCategories}
                        configuredSprintsCount={configuredSprints.length}
                        sprintAnalysisRowsForDisplay={sprintAnalysisRowsForDisplay}
                        highlightedRiderId={highlightedRiderId}
                        setHighlightedRiderId={setHighlightedRiderId}
                        statsMode={statsMode}
                        userResult={userResult}
                        exportSprintCsv={exportSprintCsv}
                        formatTime={formatTime}
                    />

                </div>
            )}
        </div>
    );
}
