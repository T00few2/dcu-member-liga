'use client';

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { useParams, useSearchParams } from 'next/navigation';

    // Types
    interface CategoryConfig {
        category: string;
        laps?: number;
        sprints?: Sprint[];
        segmentType?: 'sprint' | 'split';
    }

    interface Race {
        name: string;
        results?: Record<string, ResultEntry[]>;
        sprints?: Sprint[];
        sprintData?: Sprint[];
        segmentType?: 'sprint' | 'split';
        eventMode?: 'single' | 'multi';
        eventConfiguration?: {
            eventId: string;
            customCategory: string;
            sprints?: Sprint[]; // Added support for per-category sprints
            segmentType?: 'sprint' | 'split';
        }[];
        singleModeCategories?: CategoryConfig[]; // Per-category config for single mode
    }

interface Sprint {
    id: string;
    name: string;
    count: number;
    key: string;
    lap?: number;
    type?: 'sprint' | 'split';
}

interface ResultEntry {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank: number;
    finishPoints: number;
    totalPoints: number;
    sprintDetails?: Record<string, number | string>;
}

interface StandingEntry {
    zwiftId: string;
    name: string;
    totalPoints: number;
    raceCount: number;
    results: { raceId: string, points: number }[];
    calculatedTotal?: number; // Added for display
}

