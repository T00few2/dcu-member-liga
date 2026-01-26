'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

interface Race {
    id: string;
    name: string;
    date: string;
    eventMode?: 'single' | 'multi';
    eventConfiguration?: {
        eventId: string;
        customCategory: string;
    }[];
    singleModeCategories?: {
        category: string;
    }[];
    results?: Record<string, any[]>;
    manualDQs?: string[];
    manualDeclassifications?: string[];
    manualExclusions?: string[];
}

export default function LiveLinksPage() {
    const { user } = useAuth();
    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [allCategories, setAllCategories] = useState<string[]>([]);
    const [processingKey, setProcessingKey] = useState<string | null>(null);
    const [viewingResultsId, setViewingResultsId] = useState<string | null>(null);

    // Configuration State
    const [config, setConfig] = useState({
        limit: 10,
        view: 'race', // 'race' | 'standings'
        cycle: 0,
        transparent: true,
        scroll: false,
        sprints: true,
        lastSprint: false,
        full: false,
        includeBanner: false,
        fitToScreen: false,
        lastSplit: false,
        showCheckboxes: false, // Helper to toggle advanced options visibility
        // Calculation Settings
        source: 'joined', // 'finishers' | 'joined' | 'signed_up'
        filterRegistered: false
    });

    useEffect(() => {
        const fetchRaces = async () => {
            try {
                // Fetch all races
                const racesRef = collection(db, 'races');
                // Try to order by date if index exists, otherwise client sort
                const q = query(racesRef); 
                const snapshot = await getDocs(q);
                
                const fetchedRaces = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as Race[];

                // Sort by date ascending (oldest first - matching league setup usually)
                fetchedRaces.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

                setRaces(fetchedRaces);

                // Extract all unique categories
                const categories = new Set<string>();
                fetchedRaces.forEach(race => {
                    // Check multi-mode configuration
                    if (race.eventConfiguration && race.eventConfiguration.length > 0) {
                        race.eventConfiguration.forEach(c => {
                            if (c.customCategory) categories.add(c.customCategory);
                        });
                    }
                    // Check single-mode category configuration
                    if (race.singleModeCategories && race.singleModeCategories.length > 0) {
                        race.singleModeCategories.forEach(c => {
                            if (c.category) categories.add(c.category);
                        });
                    }
                    // Check results
                    if (race.results) {
                        Object.keys(race.results).forEach(c => categories.add(c));
                    }
                });

                // Default if empty
                if (categories.size === 0) {
                    ['A', 'B', 'C', 'D', 'E'].forEach(c => categories.add(c));
                }

                // Sort categories based on the most recent configuration
                const availableCategories = Array.from(categories);
                
                // Find a reference race (prefer the latest one with multi-mode config OR single-mode with categories)
                // We clone fetchedRaces because reverse() mutates in place
                const referenceRaceMulti = [...fetchedRaces].reverse().find(r => r.eventMode === 'multi' && r.eventConfiguration && r.eventConfiguration.length > 0);
                const referenceRaceSingle = [...fetchedRaces].reverse().find(r => r.singleModeCategories && r.singleModeCategories.length > 0);
  
                if (referenceRaceMulti && referenceRaceMulti.eventConfiguration) {
                    const orderMap = new Map();
                    referenceRaceMulti.eventConfiguration.forEach((cfg, idx) => {
                        if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
                    });
                    
                    availableCategories.sort((a, b) => {
                        const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
                        const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
                        if (idxA === idxB) return a.localeCompare(b);
                        return idxA - idxB;
                    });
                } else if (referenceRaceSingle && referenceRaceSingle.singleModeCategories) {
                    const orderMap = new Map();
                    referenceRaceSingle.singleModeCategories.forEach((cfg, idx) => {
                        if (cfg.category) orderMap.set(cfg.category, idx);
                    });
                    
                    availableCategories.sort((a, b) => {
                        const idxA = orderMap.has(a) ? orderMap.get(a) : 999;
                        const idxB = orderMap.has(b) ? orderMap.get(b) : 999;
                        if (idxA === idxB) return a.localeCompare(b);
                        return idxA - idxB;
                    });
                } else {
                    availableCategories.sort();
                }

                setAllCategories(availableCategories);

            } catch (error) {
                console.error("Error fetching races:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchRaces();
    }, []);

    const updateConfig = (field: string, value: any) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    };

    const generateUrl = (raceId: string, category: string) => {
        const baseUrl = `/live/${raceId}`;
        const params = new URLSearchParams();
        
        params.set('cat', category);
        if (config.limit !== 10) params.set('limit', config.limit.toString());
        if (config.view !== 'race') params.set('view', config.view);
        if (config.cycle > 0) params.set('cycle', config.cycle.toString());
        if (!config.transparent) params.set('transparent', 'false');
        if (config.scroll) params.set('scroll', 'true');
        if (!config.sprints) params.set('sprints', 'false');
        if (config.lastSprint) params.set('lastSprint', 'true');
        if (config.full) params.set('full', 'true');
        if (!config.includeBanner) params.set('banner', 'false');
        if (config.fitToScreen) params.set('fit', 'true');
        if (config.lastSplit) params.set('lastSplit', 'true');

        return `${baseUrl}?${params.toString()}`;
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(window.location.origin + text);
        // Could add toast here
    };

    const handleRefresh = async (raceId: string, category: string = 'All') => {
        if (!user) {
            alert('Please log in to calculate results.');
            return;
        }
        
        const key = `${raceId}-${category}`;
        setProcessingKey(key);

        try {
            const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';
            const token = await user.getIdToken();
            
            const res = await fetch(`${apiUrl}/races/${raceId}/results/refresh`, {
                method: 'POST',
                headers: { 
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ 
                    source: config.source,
                    filterRegistered: config.filterRegistered,
                    categoryFilter: category
                })
            });
            
            if (!res.ok) {
                const data = await res.json();
                alert(`Failed: ${data.message}`);
            }
        } catch (e) {
            console.error(e);
            alert('Error updating results');
        } finally {
            setProcessingKey(null);
        }
    };

    const updateRaceFlagsLocally = (raceId: string, updater: (race: Race) => Race) => {
        setRaces(prev => prev.map(r => (r.id === raceId ? updater(r) : r)));
    };

    const toggleValue = (values: string[] | undefined, zwiftId: string, isCurrentlySet: boolean) => {
        const list = values ? [...values] : [];
        if (isCurrentlySet) {
            return list.filter(v => v !== zwiftId);
        }
        if (!list.includes(zwiftId)) {
            list.push(zwiftId);
        }
        return list;
    };

    const handleToggleDQ = async (raceId: string, zwiftId: string, isCurrentlyDQ: boolean) => {
        if (!user) {
            alert('Please log in to update results.');
            return;
        }
        try {
            const raceRef = doc(db, 'races', raceId);
            if (isCurrentlyDQ) {
                await updateDoc(raceRef, {
                    manualDQs: arrayRemove(zwiftId)
                });
            } else {
                await updateDoc(raceRef, {
                    manualDQs: arrayUnion(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                    manualExclusions: arrayRemove(zwiftId)
                });
            }
            updateRaceFlagsLocally(raceId, (race) => ({
                ...race,
                manualDQs: toggleValue(race.manualDQs, zwiftId, isCurrentlyDQ),
                manualDeclassifications: toggleValue(race.manualDeclassifications, zwiftId, true),
                manualExclusions: toggleValue(race.manualExclusions, zwiftId, true)
            }));
        } catch (e) {
            console.error("Error updating DQ status:", e);
            alert("Failed to update DQ status");
        }
    };

    const handleToggleDeclass = async (raceId: string, zwiftId: string, isCurrentlyDeclass: boolean) => {
        if (!user) {
            alert('Please log in to update results.');
            return;
        }
        try {
            const raceRef = doc(db, 'races', raceId);
            if (isCurrentlyDeclass) {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayRemove(zwiftId)
                });
            } else {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                    manualExclusions: arrayRemove(zwiftId)
                });
            }
            updateRaceFlagsLocally(raceId, (race) => ({
                ...race,
                manualDeclassifications: toggleValue(race.manualDeclassifications, zwiftId, isCurrentlyDeclass),
                manualDQs: toggleValue(race.manualDQs, zwiftId, true),
                manualExclusions: toggleValue(race.manualExclusions, zwiftId, true)
            }));
        } catch (e) {
            console.error("Error updating Declass status:", e);
            alert("Failed to update Declass status");
        }
    };

    const handleToggleExclude = async (raceId: string, zwiftId: string, isCurrentlyExcluded: boolean) => {
        if (!user) {
            alert('Please log in to update results.');
            return;
        }
        try {
            const raceRef = doc(db, 'races', raceId);
            if (isCurrentlyExcluded) {
                await updateDoc(raceRef, {
                    manualExclusions: arrayRemove(zwiftId)
                });
            } else {
                await updateDoc(raceRef, {
                    manualExclusions: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId)
                });
            }
            updateRaceFlagsLocally(raceId, (race) => ({
                ...race,
                manualExclusions: toggleValue(race.manualExclusions, zwiftId, isCurrentlyExcluded),
                manualDQs: toggleValue(race.manualDQs, zwiftId, true),
                manualDeclassifications: toggleValue(race.manualDeclassifications, zwiftId, true)
            }));
        } catch (e) {
            console.error("Error updating exclusion status:", e);
            alert("Failed to update exclusion status");
        }
    };

    if (loading) return <div className="p-8 text-white">Loading races...</div>;

    return (
        <div className="min-h-screen bg-slate-900 text-slate-100 p-8 font-sans">
            <h1 className="text-3xl font-bold mb-8 text-blue-400">Live Dashboard Generator</h1>

            {/* Configuration Panel */}
            <div className="bg-slate-800 p-6 rounded-lg border border-slate-700 mb-8">
                <h2 className="text-xl font-semibold mb-4 text-slate-200 border-b border-slate-700 pb-2">Configuration</h2>
                
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                    {/* Core Settings */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Row Limit</label>
                            <input 
                                type="number" 
                                value={config.limit}
                                onChange={(e) => updateConfig('limit', parseInt(e.target.value) || 10)}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Default View</label>
                            <select 
                                value={config.view}
                                onChange={(e) => updateConfig('view', e.target.value)}
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="race">Race Results</option>
                                <option value="standings">League Standings</option>
                                <option value="time-trial">Time Trail</option>
                            </select>
                        </div>
                    </div>

                    {/* Cycle & Display */}
                    <div className="space-y-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">Cycle Time (seconds)</label>
                            <input 
                                type="number" 
                                value={config.cycle}
                                onChange={(e) => updateConfig('cycle', parseInt(e.target.value) || 0)}
                                placeholder="0 to disable"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                            <p className="text-xs text-slate-500 mt-1">Cycles view between Race Results and League Standings. Set to 0 to disable.</p>
                        </div>
                    </div>

                    {/* Toggles */}
                    <div className="space-y-3">
                         <label className="flex items-center space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={config.transparent}
                                onChange={(e) => updateConfig('transparent', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Transparent Background</span>
                        </label>
                        
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={config.scroll}
                                onChange={(e) => updateConfig('scroll', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Auto-Scroll</span>
                        </label>
                    </div>

                     <div className="space-y-3">
                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={config.full}
                                onChange={(e) => updateConfig('full', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Full-Screen Layout</span>
                        </label>
                        {config.full && (
                            <>
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.includeBanner}
                                        onChange={(e) => updateConfig('includeBanner', e.target.checked)}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-slate-300">Include Banner (Full-Screen)</span>
                                </label>
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.fitToScreen}
                                        onChange={(e) => updateConfig('fitToScreen', e.target.checked)}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-slate-300">Fit All Riders to Screen</span>
                                </label>
                            </>
                        )}

                        {config.view === 'race' && (
                            <>
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.sprints}
                                        onChange={(e) => updateConfig('sprints', e.target.checked)}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-slate-300">Show Sprints (Sprint Races)</span>
                                </label>

                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.lastSprint}
                                        onChange={(e) => updateConfig('lastSprint', e.target.checked)}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-slate-300">Show Only Last Sprint (Sprint Races)</span>
                                </label>
                            </>
                        )}
                        
                        {config.view === 'time-trial' && (
                            <label className="flex items-center space-x-3 cursor-pointer">
                                <input 
                                    type="checkbox" 
                                    checked={config.lastSplit}
                                    onChange={(e) => updateConfig('lastSplit', e.target.checked)}
                                    className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                />
                                <span className="text-slate-300">Show Only Last Split (Time Trail)</span>
                            </label>
                        )}
                    </div>
                </div>

                {/* Calculation Settings Panel (Authenticated Only) */}
                {user && (
                    <div className="mt-6 pt-6 border-t border-slate-700">
                        <h3 className="text-sm font-semibold uppercase text-slate-400 mb-4 tracking-wider">Calculation Settings (For "Calc" Buttons)</h3>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl">
                            <div>
                                <label className="block text-sm font-medium text-slate-400 mb-1">Source Data</label>
                                <select 
                                    value={config.source}
                                    onChange={(e) => updateConfig('source', e.target.value)}
                                    className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                                >
                                    <option value="finishers">Finishers (Final Results)</option>
                                    <option value="joined">Joined (Currently in Pen/Race)</option>
                                    <option value="signed_up">Signed Up (Registration List)</option>
                                </select>
                            </div>
                             <div className="flex items-end pb-2">
                                <label className="flex items-center space-x-3 cursor-pointer">
                                    <input 
                                        type="checkbox" 
                                        checked={config.filterRegistered}
                                        onChange={(e) => updateConfig('filterRegistered', e.target.checked)}
                                        className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                    />
                                    <span className="text-slate-300">Filter Registered (Show Only Registered)</span>
                                </label>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-700 shadow-xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-800 text-slate-400 uppercase tracking-wider text-sm">
                            <th className="p-4 border-b border-slate-700 sticky left-0 bg-slate-800 z-10 w-64 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">Race</th>
                            {allCategories.map(cat => (
                                <th key={cat} className="p-4 border-b border-slate-700 text-center min-w-[100px]">{cat}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="bg-slate-900/50">
                        {races.map((race) => {
                            // Determine which categories are valid for this race
                            const raceCats = new Set<string>();
                            if (race.eventConfiguration && race.eventConfiguration.length > 0) {
                                race.eventConfiguration.forEach(c => c.customCategory && raceCats.add(c.customCategory));
                            }
                            if (race.singleModeCategories && race.singleModeCategories.length > 0) {
                                race.singleModeCategories.forEach(c => c.category && raceCats.add(c.category));
                            }
                            if (race.results) {
                                Object.keys(race.results).forEach(c => raceCats.add(c));
                            }
                            // Default fallback only if no configuration or results
                            if (raceCats.size === 0) {
                                ['A', 'B', 'C', 'D', 'E'].forEach(c => raceCats.add(c));
                            }

                            return (
                                <tr key={race.id} className="hover:bg-slate-800/50 transition-colors border-b border-slate-800 last:border-0">
                                    <td className="p-4 border-r border-slate-800 sticky left-0 bg-slate-900 z-10 font-medium text-slate-200 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                                        <div className="truncate w-64" title={race.name}>
                                            {race.name}
                                        </div>
                                        <div className="text-xs text-slate-500 mt-1">
                                            {new Date(race.date).toLocaleDateString()}
                                        </div>
                                        {user && (
                                            <div className="mt-2 flex items-center gap-2">
                                                <button 
                                                    onClick={() => handleRefresh(race.id, 'All')}
                                                    disabled={!!processingKey}
                                                    className={`px-2 py-1 text-[10px] uppercase font-bold rounded border transition-colors ${
                                                        processingKey === `${race.id}-All` 
                                                            ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-not-allowed' 
                                                            : 'bg-slate-800 text-green-500 border-green-900/50 hover:bg-green-900/20 hover:border-green-800'
                                                    }`}
                                                >
                                                    {processingKey === `${race.id}-All` ? 'Calc...' : 'Calc All'}
                                                </button>
                                                <button
                                                    onClick={() => setViewingResultsId(race.id)}
                                                    className="px-2 py-1 text-[10px] uppercase font-bold rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"
                                                >
                                                    View
                                                </button>
                                            </div>
                                        )}
                                    </td>
                                    {allCategories.map(cat => {
                                        const isAvailable = raceCats.has(cat);
                                        const url = generateUrl(race.id, cat);
                                        
                                        return (
                                            <td key={cat} className="p-3 text-center border-r border-slate-800/50 last:border-0">
                                                {isAvailable ? (
                                                    <div className="flex flex-col gap-2 items-center">
                                                        <Link 
                                                            href={url} 
                                                            target="_blank"
                                                            className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded transition-colors"
                                                        >
                                                            Open
                                                        </Link>
                                                        <button
                                                            onClick={() => copyToClipboard(url)}
                                                            className="text-[10px] text-slate-500 hover:text-slate-300 uppercase tracking-wide"
                                                        >
                                                            Copy Link
                                                        </button>
                                                        {user && (
                                                            <button 
                                                                onClick={() => handleRefresh(race.id, cat)}
                                                                disabled={!!processingKey}
                                                                className={`text-[10px] font-bold uppercase tracking-wide transition-colors ${
                                                                    processingKey === `${race.id}-${cat}` 
                                                                        ? 'text-slate-600 cursor-wait' 
                                                                        : 'text-green-600 hover:text-green-400'
                                                                }`}
                                                            >
                                                                {processingKey === `${race.id}-${cat}` ? '...' : 'Calc'}
                                                            </button>
                                                        )}
                                                    </div>
                                                ) : (
                                                    <span className="text-slate-700 text-xl">·</span>
                                                )}
                                            </td>
                                        );
                                    })}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            
            <div className="mt-8 text-slate-500 text-sm text-center">
                Click "Open" to view the live board in a new tab, or "Copy Link" to paste into OBS/Streaming software.
            </div>

            {/* Results Modal */}
            {viewingResultsId && (() => {
                const race = races.find(r => r.id === viewingResultsId);
                const results = race?.results || {};
                const categories = Object.keys(results).sort();

                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-slate-900 w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-slate-700 flex flex-col">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                                <div className="flex items-center gap-4">
                                    <h3 className="text-lg font-bold text-slate-100">
                                        Results: {race?.name || viewingResultsId}
                                    </h3>
                                    <button 
                                        onClick={() => race && handleRefresh(race.id, 'All')}
                                        disabled={!!processingKey}
                                        className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:bg-blue-500 font-medium"
                                    >
                                        {processingKey === `${race?.id}-All` ? 'Calculating...' : 'Recalculate Results'}
                                    </button>
                                </div>
                                <button 
                                    onClick={() => setViewingResultsId(null)}
                                    className="text-slate-400 hover:text-slate-100 p-1"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="overflow-y-auto p-4 space-y-6">
                                {(race?.manualExclusions || []).length > 0 && (
                                    <div className="border border-slate-700 rounded-lg p-3 bg-slate-800/40 text-xs">
                                        <div className="font-semibold text-slate-400 mb-2">Excluded Riders</div>
                                        <div className="flex flex-wrap gap-2">
                                            {(race?.manualExclusions || []).map((zid: string) => (
                                                <button
                                                    key={zid}
                                                    onClick={() => race && handleToggleExclude(race.id, zid, true)}
                                                    className="px-2 py-1 rounded border border-slate-700 bg-slate-900 hover:bg-slate-800 text-slate-400"
                                                    title="Remove exclusion"
                                                >
                                                    {zid} ×
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                {categories.length === 0 ? (
                                    <div className="text-center text-slate-400 p-8">No results calculated yet.</div>
                                ) : (
                                    categories.map(cat => (
                                        <div key={cat} className="border border-slate-700 rounded-lg overflow-hidden">
                                            <div className="bg-slate-800 px-4 py-2 font-semibold text-sm border-b border-slate-700">
                                                {cat}
                                            </div>
                                            <table className="w-full text-left text-sm">
                                                <thead className="bg-slate-800/50 text-xs text-slate-400">
                                                    <tr>
                                                        <th className="px-4 py-2 w-12">Pos</th>
                                                        <th className="px-4 py-2">Rider</th>
                                                        <th className="px-4 py-2 text-right">Time</th>
                                                        <th className="px-4 py-2 text-right">Pts</th>
                                                        <th className="px-4 py-2 text-center w-12" title="Disqualify (0 pts)">DQ</th>
                                                        <th className="px-4 py-2 text-center w-12" title="Declassify (Last place pts)">DC</th>
                                                        <th className="px-4 py-2 text-center w-12" title="Exclude from results">EX</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-slate-800">
                                                    {results[cat].map((rider: any, idx: number) => {
                                                        const isManualDQ = (race?.manualDQs || []).includes(rider.zwiftId);
                                                        const isManualDeclass = (race?.manualDeclassifications || []).includes(rider.zwiftId);
                                                        const isManualExcluded = (race?.manualExclusions || []).includes(rider.zwiftId);

                                                        return (
                                                            <tr key={rider.zwiftId} className={`hover:bg-slate-800/50 ${isManualExcluded ? 'bg-slate-800/30' : isManualDQ ? 'bg-red-950/30' : isManualDeclass ? 'bg-yellow-950/20' : ''}`}>
                                                                <td className="px-4 py-2 text-slate-400">{isManualExcluded ? '×' : isManualDQ ? '-' : isManualDeclass ? '*' : idx + 1}</td>
                                                                <td className="px-4 py-2 font-medium">
                                                                    {rider.name}
                                                                    {isManualExcluded && (
                                                                        <div className="text-[10px] text-slate-400 font-bold mt-0.5">
                                                                            EXCLUDED
                                                                        </div>
                                                                    )}
                                                                    {isManualDQ && (
                                                                        <div className="text-[10px] text-red-500 font-bold mt-0.5">
                                                                            DISQUALIFIED
                                                                        </div>
                                                                    )}
                                                                    {isManualDeclass && (
                                                                        <div className="text-[10px] text-yellow-500 font-bold mt-0.5">
                                                                            DECLASSIFIED
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-4 py-2 text-right font-mono text-slate-400">
                                                                    {rider.finishTime > 0 ? new Date(rider.finishTime).toISOString().substr(11, 8) : '-'}
                                                                </td>
                                                                <td className="px-4 py-2 text-right font-bold text-blue-400">
                                                                    {rider.totalPoints}
                                                                    {(isManualExcluded || (isManualDQ && rider.totalPoints > 0) || (isManualDeclass && rider.totalPoints === 0)) ? (
                                                                        <span className="text-[10px] text-red-500 block" title="Recalculation needed">
                                                                            (Recalc)
                                                                        </span>
                                                                    ) : null}
                                                                </td>
                                                                <td className="px-4 py-2 text-center">
                                                                    <input 
                                                                        type="checkbox"
                                                                        checked={isManualDQ}
                                                                        onChange={() => race && handleToggleDQ(race.id, rider.zwiftId, isManualDQ)}
                                                                        disabled={isManualDeclass || isManualExcluded}
                                                                        title={isManualExcluded ? "Excluded from results" : isManualDeclass ? "Uncheck Declassify first" : "Disqualify"}
                                                                        className="w-4 h-4 rounded border-slate-700 text-blue-500 focus:ring-blue-500 cursor-pointer disabled:opacity-30"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-2 text-center">
                                                                    <input 
                                                                        type="checkbox"
                                                                        checked={isManualDeclass}
                                                                        onChange={() => race && handleToggleDeclass(race.id, rider.zwiftId, isManualDeclass)}
                                                                        disabled={isManualDQ || isManualExcluded}
                                                                        title={isManualExcluded ? "Excluded from results" : isManualDQ ? "Uncheck DQ first" : "Declassify"}
                                                                        className="w-4 h-4 rounded border-slate-700 text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30"
                                                                    />
                                                                </td>
                                                                <td className="px-4 py-2 text-center">
                                                                    <input 
                                                                        type="checkbox"
                                                                        checked={isManualExcluded}
                                                                        onChange={() => race && handleToggleExclude(race.id, rider.zwiftId, isManualExcluded)}
                                                                        title={isManualExcluded ? "Include in results" : "Exclude from results"}
                                                                        className="w-4 h-4 rounded border-slate-700 text-slate-400 focus:ring-slate-500 cursor-pointer"
                                                                    />
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
