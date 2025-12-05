'use client';

import { useEffect, useState, useRef } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { useParams, useSearchParams } from 'next/navigation';

// Types (Simplified for display)
interface Race {
    name: string;
    results?: Record<string, ResultEntry[]>;
    sprints?: Sprint[];
    // We might add 'status' or 'laps' later
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

export default function LiveResultsPage() {
    const params = useParams();
    const searchParams = useSearchParams();
    const raceId = params?.raceId as string;

    // Configuration from URL
    const category = searchParams.get('cat') || 'A';
    const isTransparent = searchParams.get('transparent') !== 'false'; // Default true
    const limit = parseInt(searchParams.get('limit') || '10'); // Default 10
    const autoScroll = searchParams.get('scroll') === 'true';
    const showSprints = searchParams.get('sprints') !== 'false'; // Default true

    const [race, setRace] = useState<Race | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Scrolling ref
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (!raceId) return;

        const setupSubscription = async () => {
            let docRef;
            
            // Query for the race doc with this eventId
            try {
                // Note: raceId is a string from the URL, and eventId is likely stored as a string in Firestore.
                const q = query(collection(db, 'races'), where('eventId', '==', raceId));
                const snapshot = await getDocs(q);
                
                if (!snapshot.empty) {
                    // Use the first matching document's ID
                    docRef = doc(db, 'races', snapshot.docs[0].id);
                } else {
                    setError(`No race found with Event ID: ${raceId}`);
                    setLoading(false);
                    return;
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

        // Handle the async setup
        let unsubscribeFn: (() => void) | undefined;
        setupSubscription().then(unsub => {
            unsubscribeFn = unsub;
        });

        return () => {
            if (unsubscribeFn) unsubscribeFn();
        };
    }, [raceId]);

    // Auto-scroll effect
    useEffect(() => {
        if (!autoScroll || !containerRef.current) return;

        const scrollContainer = containerRef.current;
        let scrollPos = 0;
        let direction = 1; // 1 = down, -1 = up
        const speed = 1; // px per tick

        const interval = setInterval(() => {
            if (scrollContainer.scrollHeight <= scrollContainer.clientHeight) return;

            scrollPos += speed * direction;
            
            // Check bounds
            if (scrollPos >= (scrollContainer.scrollHeight - scrollContainer.clientHeight)) {
                // Pause at bottom then reverse? Or just jump to top? 
                // OBS standard is usually loop or bounce. Let's bounce.
                direction = -1;
                scrollPos = scrollContainer.scrollHeight - scrollContainer.clientHeight;
            } else if (scrollPos <= 0) {
                direction = 1;
                scrollPos = 0;
            }

            scrollContainer.scrollTop = scrollPos;
        }, 50);

        return () => clearInterval(interval);
    }, [autoScroll, race]); // Re-run when data updates (height changes)

    if (loading) return <div className="p-8 text-white font-bold text-2xl">Loading Live Data...</div>;
    if (error) return <div className="p-8 text-red-500 font-bold text-2xl">{error}</div>;
    if (!race) return null;

    // Filter Results
    const results = race.results?.[category] || [];
    const displayResults = results.slice(0, limit);

    // Determine Sprint Columns
    const allSprintKeys = new Set<string>();
    if (showSprints) {
        displayResults.forEach(r => {
            if (r.sprintDetails) {
                Object.keys(r.sprintDetails).forEach(k => allSprintKeys.add(k));
            }
        });
    }
    const sprintColumns = Array.from(allSprintKeys).sort();

    const getSprintHeader = (key: string) => {
        if (!race.sprints) return key;
        // Try matching key or ID_COUNT
        const sprint = race.sprints.find(s => s.key === key || `${s.id}_${s.count}` === key);
        if (sprint) return `#${sprint.count}`; // Compact header for OBS
        return key;
    };

    const formatTime = (ms: number) => {
        if (!ms) return '-';
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60); // Keep minutes > 60 if needed
        const seconds = totalSeconds % 60;
        const millis = Math.floor((ms % 1000) / 100); // 1 decimal for millis
        
        const pad = (n: number) => n.toString().padStart(2, '0');
        return `${pad(minutes)}:${pad(seconds)}.${millis}`;
    };

    return (
        // Break out of main layout constraints using fixed positioning
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
                    {/* Table */}
                    <table className="w-full text-left border-collapse table-fixed">
                        <thead>
                            <tr className="text-slate-400 text-lg uppercase tracking-wider border-b-2 border-slate-600 bg-slate-800/80">
                                <th className="py-1 px-2 w-[10%] text-center">#</th>
                                <th className="py-1 px-2 w-[65%]">Rider</th>
                                <th className="py-1 px-2 w-[25%] text-right text-blue-400 font-bold">Pts</th>
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
                                    <td className="py-2 px-2 text-right font-extrabold text-blue-400">
                                        {rider.totalPoints}
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
                </div>
            </div>
            
            {/* OBS Helper Styles */}
            <style jsx global>{`
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
