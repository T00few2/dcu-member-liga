'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, orderBy } from 'firebase/firestore';
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
    results?: Record<string, any[]>;
}

export default function LiveLinksPage() {
    const { user } = useAuth();
    const [races, setRaces] = useState<Race[]>([]);
    const [loading, setLoading] = useState(true);
    const [allCategories, setAllCategories] = useState<string[]>([]);
    const [processingKey, setProcessingKey] = useState<string | null>(null);

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
                    // Check configuration
                    if (race.eventConfiguration && race.eventConfiguration.length > 0) {
                        race.eventConfiguration.forEach(c => {
                            if (c.customCategory) categories.add(c.customCategory);
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
                
                // Find a reference race (prefer the latest one with multi-mode config)
                // We clone fetchedRaces because reverse() mutates in place
                const referenceRace = [...fetchedRaces].reverse().find(r => r.eventMode === 'multi' && r.eventConfiguration && r.eventConfiguration.length > 0);
  
                if (referenceRace && referenceRace.eventConfiguration) {
                    const orderMap = new Map();
                    referenceRace.eventConfiguration.forEach((cfg, idx) => {
                        if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
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

                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={config.includeBanner}
                                onChange={(e) => updateConfig('includeBanner', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Include Banner</span>
                        </label>

                        <label className="flex items-center space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={config.sprints}
                                onChange={(e) => updateConfig('sprints', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Show Sprints</span>
                        </label>

                         <label className="flex items-center space-x-3 cursor-pointer">
                            <input 
                                type="checkbox" 
                                checked={config.lastSprint}
                                onChange={(e) => updateConfig('lastSprint', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Show Only Last Sprint</span>
                        </label>
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
                            if (race.eventConfiguration) {
                                race.eventConfiguration.forEach(c => c.customCategory && raceCats.add(c.customCategory));
                            }
                            if (race.results) {
                                Object.keys(race.results).forEach(c => raceCats.add(c));
                            }
                            // Default fallback
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
                                            <button 
                                                onClick={() => handleRefresh(race.id, 'All')}
                                                disabled={!!processingKey}
                                                className={`mt-2 px-2 py-1 text-[10px] uppercase font-bold rounded border transition-colors ${
                                                    processingKey === `${race.id}-All` 
                                                        ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-not-allowed' 
                                                        : 'bg-slate-800 text-green-500 border-green-900/50 hover:bg-green-900/20 hover:border-green-800'
                                                }`}
                                            >
                                                {processingKey === `${race.id}-All` ? 'Calc...' : 'Calc All'}
                                            </button>
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
        </div>
    );
}
