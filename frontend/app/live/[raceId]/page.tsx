'use client';

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { useParams, useSearchParams } from 'next/navigation';

    // Types
    interface Race {
        name: string;
        results?: Record<string, ResultEntry[]>;
        sprints?: Sprint[];
        sprintData?: Sprint[];
        eventMode?: 'single' | 'multi';
        eventConfiguration?: {
            eventId: string;
            customCategory: string;
            sprints?: Sprint[]; // Added support for per-category sprints
        }[];
    }

interface Sprint {
    id: string;
    name: string;
    count: number;
    key: string;
}

interface ResultEntry {
    zwiftId: string;
    name: string;
    finishTime: number;
    finishRank: number;
    finishPoints: number;
    totalPoints: number;
    sprintDetails?: Record<string, number>;
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
    
    // View Mode Configuration
    const initialView = (searchParams.get('view') === 'standings') ? 'standings' : 'race';
    const cycleTime = parseInt(searchParams.get('cycle') || '0'); // Seconds, 0 = disabled

    const [race, setRace] = useState<Race | null>(null);
    const [standings, setStandings] = useState<Record<string, StandingEntry[]>>({});
    const [bestRacesCount, setBestRacesCount] = useState<number>(5);
    
    const [viewMode, setViewMode] = useState<'race' | 'standings'>(initialView);
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
        if (cycleTime <= 0) return;

        const interval = setInterval(() => {
            setViewMode(prev => prev === 'race' ? 'standings' : 'race');
            // Reset scroll on switch
            if (containerRef.current) containerRef.current.scrollTop = 0;
        }, cycleTime * 1000);

        return () => clearInterval(interval);
    }, [cycleTime]);

    // 4. Auto-scroll effect
    useEffect(() => {
        if (!autoScroll || !containerRef.current) return;

        const scrollContainer = containerRef.current;
        let scrollPos = 0;
        let direction = 1; // 1 = down, -1 = up
        const speed = 1; // px per tick

        const interval = setInterval(() => {
            // Only scroll if content overflows
            if (scrollContainer.scrollHeight <= scrollContainer.clientHeight) return;

            scrollPos += speed * direction;
            
            if (scrollPos >= (scrollContainer.scrollHeight - scrollContainer.clientHeight)) {
                direction = -1;
                scrollPos = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            } else if (scrollPos <= 0) {
                direction = 1;
                scrollPos = 0;
            }

            scrollContainer.scrollTop = scrollPos;
        }, 50);

        return () => clearInterval(interval);
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
        
        // 2. Determine the correct "Source Sprints" config to use for resolving names/order
        let sourceSprints: Sprint[] = [];
        
        if (race.eventMode === 'multi' && race.eventConfiguration) {
            // Find config for current category
            const catConfig = race.eventConfiguration.find(c => c.customCategory === category);
            // Use per-category sprints if available
            if (catConfig && catConfig.sprints && catConfig.sprints.length > 0) {
                sourceSprints = catConfig.sprints;
            } else {
                 // Fallback to global if not found
                 sourceSprints = race.sprints || [];
            }
        } else {
            // Single Mode
            sourceSprints = race.sprints || race.sprintData || [];
        }

        // Last Sprint Key Logic
        let lastSprintKey: string | null = null;
        
        if (showLastSprint && sourceSprints.length > 0 && allSprintKeys.size > 0) {
            // iterate backwards through configured sprints to find the last one that has data
            for (let i = sourceSprints.length - 1; i >= 0; i--) {
                const s = sourceSprints[i];
                const possibleKeys = [s.key, `${s.id}_${s.count}`, `${s.id}`];
                const foundKey = possibleKeys.find(k => allSprintKeys.has(k));
                if (foundKey) {
                    lastSprintKey = foundKey;
                    break;
                }
            }
        }

        // Helper to get header name
        const getSprintHeader = (key: string) => {
             // Try to find in sourceSprints first (most specific)
             const sprint = sourceSprints.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
             if (sprint) return `${sprint.name} #${sprint.count}`;
             
             // Fallback to global search if not found (safety)
             if (race.sprints) {
                 const globalSprint = race.sprints.find(s => s.key === key || `${s.id}_${s.count}` === key || s.id === key);
                 if (globalSprint) return `${globalSprint.name} #${globalSprint.count}`;
             }
             
             return key;
        };

        const displayResults = results.slice(0, limit);

        return (
            <table className="w-full text-left border-collapse table-fixed">
                <thead>
                    <tr className="text-slate-400 text-lg uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80">
                        <th className="py-1 px-2 w-[10%] text-center">#</th>
                        <th className="py-1 px-2 w-[55%]">Rider</th>
                        <th className={`py-1 px-2 w-[35%] text-right font-bold break-words text-blue-400`}>
                            {lastSprintKey ? getSprintHeader(lastSprintKey) : 'Pts'}
                        </th>
                    </tr>
                </thead>
                <tbody className="text-white font-bold text-3xl">
                    {displayResults.map((rider, idx) => (
                        <tr 
                            key={rider.zwiftId} 
                            className="border-b border-slate-700/50 even:bg-slate-800/40"
                        >
                            <td className="py-2 px-2 text-center font-bold text-slate-300">
                                {idx + 1}
                            </td>
                            <td className="py-2 px-2 truncate">
                                {rider.name}
                            </td>
                            <td className={`py-2 px-2 text-right font-extrabold text-blue-400`}>
                                {lastSprintKey 
                                    ? (rider.sprintDetails?.[lastSprintKey] || '-') 
                                    : rider.totalPoints}
                            </td>
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
                        <th className="py-1 px-2 w-[10%] text-center">#</th>
                        <th className="py-1 px-2 w-[55%]">Rider</th>
                        <th className="py-1 px-2 w-[35%] text-right font-bold text-green-400">
                            Points
                        </th>
                    </tr>
                </thead>
                <tbody className="text-white font-bold text-3xl">
                    {displayResults.map((rider, idx) => (
                        <tr 
                            key={rider.zwiftId} 
                            className="border-b border-slate-700/50 even:bg-slate-800/40"
                        >
                            <td className="py-2 px-2 text-center font-bold text-slate-300">
                                {idx === 0 ? '🥇' : idx === 1 ? '🥈' : idx === 2 ? '🥉' : idx + 1}
                            </td>
                            <td className="py-2 px-2 truncate">
                                {rider.name}
                            </td>
                            <td className="py-2 px-2 text-right font-extrabold text-green-400">
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
                    <div className="bg-slate-900/90 text-center py-2 border-b border-slate-700">
                        <h2 className="text-xl font-bold text-white uppercase tracking-widest">
                            {viewMode === 'standings' ? `League Standings • ${category}` : `Race Results • ${category}`}
                        </h2>
                    </div>

                    {viewMode === 'race' ? renderRaceResults() : renderStandings()}
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