export default function LiveResultsPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const raceId = params?.raceId as string;

    // Configuration from URL
    const categoryParam = searchParams.get('cat');
    const isTransparent = searchParams.get('transparent') !== 'false'; // Default true
    const isFull = searchParams.get('full') === 'true';
    const titleParam = searchParams.get('title');
    const defaultLogoSrc = '/live/logo.png';
    const defaultBannerSrc = '/live/banner.PNG';
    const defaultBackgroundSrc = '/live/background.jpg';
    const logoSrc = searchParams.get('logo') || defaultLogoSrc;
    const bannerParam = searchParams.get('banner');
    const includeBanner = bannerParam !== 'false';
    const bannerSrc = includeBanner ? (bannerParam || defaultBannerSrc) : '';
    const backgroundSrc = searchParams.get('bg') || defaultBackgroundSrc;
    
    // Parse limit robustly
    const rawLimit = searchParams.get('limit');
    let limit = 10;
    if (rawLimit) {
        const parsed = parseInt(rawLimit);
        if (!isNaN(parsed) && parsed > 0) {
            limit = parsed;
        }
    }
    
    const autoScroll = searchParams.get('scroll') === 'true';
    const showSprints = searchParams.get('sprints') !== 'false'; // Default true
    const showLastSprint = searchParams.get('lastSprint') === 'true';
    const showLastSplit = searchParams.get('lastSplit') === 'true';
    const fitToScreen = searchParams.get('fit') === 'true';
    
    // View Mode Configuration
    const viewParam = searchParams.get('view');
    const initialView = (viewParam === 'time-trial')
        ? 'time-trial'
        : (viewParam === 'standings') ? 'standings' : 'race';
    const cycleTime = parseInt(searchParams.get('cycle') || '0'); // Seconds, 0 = disabled

    const [race, setRace] = useState<Race | null>(null);
    const [standings, setStandings] = useState<Record<string, StandingEntry[]>>({});
    const [bestRacesCount, setBestRacesCount] = useState<number>(5);
    
    const [viewMode, setViewMode] = useState<'race' | 'standings' | 'time-trial'>(initialView);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Scrolling ref
    const containerRef = useRef<HTMLDivElement>(null);

    // 1. Fetch Race Data (Real-time)
    useEffect(() => {
        if (!raceId) return;

        const setupSubscription = async () => {
            let docRef;
            
            try {
                // 1. Try Document ID
                docRef = doc(db, 'races', raceId);
                const docSnap = await getDocs(query(collection(db, 'races'), where('__name__', '==', raceId)));
                
                if (docSnap.empty) {
                     // 2. Try Legacy Event ID
                     const q = query(collection(db, 'races'), where('eventId', '==', raceId));
                     const snapshot = await getDocs(q);
                     if (!snapshot.empty) {
                        docRef = doc(db, 'races', snapshot.docs[0].id);
                     } else {
                        // 3. Try Linked Event IDs
                        const q2 = query(collection(db, 'races'), where('linkedEventIds', 'array-contains', raceId));
                        const snapshot2 = await getDocs(q2);
                        
                        if (!snapshot2.empty) {
                            docRef = doc(db, 'races', snapshot2.docs[0].id);
                        } else {
                            setError(`No race found with ID: ${raceId}`);
                            setLoading(false);
                            return;
                        }
                     }
                }
            } catch (err: any) {
                console.error("Query error:", err);
                setError(`Query Error: ${err.message}`);
                setLoading(false);
                return;
            }

            const unsubscribe = onSnapshot(
                docRef,
                (docSnap) => {
                    if (docSnap.exists()) {
                        setRace(docSnap.data() as Race);
                        setLoading(false);
                    } else {
                        setError('Race not found');
                        setLoading(false);
                    }
                },
                (err) => {
                    console.error("Firestore error:", err);
                    setError(`Error: ${err.message} (${err.code})`);
                    setLoading(false);
                }
            );

            return unsubscribe;
        };

        let unsubscribeFn: (() => void) | undefined;
        setupSubscription().then(unsub => {
            unsubscribeFn = unsub;
        });

        return () => {
            if (unsubscribeFn) unsubscribeFn();
        };
    }, [raceId]);

    // 2. Fetch Standings Data (Real-time)
    useEffect(() => {
        // Fetch settings once
        const fetchSettings = async () => {
            try {
                // We use defaults if this fails.
                 const settingsDoc = await getDoc(doc(db, 'league', 'settings')); 
                 if (settingsDoc.exists()) {
                     const data = settingsDoc.data();
                     if (data?.bestRacesCount) {
                         setBestRacesCount(data.bestRacesCount);
                     }
                 }
            } catch (err) {
                console.error("Error fetching settings:", err);
            }
        };
        fetchSettings();

        // Subscribe to standings
        const unsub = onSnapshot(doc(db, 'league', 'standings'), 
            (docSnap) => {
                if (docSnap.exists()) {
                    const data = docSnap.data();
                    if (data.standings) {
                        setStandings(data.standings);
                    }
                }
            }, 
            (err) => {
                console.error("Standings error:", err);
            }
        );

        return () => unsub();
    }, []);

    // 3. Cycle View Mode
    useEffect(() => {
        if (cycleTime <= 0 || initialView === 'time-trial') return;

        const interval = setInterval(() => {
            setViewMode(prev => prev === 'race' ? 'standings' : 'race');
            // Reset scroll on switch
            if (containerRef.current) containerRef.current.scrollTop = 0;
        }, cycleTime * 1000);

        return () => clearInterval(interval);
    }, [cycleTime, initialView]);

    // 4. Auto-scroll effect
    useEffect(() => {
        if (!autoScroll || !containerRef.current) return;

        const scrollContainer = containerRef.current;
        let scrollPos = 0;
        let direction = 1; // 1 = down, -1 = up
        const speed = 1; // px per tick
        const tickMs = 50;
        const pauseMs = 3000;
        let intervalId: ReturnType<typeof setInterval> | null = null;
        let timeoutId: ReturnType<typeof setTimeout> | null = null;

        const stopInterval = () => {
            if (intervalId) {
                clearInterval(intervalId);
                intervalId = null;
            }
        };

        const startInterval = () => {
            if (intervalId) return;
            intervalId = setInterval(() => {
                // Only scroll if content overflows
                if (scrollContainer.scrollHeight <= scrollContainer.clientHeight) return;

                scrollPos += speed * direction;
                const maxScroll = scrollContainer.scrollHeight - scrollContainer.clientHeight;

                if (scrollPos >= maxScroll) {
                    scrollPos = maxScroll;
                    scrollContainer.scrollTop = scrollPos;
                    stopInterval();
                    timeoutId = setTimeout(() => {
                        direction = -1;
                        startInterval();
                    }, pauseMs);
                    return;
                }

                if (scrollPos <= 0) {
                    scrollPos = 0;
                    scrollContainer.scrollTop = scrollPos;
                    stopInterval();
                    timeoutId = setTimeout(() => {
                        direction = 1;
                        startInterval();
                    }, pauseMs);
                    return;
                }

                scrollContainer.scrollTop = scrollPos;
            }, tickMs);
        };

        scrollContainer.scrollTop = 0;
        scrollPos = 0;
        timeoutId = setTimeout(() => {
            startInterval();
        }, pauseMs);

        return () => {
            stopInterval();
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
        };
    }, [autoScroll, race, viewMode, standings]); // Re-run when data updates or view changes

    if (loading) return <div className="p-8 text-white font-bold text-2xl">Loading Live Data...</div>;
    if (error) return <div className="p-8 text-red-500 font-bold text-2xl">{error}</div>;
    if (!race) return null;

    // --- Data Processing ---

    // Determine Category
    let displayCategory = categoryParam;

    if (!displayCategory) {
        // Priority 1: Multi-mode Configuration
        if (race.eventMode === 'multi' && race.eventConfiguration && race.eventConfiguration.length > 0) {
            // 1a. Check if the current URL param (raceId) matches a specific event config
            const match = race.eventConfiguration.find((c: any) => c.eventId === raceId);
            if (match && match.customCategory) {
                displayCategory = match.customCategory;
            } else {
                // 1b. Fallback to the first configured category
                // This handles the case where we are viewing by Race Document ID, not Zwift ID
                if (race.eventConfiguration[0].customCategory) {
                    displayCategory = race.eventConfiguration[0].customCategory;
                }
            }
        }
        
        // Priority 2: Existing Results
        if (!displayCategory && race.results) {
             const categories = Object.keys(race.results);
             if (categories.length > 0) {
                 displayCategory = categories[0];
             }
        }
    }
    
    const category = displayCategory || 'A';
    const headerTitle = titleParam || race.name || 'Race Results';
    
    // Get result count for fit-to-screen calculations
    const results = race.results?.[category] || [];
    const resultCount = Math.min(results.length, limit);
    
    // Calculate dynamic sizing when fitToScreen is enabled
    // Approximate available height: viewport minus header (~120px) and some padding
    // Each row needs: padding + text height
    const getFitToScreenStyles = () => {
        if (!fitToScreen || !isFull || resultCount === 0) {
            return {
                headerPadding: isFull ? 'py-0' : 'py-1',
                bodyPadding: isFull ? 'py-0.5' : 'py-2',
                textSize: isFull ? 'text-2xl' : 'text-3xl',
                rowStyle: {}
            };
        }
        
        // Calculate based on number of rows to display
        // Available height is roughly: 100vh - header(~100px) - table header(~40px)
        // We want all rows to fit, so divide available space by row count
        const availableHeight = 100; // vh units
        const headerOffset = 15; // vh for header and table header
        const tableHeight = availableHeight - headerOffset;
        const rowHeight = Math.max(3, Math.min(8, tableHeight / resultCount)); // vh per row, min 3vh, max 8vh
        
        // Scale text size based on row height
        // 17 riders at 85vh gives ~5vh per row, should use text-2xl (medium)
        let textSize = 'text-2xl';
        if (rowHeight < 3.5) textSize = 'text-base';
        else if (rowHeight < 4.5) textSize = 'text-lg';
        else if (rowHeight < 5) textSize = 'text-xl';
        
        return {
            headerPadding: 'py-0',
            bodyPadding: '', // Will use inline style instead
            textSize,
            rowStyle: { height: `${rowHeight}vh` }
        };
    };
    
    const fitStyles = getFitToScreenStyles();
    const headerCellPadding = fitStyles.headerPadding;
    const bodyCellPadding = fitStyles.bodyPadding;
    const tableBodyTextSize = fitStyles.textSize;
    const fitRowStyle = fitStyles.rowStyle;

    const formatTimeValue = (ms: number) => {
        const safeMs = Math.max(0, ms);
        const totalSeconds = Math.floor(safeMs / 1000);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;
        const millis = safeMs % 1000;

        const pad = (n: number) => n.toString().padStart(2, '0');
        const padMs = (n: number) => n.toString().padStart(3, '0');

        if (hours > 0) {
            return `${hours}:${pad(minutes)}:${pad(seconds)}.${padMs(millis)}`;
        }
        return `${pad(minutes)}:${pad(seconds)}.${padMs(millis)}`;
    };

    const formatTimeOrDash = (ms?: number) => {
        if (!ms) return '-';
        return formatTimeValue(ms);
    };

    const formatDelta = (ms?: number | null) => {
        if (ms === null || ms === undefined) return '-';
        const raw = formatTimeValue(Math.max(0, ms));
        const stripped = raw
            .replace(/^00:/, '')
            .replace(/^0(\d):/, '$1:')
            .replace(/^0(\d)(\.)/, '$1$2');
        if (ms <= 0) return stripped;
        return `+${stripped}`;
    };


    // --- Render Content ---

    const renderRaceResults = () => {
        const results = race.results?.[category] || [];

        // Sprint Columns Logic
        const allSprintKeys = new Set<string>();
        
        // 1. Gather all sprint keys actually found in the RESULTS for this category
        if (showSprints || showLastSprint) {
            results.forEach(r => {
                if (r.sprintDetails) {
                    Object.keys(r.sprintDetails).forEach(k => allSprintKeys.add(k));
                }
            });
        }
        
        // 2. Determine the configured segments for resolving names/order
        let configuredSegments: Sprint[] = [];
        let segmentType: 'sprint' | 'split' = race.segmentType || 'sprint';
        
        if (race.eventMode === 'multi' && race.eventConfiguration) {
            // Find config for current category
            const catConfig = race.eventConfiguration.find(c => c.customCategory === category);
            // Use per-category sprints if available
            if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
                configuredSegments = catConfig.sprints;
                segmentType = catConfig.segmentType || segmentType;
            } else {
                 // Fallback to global if not found
                 configuredSegments = race.sprints || [];
            }
        } else {
            // Single Mode - check for per-category config
            if (race.singleModeCategories && race.singleModeCategories.length > 0) {
                const catConfig = race.singleModeCategories.find(c => c.category === category);
                if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
                    configuredSegments = catConfig.sprints;
                    segmentType = catConfig.segmentType || segmentType;
                } else {
                    // Fallback to global sprints
                    configuredSegments = race.sprints || race.sprintData || [];
                }
            } else {
                // Legacy: no per-category config
                configuredSegments = race.sprints || race.sprintData || [];
            }
        }
        const sprintSegments = segmentType === 'split'
            ? []
            : configuredSegments.filter(s => s.type !== 'split');

        // Sprint columns ordering (aligned with results page)
        let sprintColumns: string[] = [];
        const remainingSprintKeys = new Set(allSprintKeys);

        if (sprintSegments.length > 0) {
            sprintSegments.forEach(s => {
                const potentialKeys = [s.key, `${s.id}_${s.count}`, `${s.id}`];
                const foundKey = potentialKeys.find(k => k && remainingSprintKeys.has(k));
                if (foundKey) {
                    sprintColumns.push(foundKey);
                    remainingSprintKeys.delete(foundKey);
                }
            });
        }

        if (remainingSprintKeys.size > 0) {
            sprintColumns = [...sprintColumns, ...Array.from(remainingSprintKeys).sort()];
        }

        if (showLastSprint && sprintColumns.length > 0) {
            sprintColumns = [sprintColumns[sprintColumns.length - 1]];
        } else if (!showSprints) {
            sprintColumns = [];
        }

        // Helper to get header name
        const getSprintHeader = (key: string) => {
             // Try to find in sourceSprints first (most specific)
            const sprint = sprintSegments.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
             if (sprint) return `${sprint.name} #${sprint.count}`;
             
             // Fallback to global search if not found (safety)
             if (race.sprints) {
                 const globalSprint = race.sprints.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
                 if (globalSprint) return `${globalSprint.name} #${globalSprint.count}`;
             }
             
             return key;
        };

        const displayResults = [...results]
            .sort((a, b) => (b.totalPoints || 0) - (a.totalPoints || 0))
            .slice(0, limit);

        return (
            <table className="w-full text-left border-collapse table-fixed">
                <thead>
                    <tr className="text-slate-400 text-lg uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80">
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[10%] text-center`}>#</th>
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 ${sprintColumns.length > 0 ? 'w-[40%]' : 'w-[50%]'}`}>Rider</th>
                        {sprintColumns.length > 0 ? (
                            <>
                                {sprintColumns.map(key => (
                                <th
                                    key={key}
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center font-bold break-words text-blue-400`}
                                >
                                    {getSprintHeader(key)}
                                </th>
                                ))}
                                <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-right font-bold text-blue-300`}>
                                    Total
                                </th>
                            </>
                        ) : (
                            <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[35%] text-right font-bold break-words text-blue-400`}>
                                Pts
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody className={`text-white font-bold ${tableBodyTextSize}`}>
                    {displayResults.map((rider, idx) => (
                        <tr 
                            key={rider.zwiftId} 
                            className="border-b border-slate-700/50 even:bg-slate-800/40"
                            style={fitRowStyle}
                        >
                            <td className={`${bodyCellPadding} px-2 text-center font-bold text-slate-300 align-middle`}>
                                {idx + 1}
                            </td>
                            <td className={`${bodyCellPadding} px-2 truncate align-middle`}>
                                {rider.name}
                            </td>
                            {sprintColumns.length > 0 ? (
                                <>
                                    {sprintColumns.map(key => (
                                        <td key={key} className={`${bodyCellPadding} px-2 text-center font-extrabold text-blue-400 align-middle`}>
                                            {rider.sprintDetails?.[key] ?? '-'}
                                        </td>
                                    ))}
                                    <td className={`${bodyCellPadding} px-2 text-right font-extrabold text-blue-300 align-middle`}>
                                        {rider.totalPoints ?? 0}
                                    </td>
                                </>
                            ) : (
                                <td className={`${bodyCellPadding} px-2 text-right font-extrabold text-blue-400 align-middle`}>
                                    {rider.totalPoints}
                                </td>
                            )}
                        </tr>
                    ))}
                    {displayResults.length === 0 && (
                        <tr>
                            <td colSpan={3} className="py-8 text-center text-slate-500 text-xl italic">
                                Waiting for results...
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        );
    };

    const renderStandings = () => {
        const rawStandings = standings[category] || [];
        
        // Process Best X
        const processedStandings = rawStandings.map(rider => {
            const sortedResults = [...rider.results].sort((a, b) => b.points - a.points);
            const bestTotal = sortedResults.slice(0, bestRacesCount).reduce((sum, r) => sum + r.points, 0);
            return {
                ...rider,
                calculatedTotal: bestTotal
            };
        });

        // Sort
        const currentStandings = processedStandings.sort((a, b) => (b.calculatedTotal || 0) - (a.calculatedTotal || 0));
        const displayResults = currentStandings.slice(0, limit);

        return (
            <table className="w-full text-left border-collapse table-fixed">
                <thead>
                    <tr className="text-slate-400 text-lg uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80">
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[10%] text-center`}>#</th>
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[55%]`}>Rider</th>
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-[35%] text-right font-bold text-green-400`}>
                            Points
                        </th>
                    </tr>
                </thead>
                <tbody className={`text-white font-bold ${tableBodyTextSize}`}>
                    {displayResults.map((rider, idx) => (
                        <tr 
                            key={rider.zwiftId} 
                            className="border-b border-slate-700/50 even:bg-slate-800/40"
                            style={fitRowStyle}
                        >
                            <td className={`${bodyCellPadding} px-2 text-center font-bold text-slate-300 align-middle`}>
                                {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                            </td>
                            <td className={`${bodyCellPadding} px-2 truncate align-middle`}>
                                {rider.name}
                            </td>
                            <td className={`${bodyCellPadding} px-2 text-right font-extrabold text-green-400 align-middle`}>
                                {rider.calculatedTotal}
                            </td>
                        </tr>
                    ))}
                    {displayResults.length === 0 && (
                        <tr>
                            <td colSpan={3} className="py-8 text-center text-slate-500 text-xl italic">
                                No standings available for category '{category}'.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        );
    };

    const renderTimeTrialSplits = () => {
        const results = race.results?.[category] || [];

        // Determine the configured segments for resolving names/order
        let configuredSegments: Sprint[] = [];
        let segmentType: 'sprint' | 'split' = race.segmentType || 'sprint';

        if (race.eventMode === 'multi' && race.eventConfiguration) {
            // Find config for current category
            const catConfig = race.eventConfiguration.find(c => c.customCategory === category);
            // Use per-category sprints if available
            if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
                configuredSegments = catConfig.sprints;
                segmentType = catConfig.segmentType || segmentType;
            } else {
                // Fallback to global if not found
                configuredSegments = race.sprints || [];
            }
        } else {
            // Single Mode - check for per-category config
            if (race.singleModeCategories && race.singleModeCategories.length > 0) {
                const catConfig = race.singleModeCategories.find(c => c.category === category);
                if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
                    configuredSegments = catConfig.sprints;
                    segmentType = catConfig.segmentType || segmentType;
                } else {
                    // Fallback to global sprints
                    configuredSegments = race.sprints || race.sprintData || [];
                }
            } else {
                // Legacy: no per-category config
                configuredSegments = race.sprints || race.sprintData || [];
            }
        }

        const splitSegments = segmentType === 'split'
            ? configuredSegments
            : configuredSegments.filter(s => s.type === 'split');

        const parseWorldTime = (value: unknown) => {
            if (value === null || value === undefined) return null;
            const parsed = typeof value === 'string' ? parseInt(value, 10) : Number(value);
            return Number.isFinite(parsed) ? parsed : null;
        };

        const minWorldTimes = new Map<string, number>();
        const getWorldTimeForColumn = (rider: ResultEntry, columnKeys: string[]) => {
            for (const key of columnKeys) {
                const worldTime = parseWorldTime(rider.sprintDetails?.[key]);
                if (worldTime !== null) return worldTime;
            }
            return null;
        };

        let splitColumns = splitSegments.map((s) => ({
            label: `${s.name} #${s.count}`,
            keys: [s.key, `${s.id}_${s.count}`, `${s.id}`].filter(Boolean) as string[]
        }));

        // Check if any rider has finished
        const hasAnyFinisher = results.some(r => r.finishTime && r.finishTime > 0);

        // In "show last split" mode: if riders have finished, treat finish as the final split
        // and hide all split columns (show only finish time)
        const showFinishAsLastSplit = showLastSplit && hasAnyFinisher;

        if (showLastSplit && splitColumns.length > 0 && !showFinishAsLastSplit) {
            // No finishers yet - find the last split with data
            let lastWithData = -1;
            for (let i = splitColumns.length - 1; i >= 0; i--) {
                const col = splitColumns[i];
                const hasData = results.some(r => getWorldTimeForColumn(r, col.keys) !== null);
                if (hasData) {
                    lastWithData = i;
                    break;
                }
            }
            if (lastWithData >= 0) {
                splitColumns = [splitColumns[lastWithData]];
            }
        } else if (showFinishAsLastSplit) {
            // Riders have finished - hide split columns, show only finish time
            splitColumns = [];
        }

        splitColumns.forEach(col => {
            const times = results
                .map(r => getWorldTimeForColumn(r, col.keys))
                .filter((v): v is number => v !== null);
            if (times.length > 0) {
                minWorldTimes.set(col.keys[0], Math.min(...times));
            }
        });

        const getLatestSplit = (rider: ResultEntry) => {
            for (let i = splitColumns.length - 1; i >= 0; i--) {
                const worldTime = getWorldTimeForColumn(rider, splitColumns[i].keys);
                if (worldTime !== null) {
                    return { index: i, worldTime };
                }
            }
            return null;
        };

        const displayResults = [...results]
            .sort((a, b) => {
                const aFinished = a.finishTime && a.finishTime > 0;
                const bFinished = b.finishTime && b.finishTime > 0;

                if (aFinished && bFinished) {
                    return a.finishTime - b.finishTime;
                }
                if (aFinished) return -1;
                if (bFinished) return 1;

                const aLatest = getLatestSplit(a);
                const bLatest = getLatestSplit(b);

                if (aLatest && bLatest) {
                    if (aLatest.index !== bLatest.index) {
                        return bLatest.index - aLatest.index;
                    }
                    return aLatest.worldTime - bLatest.worldTime;
                }
                if (aLatest) return -1;
                if (bLatest) return 1;
                return 0;
            })
            .slice(0, limit);

        // Find the winner's (fastest) finish time for calculating deltas
        const winnerFinishTime = hasAnyFinisher 
            ? Math.min(...displayResults.filter(r => r.finishTime > 0).map(r => r.finishTime))
            : 0;

        // Format finish time: winner gets absolute time, others get delta
        const formatFinishTimeOrDelta = (finishTime: number, isFirst: boolean) => {
            if (!finishTime || finishTime <= 0) return '-';
            if (isFirst || finishTime === winnerFinishTime) {
                return formatTimeValue(finishTime);
            }
            // Show delta to winner
            const delta = finishTime - winnerFinishTime;
            return formatDelta(delta);
        };

        // Determine column count for proper table layout
        const totalColumns = 2 + splitColumns.length + (hasAnyFinisher ? 1 : 0);
        const showNoSplitsMessage = displayResults.length > 0 && splitColumns.length === 0 && !showFinishAsLastSplit;

        return (
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className="text-slate-400 text-lg uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80">
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 w-16 text-center`}>#</th>
                        <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2`}>Rider</th>
                        {splitColumns.map(col => {
                            return (
                                <th
                                    key={col.keys[0]}
                                    className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center text-blue-300 w-40`}
                                >
                                    {col.label}
                                </th>
                            );
                        })}
                        {hasAnyFinisher && (
                            <th className={`sticky top-0 z-10 bg-slate-800/90 ${headerCellPadding} px-2 text-center text-green-300 w-48`}>
                                Finish Time
                            </th>
                        )}
                    </tr>
                </thead>
                <tbody className={`text-white font-bold ${tableBodyTextSize}`}>
                    {displayResults.map((rider, idx) => {
                        const isWinner = rider.finishTime > 0 && rider.finishTime === winnerFinishTime;
                        return (
                            <tr
                                key={rider.zwiftId}
                                className="border-b border-slate-700/50 even:bg-slate-800/40"
                                style={fitRowStyle}
                            >
                                <td className={`${bodyCellPadding} px-2 text-center font-bold text-slate-300 align-middle`}>
                                    {idx + 1}
                                </td>
                                <td className={`${bodyCellPadding} px-2 truncate align-middle`}>
                                    {rider.name}
                                </td>
                                {splitColumns.map(col => {
                                    const worldTime = getWorldTimeForColumn(rider, col.keys);
                                    const minTime = minWorldTimes.get(col.keys[0]);
                                    const delta = (worldTime !== null && minTime !== undefined) ? (worldTime - minTime) : null;
                                    return (
                                        <td key={col.keys[0]} className={`${bodyCellPadding} px-2 text-center font-extrabold text-blue-300 align-middle`}>
                                            {delta === null ? '-' : formatDelta(delta)}
                                        </td>
                                    );
                                })}
                                {hasAnyFinisher && (
                                    <td className={`${bodyCellPadding} px-2 text-center font-extrabold align-middle ${isWinner ? 'text-green-300' : 'text-green-400/80'}`}>
                                        {formatFinishTimeOrDelta(rider.finishTime, isWinner)}
                                    </td>
                                )}
                            </tr>
                        );
                    })}
                    {displayResults.length === 0 && (
                        <tr>
                            <td colSpan={totalColumns} className="py-8 text-center text-slate-500 text-xl italic">
                                No split results available.
                            </td>
                        </tr>
                    )}
                    {showNoSplitsMessage && (
                        <tr>
                            <td colSpan={totalColumns} className="py-8 text-center text-slate-500 text-xl italic">
                                No split segments configured.
                            </td>
                        </tr>
                    )}
                </tbody>
            </table>
        );
    };

    if (isFull) {
        return (
            <div className="fixed inset-0 z-50 overflow-hidden font-sans text-white">
                <div
                    className="absolute inset-0 bg-slate-600"
                    style={{
                        backgroundImage: backgroundSrc ? `url(${backgroundSrc})` : undefined,
                        backgroundSize: 'cover',
                        backgroundPosition: 'center',
                        filter: 'blur(6px)',
                        transform: 'scale(1.03)'
                    }}
                />
                <div className="absolute inset-0 bg-slate-600/30" />

                <div className="relative z-10 flex h-full flex-col">
                    <header className="relative flex items-center justify-center py-6">
                        <div className="text-center">
                            <h1 className="text-4xl md:text-6xl font-black tracking-wide">{headerTitle}</h1>
                            <p className="mt-2 text-xl md:text-2xl text-slate-200 uppercase tracking-widest">
                                {viewMode === 'standings'
                                    ? `Standings • ${category}`
                                    : viewMode === 'time-trial'
                                        ? `Time Trail • ${category}`
                                        : `Results • ${category}`}
                            </p>
                        </div>

                        {logoSrc && (
                            <img
                                src={logoSrc}
                                alt="Logo"
                                className="absolute right-6 top-6 z-20 h-16 md:h-24 object-contain"
                                style={{ filter: 'none' }}
                            />
                        )}
                    </header>

                    <div
                        ref={containerRef}
                        className={`flex-1 overflow-auto px-6 ${autoScroll ? 'scrollbar-hide' : ''}`}
                    >
                        <div className="mx-auto max-w-6xl rounded-xl border border-slate-700/70 bg-slate-600/25 shadow-2xl backdrop-blur">
                            {viewMode === 'race'
                                ? renderRaceResults()
                                : viewMode === 'time-trial'
                                    ? renderTimeTrialSplits()
                                    : renderStandings()}
                        </div>
                    </div>

                    {includeBanner && bannerSrc && (
                        <div className="flex justify-center py-6">
                            <img
                                src={bannerSrc}
                                alt="Banner"
                                className="h-16 md:h-20 object-contain opacity-70"
                            />
                        </div>
                    )}
                </div>

                <style jsx global>{`
                    .site-footer {
                        display: none !important;
                    }
                    .scrollbar-hide::-webkit-scrollbar {
                        display: none;
                    }
                    .scrollbar-hide {
                        -ms-overflow-style: none;
                        scrollbar-width: none;
                    }
                `}</style>
            </div>
        );
    }

    return (
        <div 
            className={`fixed inset-0 z-50 overflow-hidden font-sans ${
                isTransparent ? 'bg-transparent' : 'bg-slate-900'
            }`}
        >
            <div 
                ref={containerRef}
                className={`h-full w-full overflow-auto ${autoScroll ? 'scrollbar-hide' : ''}`}
            >
                <div className="p-0">
                    {/* Header showing mode if not transparent or just to differentiate */}
                    <div className="sticky top-0 z-20 bg-slate-900/90 text-center py-2 border-b border-slate-700">
                        <h2 className="text-xl font-bold text-white uppercase tracking-widest">
                            {viewMode === 'standings'
                                ? `League Standings • ${category}`
                                : viewMode === 'time-trial'
                                    ? `Time Trail • ${category}`
                                    : `Race Results • ${category}`}
                        </h2>
                    </div>

                    {viewMode === 'race'
                        ? renderRaceResults()
                        : viewMode === 'time-trial'
                            ? renderTimeTrialSplits()
                            : renderStandings()}
                </div>
            </div>
            
            <style jsx global>{`
                .site-footer {
                    display: none !important;
                }
                .scrollbar-hide::-webkit-scrollbar {
                    display: none;
                }
                .scrollbar-hide {
                    -ms-overflow-style: none;
                    scrollbar-width: none;
                }
            `}</style>
        </div>
    );
}
