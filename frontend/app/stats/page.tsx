'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import {
    LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
    ScatterChart, Scatter, Cell
} from 'recharts';

import type { Race, Sprint, ResultEntry, CriticalPower } from '@/types/live';

const parsePositiveNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) && value > 0 ? value : null;
    if (typeof value === 'string') {
        const parsed = Number(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    return null;
};

const normalizeCriticalPower = (value: unknown): CriticalPower | null => {
    if (!value || typeof value !== 'object') return null;
    const source = value as Record<string, unknown>;

    const criticalP15Seconds = parsePositiveNumber(source.criticalP15Seconds ?? source.cp15s);
    const criticalP1Minute = parsePositiveNumber(source.criticalP1Minute ?? source.cp1min);
    const criticalP5Minutes = parsePositiveNumber(source.criticalP5Minutes ?? source.cp5min);
    const criticalP20Minutes = parsePositiveNumber(source.criticalP20Minutes ?? source.cp20min);

    if (
        criticalP15Seconds === null ||
        criticalP1Minute === null ||
        criticalP5Minutes === null ||
        criticalP20Minutes === null
    ) {
        return null;
    }

    return {
        criticalP15Seconds,
        criticalP1Minute,
        criticalP5Minutes,
        criticalP20Minutes,
    };
};

const pickFirstNonEmptySprints = (...lists: (Sprint[] | undefined)[]): Sprint[] => {
    for (const list of lists) {
        if (Array.isArray(list) && list.length > 0) return list;
    }
    return [];
};

const getConfiguredSprintsForCategory = (race: Race | undefined, category: string | null): Sprint[] => {
    if (!race) return [];
    const categoryName = String(category || '').trim();

    if (race.eventMode === 'grouped' && race.raceGroups?.length) {
        const group = race.raceGroups.find(g => (g.categories || []).some(c => c.category === categoryName));
        const catCfg = group?.categories?.find(c => c.category === categoryName);
        return pickFirstNonEmptySprints(
            catCfg?.sprints,
            group?.sprints,
            race.sprints,
            race.sprintData,
        );
    }

    if (race.eventMode === 'multi' && race.eventConfiguration?.length) {
        const catConfig = race.eventConfiguration.find(c => c.customCategory === categoryName);
        return pickFirstNonEmptySprints(catConfig?.sprints, race.sprints, race.sprintData);
    }

    if (race.singleModeCategories?.length) {
        const catConfig = race.singleModeCategories.find(c => c.category === categoryName);
        return pickFirstNonEmptySprints(catConfig?.sprints, race.sprints, race.sprintData);
    }

    return pickFirstNonEmptySprints(race.sprints, race.sprintData);
};

const CATEGORY_RANK_DESC = [
    'Diamond', 'Ruby', 'Emerald', 'Sapphire', 'Amethyst', 'Platinum', 'Gold', 'Silver', 'Bronze', 'Copper',
    'A', 'B', 'C', 'D', 'E',
];

const categoryRankIndex = (category: string): number => {
    const idx = CATEGORY_RANK_DESC.findIndex(
        (name) => name.toLowerCase() === String(category || '').trim().toLowerCase()
    );
    return idx === -1 ? Number.MAX_SAFE_INTEGER : idx;
};

const normalizeCategoryKey = (category: unknown): string =>
    String(category || '').trim().toLowerCase();

const STATS_PREFS_STORAGE_KEY = 'dcu-stats-page-preferences-v1';

export default function MyStatsPage() {
    const { user, loading: authLoading, isRegistered } = useAuth();

    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedRaceId, setSelectedRaceId] = useState<string>('');
    const [currentUserZwiftId, setCurrentUserZwiftId] = useState<string | null>(null);
    const [currentUserClub, setCurrentUserClub] = useState<string | null>(null);

    // Graph State
    const [sprintXAxis, setSprintXAxis] = useState<'rank' | 'time'>('time');

    // Club Stats State
    const [statsMode, setStatsMode] = useState<'all' | 'club'>('all');
    const [powerCurveByZwiftId, setPowerCurveByZwiftId] = useState<Record<string, CriticalPower>>({});
    const [clubByZwiftId, setClubByZwiftId] = useState<Record<string, string>>({});
    const [hiddenRiderIdsByMode, setHiddenRiderIdsByMode] = useState<{ all: string[]; club: string[] }>({ all: [], club: [] });
    const [highlightedRiderId, setHighlightedRiderId] = useState<string | null>(null);
    const [sprintCategoryFilter, setSprintCategoryFilter] = useState<string>('all');
    const [prefsHydrated, setPrefsHydrated] = useState(false);
    const powerCurveChartRef = useRef<HTMLDivElement | null>(null);

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
                        setSelectedRaceId(finishedRaces[0].id);
                    }
                }

                // Fallback power-curve source (users collection) for race results where criticalP is empty.
                const participantsRes = await fetch(`${API_URL}/participants`, {
                    headers: { 'Authorization': `Bearer ${token}` }
                });
                if (participantsRes.ok) {
                    const participantsPayload = await participantsRes.json();
                    const participants = Array.isArray(participantsPayload?.participants) ? participantsPayload.participants : [];
                    const nextPowerMap: Record<string, CriticalPower> = {};
                    const nextClubMap: Record<string, string> = {};
                    for (const participant of participants) {
                        const zwiftId = String(participant?.zwiftId || '').trim();
                        if (!zwiftId) continue;
                        if (typeof participant?.club === 'string' && participant.club.trim().length > 0) {
                            nextClubMap[zwiftId] = participant.club.trim();
                        }
                        const normalized = normalizeCriticalPower(participant);
                        if (normalized) {
                            nextPowerMap[zwiftId] = normalized;
                        }
                    }
                    setPowerCurveByZwiftId(nextPowerMap);
                    setClubByZwiftId(nextClubMap);
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

    // --- 3. Derive Data for Views ---

    const selectedRace = useMemo(() =>
        races.find(r => r.id === selectedRaceId),
        [races, selectedRaceId]);

    // Find which category the user rode in
    const userCategory = useMemo(() => {
        if (!selectedRace?.results || !currentUserZwiftId) return null;
        for (const [cat, riders] of Object.entries(selectedRace.results)) {
            if (riders.some(r => r.zwiftId === currentUserZwiftId)) {
                return cat;
            }
        }
        return null;
    }, [selectedRace, currentUserZwiftId]);

    // Get result entry for user
    const userResult = useMemo(() => {
        if (!selectedRace?.results || !userCategory || !currentUserZwiftId) return null;
        return selectedRace.results[userCategory].find(r => r.zwiftId === currentUserZwiftId);
    }, [selectedRace, userCategory, currentUserZwiftId]);

    // Get flat list of all riders with category for Club Stats
    const allRiders = useMemo(() => {
        if (!selectedRace?.results) return [];
        const all: (ResultEntry & { category: string })[] = [];
        Object.entries(selectedRace.results).forEach(([cat, riders]) => {
            riders.forEach(r => all.push({ ...r, category: cat }));
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

    // Determine which riders to show on graphs
    const displayRiders = useMemo(() => {
        let riders: (ResultEntry & { category: string })[] = [];

        if (statsMode === 'all') {
            if (!userCategory || !selectedRace?.results) return [];
            riders = selectedRace.results[userCategory].map(r => ({ ...r, category: userCategory }));
        } else if (statsMode === 'club') {
            riders = allRiders.filter(r =>
                clubRiderIdsInRace.has(String(r.zwiftId))
            );
        }

        // Sort so current user is last (rendered on top)
        return riders.sort((a, b) => {
            if (a.zwiftId === currentUserZwiftId) return 1;
            if (b.zwiftId === currentUserZwiftId) return -1;
            return 0;
        });
    }, [statsMode, selectedRace, userCategory, allRiders, currentUserZwiftId, clubRiderIdsInRace]);

    const displayRidersWithPower = useMemo(() => {
        return displayRiders
            .map((rider) => {
                const raceCriticalPower = normalizeCriticalPower(rider.criticalP);
                const fallbackCriticalPower = powerCurveByZwiftId[String(rider.zwiftId)];
                const resolvedCriticalPower = raceCriticalPower ?? fallbackCriticalPower ?? null;
                return resolvedCriticalPower ? { ...rider, resolvedCriticalPower } : null;
            })
            .filter(Boolean) as Array<(ResultEntry & { category: string }) & { resolvedCriticalPower: CriticalPower }>;
    }, [displayRiders, powerCurveByZwiftId]);

    const categoryColorMap = useMemo(() => {
        const palette = [
            '#ef4444', // red
            '#22c55e', // green
            '#3b82f6', // blue
            '#eab308', // yellow
            '#a855f7', // purple
            '#06b6d4', // cyan
            '#f97316', // orange
            '#14b8a6', // teal
            '#ec4899', // pink
            '#84cc16', // lime
        ];
        const uniqueCategories = [...new Set(displayRiders.map((r) => String(r.category || '').trim()).filter(Boolean))].sort();
        const map: Record<string, string> = {};
        uniqueCategories.forEach((category, index) => {
            map[category] = palette[index % palette.length];
        });
        return map;
    }, [displayRiders]);

    const sprintSourceRiders = useMemo(() => {
        // For sprintanalyse we allow cross-category comparison, so category filter "Alle"
        // can truly include all categories from the race.
        return statsMode === 'all' ? allRiders : displayRiders;
    }, [statsMode, allRiders, displayRiders]);

    const sprintCategoryColorMap = useMemo(() => {
        const palette = [
            '#ef4444', '#22c55e', '#3b82f6', '#eab308', '#a855f7',
            '#06b6d4', '#f97316', '#14b8a6', '#ec4899', '#84cc16',
        ];
        const uniqueCategories = [...new Set(sprintSourceRiders.map((r) => String(r.category || '').trim()).filter(Boolean))].sort();
        const map: Record<string, string> = {};
        uniqueCategories.forEach((category, index) => {
            map[category] = palette[index % palette.length];
        });
        return map;
    }, [sprintSourceRiders]);

    const getLineStyle = (rider: (ResultEntry & { category: string }) & { resolvedCriticalPower: CriticalPower }) => {
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

    const hiddenRiderIds = useMemo(
        () => new Set(hiddenRiderIdsByMode[statsMode] || []),
        [hiddenRiderIdsByMode, statsMode],
    );

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
        // Guard against persisted settings hiding every rider in the current view.
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

    const comparisonCategory = useMemo(() => {
        if (userCategory) return userCategory;
        if (statsMode === 'club' && displayRiders.length > 0) return displayRiders[0].category;
        return null;
    }, [userCategory, statsMode, displayRiders]);

    const configuredSprints = useMemo(() => {
        return getConfiguredSprintsForCategory(selectedRace, comparisonCategory);
    }, [selectedRace, comparisonCategory]);

    const canRenderStatsSections = statsMode === 'club'
        ? displayRiders.length > 0
        : Boolean(userResult);

    const sprintAnalysisRows = useMemo(() => {
        return configuredSprints.map((sprint, index) => {
            const sprintKey = sprint.key || `${sprint.id}_${sprint.count}`;
            const myData = userResult?.sprintData?.[sprintKey] || null;

            const scatterData = sprintSourceRiders
                .map(rider => {
                    const sData = rider.sprintData?.[sprintKey];
                    if (!sData) return null;
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

                    return {
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
                    };
                })
                .filter(Boolean);

            return {
                sprint,
                sprintKey,
                sprintIndex: index + 1,
                myData,
                scatterData,
            };
        });
    }, [configuredSprints, userResult, sprintSourceRiders, currentUserZwiftId, clubRiderIdsInRace, statsMode, sprintCategoryColorMap]);

    const sprintAnalysisRowsForDisplay = useMemo(() => {
        return sprintAnalysisRows.map((row) => ({
            ...row,
            scatterData: row.scatterData.filter((entry) => {
                if (sprintCategoryFilter === 'all') return true;
                return normalizeCategoryKey(entry!.category) === normalizeCategoryKey(sprintCategoryFilter);
            }),
        }));
    }, [sprintAnalysisRows, sprintCategoryFilter]);

    const clubSnapshot = useMemo(() => {
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
                if (!bestSprint || Number(entry!.time) < bestSprint.timeSec) {
                    bestSprint = {
                        label: `${row.sprint.name} #${row.sprint.count}`,
                        riderName: String(entry!.name),
                        timeSec: Number(entry!.time),
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
                    String(entry!.name || ''),
                    String(entry!.category || ''),
                    String(entry!.rank ?? ''),
                    Number(entry!.time).toFixed(2),
                    String(entry!.power ?? ''),
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


    // --- Helper: Format Time ---
    const formatTime = (ms: number) => {
        if (!ms) return '-';
        const totalSeconds = ms / 1000;
        return totalSeconds.toFixed(1) + 's';
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
                    {statsMode === 'club' && clubSnapshot && (
                        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide">Ryttere i klubvisning</div>
                                <div className="text-2xl font-bold">{clubSnapshot.riderCount}</div>
                            </div>
                            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide">Gennemsnitlig rang</div>
                                <div className="text-2xl font-bold">
                                    {clubSnapshot.avgRank ? clubSnapshot.avgRank.toFixed(1) : '-'}
                                </div>
                            </div>
                            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide">Bedste sprint</div>
                                <div className="text-sm font-semibold">
                                    {clubSnapshot.bestSprint ? `${clubSnapshot.bestSprint.timeSec.toFixed(2)}s` : '-'}
                                </div>
                                {clubSnapshot.bestSprint && (
                                    <div className="text-xs text-muted-foreground">
                                        {clubSnapshot.bestSprint.riderName} - {clubSnapshot.bestSprint.label}
                                    </div>
                                )}
                            </div>
                            <div className="bg-card border border-border rounded-lg p-4 shadow-sm">
                                <div className="text-xs text-muted-foreground uppercase tracking-wide">Bedste CP20</div>
                                <div className="text-sm font-semibold">
                                    {clubSnapshot.bestCp20 ? `${clubSnapshot.bestCp20.watts}w` : '-'}
                                </div>
                                {clubSnapshot.bestCp20 && (
                                    <div className="text-xs text-muted-foreground">{clubSnapshot.bestCp20.riderName}</div>
                                )}
                            </div>
                        </section>
                    )}

                    {/* 2. Power Curve Analysis */}
                    <section>
                        <div className="flex justify-between items-center mb-4 gap-3 flex-wrap">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <span>💪 Sammenligning af effektkurve</span>
                            </h2>
                            <button
                                type="button"
                                onClick={exportPowerCurvePng}
                                className="text-xs px-3 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                            >
                                Download PNG
                            </button>
                        </div>

                        <div className="bg-card border border-border p-6 rounded-lg shadow-sm">
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <div className="text-xs text-muted-foreground">Klik på navne for at skjule/vise ryttere</div>
                                <div className="flex gap-2">
                                    <button
                                        type="button"
                                        onClick={showAllRiders}
                                        className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                                    >
                                        Vis alle
                                    </button>
                                    <button
                                        type="button"
                                        onClick={hideAllRiders}
                                        className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                                    >
                                        Skjul alle
                                    </button>
                                    <button
                                        type="button"
                                        onClick={showOnlyMe}
                                        className="text-xs px-2 py-1 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                                    >
                                        Kun mig
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-2 mb-4">
                                {powerLegendEntries.map(({ rider, style, isHidden }) => (
                                    <button
                                        key={`legend-toggle-${rider.zwiftId}`}
                                        type="button"
                                        onClick={() => toggleRiderVisibility(String(rider.zwiftId))}
                                        onMouseEnter={() => setHighlightedRiderId(String(rider.zwiftId))}
                                        onMouseLeave={() => setHighlightedRiderId(null)}
                                        className={`inline-flex items-center gap-1 px-2 py-1 rounded text-xs transition ${isHidden ? 'opacity-40' : 'opacity-100'}`}
                                        title={isHidden ? 'Klik for at vise rytter' : 'Klik for at skjule rytter'}
                                    >
                                        <span style={{ color: style.strokeColor }}>●</span>
                                        <span className={`${isHidden ? 'line-through' : ''} ${highlightedRiderId === String(rider.zwiftId) ? 'font-semibold' : ''}`}>{style.name}</span>
                                    </button>
                                ))}
                            </div>
                            <div className="h-[400px] w-full" ref={powerCurveChartRef}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart>
                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                        <XAxis
                                            dataKey="name"
                                            type="category"
                                            allowDuplicatedCategory={false}
                                            tick={{ fontSize: 12 }}
                                        />
                                        <YAxis
                                            label={{ value: 'Watts', angle: -90, position: 'insideLeft' }}
                                            tick={{ fontSize: 12 }}
                                        />
                                        <Tooltip
                                            content={({ active, payload, label }) => {
                                                if (active && payload && payload.length) {
                                                    if (statsMode === 'club') {
                                                        const rows = [...payload]
                                                            .filter((entry) => entry && entry.name && entry.value !== undefined && entry.value !== null)
                                                            .sort((a, b) => {
                                                                const aIsMe = a.name === 'Mig' ? 1 : 0;
                                                                const bIsMe = b.name === 'Mig' ? 1 : 0;
                                                                if (aIsMe !== bIsMe) return bIsMe - aIsMe;
                                                                const aVal = Number(a.value ?? 0);
                                                                const bVal = Number(b.value ?? 0);
                                                                return bVal - aVal;
                                                            })
                                                            .slice(0, 8);
                                                        if (rows.length === 0) return null;
                                                        return (
                                                            <div className="bg-background border border-border p-2 rounded shadow text-sm">
                                                                <p className="font-bold mb-1">{label}</p>
                                                                {rows.map((row) => (
                                                                    <p key={`${label}-${row.name}`} style={{ color: row.color }}>
                                                                        {row.name}: {row.value}w
                                                                    </p>
                                                                ))}
                                                            </div>
                                                        );
                                                    }

                                                    // I "Min Statistik", prefer your own curve, but fall back to hovered rider.
                                                    const myPayload = payload.find(p => p.name === "Mig");
                                                    const preferredPayload = myPayload || payload[0];
                                                    if (!preferredPayload) return null;

                                                    return (
                                                        <div className="bg-background border border-border p-2 rounded shadow text-sm">
                                                            <p className="font-bold mb-1">{label}</p>
                                                            <p style={{ color: preferredPayload.color }}>
                                                                {preferredPayload.name}: {preferredPayload.value}w
                                                            </p>
                                                        </div>
                                                    );
                                                }
                                                return null;
                                            }}
                                        />

                                        {/* Render Lines for displayRiders */}
                                        {visibleDisplayRidersWithPower.map((rider) => {
                                            const { isMe, isTeammate, strokeColor, strokeWidth, opacity, name } = getLineStyle(rider);

                                            const data = [
                                                { name: '15s', value: rider.resolvedCriticalPower.criticalP15Seconds },
                                                { name: '1m', value: rider.resolvedCriticalPower.criticalP1Minute },
                                                { name: '5m', value: rider.resolvedCriticalPower.criticalP5Minutes },
                                                { name: '20m', value: rider.resolvedCriticalPower.criticalP20Minutes },
                                            ];

                                            return (
                                                <Line
                                                    key={rider.zwiftId}
                                                    data={data}
                                                    type="monotone"
                                                    dataKey="value"
                                                    stroke={strokeColor}
                                                    strokeWidth={strokeWidth}
                                                    strokeOpacity={highlightedRiderId && highlightedRiderId !== String(rider.zwiftId) ? Math.max(0.1, opacity * 0.25) : opacity}
                                                    dot={isMe || (statsMode === 'club' && isTeammate)}
                                                    activeDot={{ r: highlightedRiderId === String(rider.zwiftId) ? 8 : 6 }}
                                                    name={name}
                                                    legendType="none"
                                                    isAnimationActive={false}
                                                    onMouseEnter={() => setHighlightedRiderId(String(rider.zwiftId))}
                                                    onMouseLeave={() => setHighlightedRiderId(null)}
                                                />
                                            );
                                        })}
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                            <p className="text-sm text-muted-foreground text-center mt-4">
                                {statsMode === 'club'
                                    ? `Sammenligner kritisk effekt for ryttere fra din klub i dette løb.`
                                    : `Sammenligner din kritiske effekt (15s, 1m, 5m, 20m) mod alle andre ryttere i kategori ${userCategory}.`
                                }
                            </p>
                        </div>
                    </section>

                    {/* 3. Sprint Analysis */}
                    <section>
                        <div className="flex justify-between items-center mb-4">
                            <h2 className="text-2xl font-bold flex items-center gap-2">
                                <span>⚡ Sprintanalyse</span>
                            </h2>

                            <div className="bg-muted/30 p-1 rounded-lg flex text-xs font-medium">
                                <button
                                    onClick={() => setSprintXAxis('rank')}
                                    className={`px-3 py-1 rounded transition-colors ${sprintXAxis === 'rank' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    Efter Rang
                                </button>
                                <button
                                    onClick={() => setSprintXAxis('time')}
                                    className={`px-3 py-1 rounded transition-colors ${sprintXAxis === 'time' ? 'bg-background shadow text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                                >
                                    Efter Tid
                                </button>
                            </div>
                        </div>
                        <div className="flex justify-between items-center gap-3 mb-4 flex-wrap">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-xs text-muted-foreground uppercase tracking-wide">Filter kategori:</span>
                                <button
                                    type="button"
                                    onClick={() => setSprintCategoryFilter('all')}
                                    className={`text-xs px-2 py-1 rounded transition-colors ${sprintCategoryFilter === 'all' ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted/50'}`}
                                >
                                    Alle
                                </button>
                                {sprintFilterCategories.map((category) => (
                                    <button
                                        key={`sprint-filter-${category}`}
                                        type="button"
                                        onClick={() => setSprintCategoryFilter(category)}
                                        className={`text-xs px-2 py-1 rounded transition-colors ${sprintCategoryFilter === category ? 'bg-primary text-primary-foreground' : 'bg-muted/30 hover:bg-muted/50'}`}
                                    >
                                        {category}
                                    </button>
                                ))}
                            </div>
                            <button
                                type="button"
                                onClick={exportSprintCsv}
                                className="text-xs px-3 py-1.5 rounded bg-muted/30 hover:bg-muted/50 transition-colors"
                            >
                                Download CSV
                            </button>
                        </div>
                        <div className="text-xs text-muted-foreground mb-2">
                            Aktivt filter: {sprintCategoryFilter === 'all' ? 'Alle' : sprintCategoryFilter}
                        </div>
                        {configuredSprints.length === 0 && (
                            <div className="text-muted-foreground italic">Ingen sprintsegmenter konfigureret for denne visning i dette løb. Tilføj segmenter i League Manager for at aktivere sprintanalyse.</div>
                        )}
                        {configuredSprints.length > 0 && userResult && (!userResult.sprintData || Object.keys(userResult.sprintData).length === 0) && (
                            <div className="text-muted-foreground italic mb-4">Ingen sprintdata registreret for dette løb.</div>
                        )}
                        {configuredSprints.length > 0 && sprintAnalysisRowsForDisplay.map((row) => (
                            <div key={row.sprintKey} className="mb-8">
                                <h3 className="text-lg font-semibold mb-3">Sprint {row.sprintIndex}</h3>
                                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 items-stretch">
                                    <div className="bg-card border border-border rounded-lg p-4 shadow-sm h-full">
                                        <div className="flex justify-between items-center mb-3">
                                            <h4 className="font-semibold text-lg">{row.sprint.name} <span className="text-sm font-normal text-muted-foreground">#{row.sprint.count}</span></h4>
                                        </div>

                                        {row.myData ? (
                                            <div className="grid grid-cols-4 gap-4 text-center mb-4">
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Rang</div>
                                                    <div className="font-mono font-bold">{row.myData.rank}</div>
                                                </div>
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Tid</div>
                                                    <div className="font-mono font-bold">{formatTime(row.myData.time)}</div>
                                                    {row.scatterData.length > 0 && (
                                                        <div className="text-[11px] text-muted-foreground mt-1">
                                                            {(() => {
                                                                const bestTime = Math.min(...row.scatterData.map((entry) => Number(entry!.time)));
                                                                const delta = Number(row.myData.time) / 1000 - bestTime;
                                                                return delta <= 0.001 ? 'Bedste tid i klubvisning' : `+${delta.toFixed(2)}s fra bedste`;
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Gns. effekt</div>
                                                    <div className="font-mono font-bold text-orange-500">{row.myData.avgPower}w</div>
                                                    {row.scatterData.length > 0 && (
                                                        <div className="text-[11px] text-muted-foreground mt-1">
                                                            {(() => {
                                                                const bestPower = Math.max(...row.scatterData.map((entry) => Number(entry!.power)));
                                                                const delta = Number(row.myData.avgPower) - bestPower;
                                                                return delta >= -0.5 ? 'Bedste effekt i klubvisning' : `${delta.toFixed(0)}w fra bedste`;
                                                            })()}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className="bg-muted/30 p-2 rounded">
                                                    <div className="text-xs text-muted-foreground">Point</div>
                                                    <div className="font-mono font-bold">{userResult?.sprintDetails?.[row.sprintKey] || 0}</div>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-muted-foreground italic">
                                                Du deltog ikke i dette løb, så din personlige sprinttabel vises ikke.
                                            </div>
                                        )}
                                    </div>

                                    <div className="bg-card border border-border rounded-lg p-4 shadow-sm h-[320px]">
                                        {row.scatterData.length === 0 ? (
                                            <div className="h-full flex items-center justify-center text-muted-foreground italic">
                                                Ingen sammenligningsdata for denne sprint med nuvaerende filter. Proev en anden kategori eller vaelg "Alle".
                                            </div>
                                        ) : (
                                            <>
                                                <h4 className="text-sm font-semibold text-muted-foreground mb-2 text-center">
                                                    {row.sprint.name} #{row.sprint.count} Sammenligning
                                                </h4>
                                                <ResponsiveContainer width="100%" height="100%">
                                                    <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                                        <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
                                                        <XAxis
                                                            type="number"
                                                            dataKey={sprintXAxis === 'rank' ? 'rank' : 'time'}
                                                            name={sprintXAxis === 'rank' ? 'Rang' : 'Tid'}
                                                            unit={sprintXAxis === 'rank' ? '' : 's'}
                                                            domain={['auto', 'auto']}
                                                            tick={{ fontSize: 10 }}
                                                            label={{ value: sprintXAxis === 'rank' ? 'Rang' : 'Tid (s)', position: 'insideBottom', offset: -5, fontSize: 10 }}
                                                        />
                                                        <YAxis
                                                            type="number"
                                                            dataKey="power"
                                                            name="Effekt"
                                                            unit="w"
                                                            tick={{ fontSize: 10 }}
                                                            label={{ value: 'Effekt (w)', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle' }, fontSize: 10 }}
                                                        />
                                                        <Tooltip
                                                            cursor={{ strokeDasharray: '3 3' }}
                                                            content={({ active, payload }) => {
                                                                if (active && payload && payload.length) {
                                                                    const data = payload[0].payload;
                                                                    return (
                                                                        <div className="bg-background border border-border p-2 rounded shadow text-xs">
                                                                            <p className="font-bold" style={{ color: data.color }}>{data.name}</p>
                                                                            <p>Rang: {data.rank}</p>
                                                                            <p>Tid: {data.time.toFixed(2)}s</p>
                                                                            <p>Effekt: {data.power}w</p>
                                                                        </div>
                                                                    );
                                                                }
                                                                return null;
                                                            }}
                                                        />
                                                        <Scatter name="Riders" data={row.scatterData}>
                                                            {row.scatterData.map((entry, index) => (
                                                                <Cell
                                                                    key={`cell-${row.sprintKey}-${index}`}
                                                                    fill={entry!.color}
                                                                    fillOpacity={highlightedRiderId && highlightedRiderId !== String(entry!.id) ? Math.max(0.15, Number(entry!.opacity) * 0.35) : entry!.opacity}
                                                                    stroke={entry!.isMe ? '#b91c1c' : '#4f46e5'}
                                                                    strokeOpacity={entry!.isMe ? 1 : 0.85}
                                                                    strokeWidth={highlightedRiderId === String(entry!.id) ? 3 : (entry!.isMe ? 2 : 1.5)}
                                                                    onMouseEnter={() => setHighlightedRiderId(String(entry!.id))}
                                                                    onMouseLeave={() => setHighlightedRiderId(null)}
                                                                />
                                                            ))}
                                                        </Scatter>
                                                        {statsMode === 'club' && (
                                                            <text x="95%" y={20} textAnchor="end" fontSize="10" fill="#666">
                                                                Farver = kategorier
                                                            </text>
                                                        )}
                                                    </ScatterChart>
                                                </ResponsiveContainer>
                                            </>
                                        )}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </section>

                </div>
            )}
        </div>
    );
}
