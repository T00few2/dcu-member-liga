'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, query, doc, updateDoc, arrayUnion, arrayRemove, getDoc, setDoc } from 'firebase/firestore';
import Link from 'next/link';
import { useAuth } from '@/lib/auth-context';

interface Race {
    id: string;
    name: string;
    date: string;
    type?: 'scratch' | 'points' | 'time-trial';
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
    const [viewingCategory, setViewingCategory] = useState<string | null>(null);
    const [processingCategory, setProcessingCategory] = useState<string | null>(null);
    const [savedSchemes, setSavedSchemes] = useState<Array<{
        name: string;
        overlayText: string;
        overlayMuted: string;
        overlayAccent: string;
        overlayPositive: string;
        overlayHeaderText: string;
        overlayHeaderBg: string;
        overlayRowText: string;
        overlayRowBg: string;
        overlayRowAltBg: string;
        overlayBorder: string;
        overlayBackground: string;
    }>>([]);
    const [schemeName, setSchemeName] = useState('');

    // Configuration State
    const [config, setConfig] = useState({
        limit: 10,
        cycle: 0,
        transparent: true,
        scroll: false,
        sprints: true,
        lastSprint: false,
        full: false,
        includeBanner: true,
        fitToScreen: true,
        lastSplit: false,
        showCheckboxes: false, // Helper to toggle advanced options visibility
        // Overlay color options (non-full view)
        overlayText: '',
        overlayMuted: '',
        overlayAccent: '',
        overlayPositive: '',
        overlayHeaderText: '',
        overlayHeaderBg: '',
        overlayRowText: '',
        overlayRowBg: '',
        overlayRowAltBg: '',
        overlayBorder: '',
        overlayBackground: '',
        // Calculation Settings
        source: 'joined', // 'finishers' | 'joined' | 'signed_up'
        filterRegistered: false,
        nameMax: ''
    });

    const overlayPalettes = [
        {
            name: 'Default Blue',
            overlayText: '',
            overlayMuted: '',
            overlayAccent: '',
            overlayPositive: '',
            overlayHeaderText: '',
            overlayHeaderBg: '',
            overlayRowText: '',
            overlayRowBg: '',
            overlayRowAltBg: '',
            overlayBorder: '',
            overlayBackground: ''
        },
        {
            name: 'High Contrast',
            overlayText: '#f8fafc',
            overlayMuted: '#94a3b8',
            overlayAccent: '#38bdf8',
            overlayPositive: '#4ade80',
            overlayHeaderText: '#ffffff',
            overlayHeaderBg: '#0f172a',
            overlayRowText: '#f8fafc',
            overlayRowBg: 'rgba(15, 23, 42, 0.85)',
            overlayRowAltBg: 'rgba(30, 41, 59, 0.85)',
            overlayBorder: 'rgba(148, 163, 184, 0.35)',
            overlayBackground: '#0b1220'
        },
        {
            name: 'Vivid Purple',
            overlayText: '#f5f3ff',
            overlayMuted: '#c4b5fd',
            overlayAccent: '#a855f7',
            overlayPositive: '#22c55e',
            overlayHeaderText: '#faf5ff',
            overlayHeaderBg: 'rgba(88, 28, 135, 0.9)',
            overlayRowText: '#f5f3ff',
            overlayRowBg: 'rgba(30, 27, 75, 0.7)',
            overlayRowAltBg: 'rgba(49, 46, 129, 0.7)',
            overlayBorder: 'rgba(168, 85, 247, 0.45)',
            overlayBackground: '#0f0b24'
        },
        {
            name: 'Warm Amber',
            overlayText: '#fef3c7',
            overlayMuted: '#f59e0b',
            overlayAccent: '#f97316',
            overlayPositive: '#84cc16',
            overlayHeaderText: '#fffbeb',
            overlayHeaderBg: 'rgba(120, 53, 15, 0.9)',
            overlayRowText: '#fef3c7',
            overlayRowBg: 'rgba(69, 26, 3, 0.7)',
            overlayRowAltBg: 'rgba(92, 33, 6, 0.7)',
            overlayBorder: 'rgba(245, 158, 11, 0.4)',
            overlayBackground: '#1a1209'
        }
    ];

    const applyOverlayPalette = (palette: typeof overlayPalettes[number]) => {
        setConfig(prev => ({
            ...prev,
            overlayText: palette.overlayText,
            overlayMuted: palette.overlayMuted,
            overlayAccent: palette.overlayAccent,
            overlayPositive: palette.overlayPositive,
            overlayHeaderText: palette.overlayHeaderText,
            overlayHeaderBg: palette.overlayHeaderBg,
            overlayRowText: palette.overlayRowText,
            overlayRowBg: palette.overlayRowBg,
            overlayRowAltBg: palette.overlayRowAltBg,
            overlayBorder: palette.overlayBorder,
            overlayBackground: palette.overlayBackground
        }));
    };

    const getOverlaySchemeFromConfig = (name: string) => ({
        name,
        overlayText: config.overlayText,
        overlayMuted: config.overlayMuted,
        overlayAccent: config.overlayAccent,
        overlayPositive: config.overlayPositive,
        overlayHeaderText: config.overlayHeaderText,
        overlayHeaderBg: config.overlayHeaderBg,
        overlayRowText: config.overlayRowText,
        overlayRowBg: config.overlayRowBg,
        overlayRowAltBg: config.overlayRowAltBg,
        overlayBorder: config.overlayBorder,
        overlayBackground: config.overlayBackground
    });

    const saveOverlaySchemes = async (schemes: typeof savedSchemes) => {
        setSavedSchemes(schemes);
        const settingsRef = doc(db, 'league', 'liveOverlay');
        try {
            await setDoc(settingsRef, { schemes }, { merge: true });
        } catch (e) {
            console.error('Failed to save overlay schemes:', e);
            alert('Failed to save color schemes.');
        }
    };

    const handleSaveScheme = () => {
        const name = schemeName.trim();
        if (!name) return;
        const nextScheme = getOverlaySchemeFromConfig(name);
        const existingIdx = savedSchemes.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
        const next = existingIdx >= 0
            ? savedSchemes.map((s, idx) => (idx === existingIdx ? nextScheme : s))
            : [...savedSchemes, nextScheme];
        saveOverlaySchemes(next).then(() => setSchemeName(''));
    };

    const handleDeleteScheme = (name: string) => {
        const next = savedSchemes.filter(s => s.name !== name);
        saveOverlaySchemes(next);
    };

    useEffect(() => {
        const loadSchemes = async () => {
            try {
                const settingsRef = doc(db, 'league', 'liveOverlay');
                const snap = await getDoc(settingsRef);
                const data = snap.exists() ? snap.data() : null;
                if (data?.schemes && Array.isArray(data.schemes)) {
                    setSavedSchemes(data.schemes);
                } else {
                    setSavedSchemes([]);
                }
            } catch (e) {
                console.error('Failed to load overlay schemes:', e);
            }
        };
        loadSchemes();
    }, []);

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

    const generateUrl = (raceId: string, category: string, forceView?: string, forceFull?: boolean) => {
        const baseUrl = `/live/${raceId}`;
        const params = new URLSearchParams();
        
        params.set('cat', category);
        if (config.limit !== 10) params.set('limit', config.limit.toString());
        
        // View Logic
        if (forceView) {
            params.set('view', forceView);
        } else {
            const race = races.find(r => r.id === raceId);
            if (race?.type === 'time-trial') {
                params.set('view', 'time-trial');
            }
        }

        if (config.cycle > 0) params.set('cycle', config.cycle.toString());
        if (!config.transparent) params.set('transparent', 'false');
        if (config.scroll) params.set('scroll', 'true');
        if (!config.sprints) params.set('sprints', 'false');
        if (config.lastSprint) params.set('lastSprint', 'true');
        
        // Full Screen Logic
        if (forceFull) {
            params.set('full', 'true');
        } else if (config.full && forceFull !== false) {
             params.set('full', 'true');
        }

        if (!config.includeBanner) params.set('banner', 'false');
        if (config.fitToScreen) params.set('fit', 'true');
        if (config.lastSplit) params.set('lastSplit', 'true');
        if (config.nameMax.trim()) params.set('nameMax', config.nameMax.trim());
        if (config.overlayText.trim()) params.set('text', config.overlayText.trim());
        if (config.overlayMuted.trim()) params.set('muted', config.overlayMuted.trim());
        if (config.overlayAccent.trim()) params.set('accent', config.overlayAccent.trim());
        if (config.overlayPositive.trim()) params.set('positive', config.overlayPositive.trim());
        if (config.overlayHeaderText.trim()) params.set('headerText', config.overlayHeaderText.trim());
        if (config.overlayHeaderBg.trim()) params.set('headerBg', config.overlayHeaderBg.trim());
        if (config.overlayRowText.trim()) params.set('rowText', config.overlayRowText.trim());
        if (config.overlayRowBg.trim()) params.set('rowBg', config.overlayRowBg.trim());
        if (config.overlayRowAltBg.trim()) params.set('rowAltBg', config.overlayRowAltBg.trim());
        if (config.overlayBorder.trim()) params.set('border', config.overlayBorder.trim());
        if (config.overlayBackground.trim()) params.set('overlayBg', config.overlayBackground.trim());

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

    const handleRefreshCategory = async (category: string) => {
        if (!user) {
            alert('Please log in to calculate results.');
            return;
        }
        
        setProcessingCategory(category);
        
        try {
            const racesToUpdate = races.filter(race => {
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
                if (raceCats.size === 0) {
                    ['A', 'B', 'C', 'D', 'E'].forEach(c => raceCats.add(c));
                }
                return raceCats.has(category);
            });

            for (const race of racesToUpdate) {
                // We use the existing handleRefresh which handles the API call and individual cell state
                // This might be slow for many races but provides good feedback
                await handleRefresh(race.id, category);
            }
        } catch (e) {
            console.error(e);
            alert('Error updating category results');
        } finally {
            setProcessingCategory(null);
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
                            <label className="block text-sm font-medium text-slate-400 mb-1">Name Max Length (optional)</label>
                            <input 
                                type="number" 
                                min={1}
                                value={config.nameMax}
                                onChange={(e) => updateConfig('nameMax', e.target.value)}
                                placeholder="# characters"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
{/* View selection removed - handled per-race type */}
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
                        <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Full Screen Options</div>
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
                                checked={config.fitToScreen}
                                onChange={(e) => updateConfig('fitToScreen', e.target.checked)}
                                className="w-5 h-5 rounded border-slate-600 bg-slate-900 text-blue-500 focus:ring-blue-500"
                            />
                            <span className="text-slate-300">Fit to Screen</span>
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

            {/* Overlay Color Settings (Non-Full View) */}
            <div className="bg-slate-800 rounded-lg border border-slate-700 mb-8">
                <details className="group">
                    <summary className="list-none cursor-pointer select-none px-6 py-4 flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-semibold text-slate-200">Overlay Colors (OBS / Non-Full)</h2>
                            <p className="text-xs text-slate-400 mt-1">
                                Optional. Use any valid CSS color (hex, rgb, hsl, named). Empty = default.
                            </p>
                        </div>
                        <span className="text-xs text-slate-400 group-open:rotate-180 transition-transform">▾</span>
                    </summary>
                    <div className="px-6 pb-6 pt-2 border-t border-slate-700">
                        <div className="flex flex-wrap gap-2 mb-4">
                            {overlayPalettes.map(palette => (
                                <button
                                    key={palette.name}
                                    onClick={() => applyOverlayPalette(palette)}
                                    className="px-3 py-1 text-xs font-semibold rounded border border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white"
                                    type="button"
                                >
                                    {palette.name}
                                </button>
                            ))}
                            {savedSchemes.map(scheme => (
                                <button
                                    key={scheme.name}
                                    onClick={() => applyOverlayPalette(scheme)}
                                    className="relative pl-3 pr-6 py-1 text-xs font-semibold rounded border border-slate-700 text-slate-200 hover:border-slate-500 hover:text-white"
                                    type="button"
                                >
                                    {scheme.name}
                                    <span
                                        className="absolute right-1 top-1 text-[10px] text-slate-400 hover:text-red-300"
                                        title="Delete scheme"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteScheme(scheme.name);
                                        }}
                                    >
                                        ✕
                                    </span>
                                </button>
                            ))}
                            <button
                                onClick={() => applyOverlayPalette(overlayPalettes[0])}
                                className="px-3 py-1 text-xs font-semibold rounded border border-slate-700 text-slate-400 hover:text-white"
                                type="button"
                            >
                                Reset
                            </button>
                        </div>
                        <div className="flex flex-col gap-3 mb-4">
                            <div className="flex flex-wrap items-center gap-2">
                                <input
                                    type="text"
                                    value={schemeName}
                                    onChange={(e) => setSchemeName(e.target.value)}
                                    placeholder="Scheme name"
                                    className="min-w-[220px] bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <button
                                    onClick={handleSaveScheme}
                                    className="px-3 py-2 text-xs font-semibold rounded border border-blue-700 text-blue-200 hover:text-white hover:border-blue-400"
                                    type="button"
                                >
                                    Save Scheme
                                </button>
                            </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Base Text</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayText || '#ffffff'}
                                onChange={(e) => updateConfig('overlayText', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick base text color"
                            />
                            <input
                                type="text"
                                value={config.overlayText}
                                onChange={(e) => updateConfig('overlayText', e.target.value)}
                                placeholder="#ffffff"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Muted Text</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayMuted || '#94a3b8'}
                                onChange={(e) => updateConfig('overlayMuted', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick muted text color"
                            />
                            <input
                                type="text"
                                value={config.overlayMuted}
                                onChange={(e) => updateConfig('overlayMuted', e.target.value)}
                                placeholder="#94a3b8"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Accent</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayAccent || '#60a5fa'}
                                onChange={(e) => updateConfig('overlayAccent', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick accent color"
                            />
                            <input
                                type="text"
                                value={config.overlayAccent}
                                onChange={(e) => updateConfig('overlayAccent', e.target.value)}
                                placeholder="#60a5fa"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Positive</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayPositive || '#4ade80'}
                                onChange={(e) => updateConfig('overlayPositive', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick positive color"
                            />
                            <input
                                type="text"
                                value={config.overlayPositive}
                                onChange={(e) => updateConfig('overlayPositive', e.target.value)}
                                placeholder="#4ade80"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Header Text</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayHeaderText || '#ffffff'}
                                onChange={(e) => updateConfig('overlayHeaderText', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick header text color"
                            />
                            <input
                                type="text"
                                value={config.overlayHeaderText}
                                onChange={(e) => updateConfig('overlayHeaderText', e.target.value)}
                                placeholder="#ffffff"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Header Background</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayHeaderBg || '#0f172a'}
                                onChange={(e) => updateConfig('overlayHeaderBg', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick header background color"
                            />
                            <input
                                type="text"
                                value={config.overlayHeaderBg}
                                onChange={(e) => updateConfig('overlayHeaderBg', e.target.value)}
                                placeholder="rgba(15, 23, 42, 0.9)"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Row Text</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayRowText || '#ffffff'}
                                onChange={(e) => updateConfig('overlayRowText', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick row text color"
                            />
                            <input
                                type="text"
                                value={config.overlayRowText}
                                onChange={(e) => updateConfig('overlayRowText', e.target.value)}
                                placeholder="#ffffff"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Row Background</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayRowBg || '#0f172a'}
                                onChange={(e) => updateConfig('overlayRowBg', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick row background color"
                            />
                            <input
                                type="text"
                                value={config.overlayRowBg}
                                onChange={(e) => updateConfig('overlayRowBg', e.target.value)}
                                placeholder="rgba(15, 23, 42, 0.4)"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Row Alt Background</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayRowAltBg || '#1e293b'}
                                onChange={(e) => updateConfig('overlayRowAltBg', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick alternate row background color"
                            />
                            <input
                                type="text"
                                value={config.overlayRowAltBg}
                                onChange={(e) => updateConfig('overlayRowAltBg', e.target.value)}
                                placeholder="rgba(30, 41, 59, 0.4)"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Border</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayBorder || '#334155'}
                                onChange={(e) => updateConfig('overlayBorder', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick border color"
                            />
                            <input
                                type="text"
                                value={config.overlayBorder}
                                onChange={(e) => updateConfig('overlayBorder', e.target.value)}
                                placeholder="rgba(51, 65, 85, 0.5)"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-400 mb-1">Overlay Background</label>
                        <div className="flex items-center gap-2">
                            <input
                                type="color"
                                value={config.overlayBackground || '#0f172a'}
                                onChange={(e) => updateConfig('overlayBackground', e.target.value)}
                                className="h-9 w-9 p-0 border border-slate-700 rounded bg-slate-900"
                                title="Pick overlay background color"
                            />
                            <input
                                type="text"
                                value={config.overlayBackground}
                                onChange={(e) => updateConfig('overlayBackground', e.target.value)}
                                placeholder="#0f172a"
                                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-white focus:ring-2 focus:ring-blue-500 outline-none"
                            />
                        </div>
                    </div>
                        </div>
                    </div>
                </details>
            </div>

            {/* Matrix Table */}
            <div className="overflow-x-auto rounded-lg border border-slate-700 shadow-xl">
                <table className="w-full text-left border-collapse">
                    <thead>
                        <tr className="bg-slate-800 text-slate-400 uppercase tracking-wider text-sm">
                            <th className="p-4 border-b border-slate-700 sticky left-0 bg-slate-800 z-10 w-64 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">Race</th>
                            {allCategories.map(cat => (
                                <th key={cat} className="p-4 border-b border-slate-700 text-center min-w-[100px]">
                                    <div className="flex flex-col gap-2 items-center">
                                        <span>{cat}</span>
                                        {user && (
                                            <div className="flex gap-1">
                                                <button 
                                                    onClick={() => handleRefreshCategory(cat)}
                                                    disabled={!!processingCategory}
                                                    className={`px-2 py-1 text-[10px] uppercase font-bold rounded border transition-colors ${
                                                        processingCategory === cat 
                                                            ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-not-allowed' 
                                                            : 'bg-slate-800 text-green-500 border-green-900/50 hover:bg-green-900/20 hover:border-green-800'
                                                    }`}
                                                >
                                                    {processingCategory === cat ? '...' : 'Calc All'}
                                                </button>
                                                <button
                                                    onClick={() => setViewingCategory(cat)}
                                                    className="px-2 py-1 text-[10px] uppercase font-bold rounded border border-slate-700 text-slate-300 hover:text-white hover:border-slate-500"
                                                >
                                                    View
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </th>
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
                                    </td>
                                    {allCategories.map(cat => {
                                        const isAvailable = raceCats.has(cat);
                                        const urlOverlay = generateUrl(race.id, cat, undefined, false);
                                        const urlFull = generateUrl(race.id, cat, undefined, true);
                                        
                                        return (
                                            <td key={cat} className="p-3 text-center border-r border-slate-800/50 last:border-0 min-w-[140px]">
                                                {isAvailable ? (
                                                    <div className="flex flex-col gap-2 items-center w-full">
                                                        <div className="grid grid-cols-[1fr_auto] gap-2 w-full">
                                                            <Link 
                                                                href={urlOverlay} 
                                                                target="_blank"
                                                                className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                            >
                                                                Overlay
                                                            </Link>
                                                            <button
                                                                onClick={() => copyToClipboard(urlOverlay)}
                                                                className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                                title="Copy Overlay Link"
                                                            >
                                                                Copy
                                                            </button>
                                                            
                                                            <Link 
                                                                href={urlFull} 
                                                                target="_blank"
                                                                className="px-2 py-1 bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                            >
                                                                Full Screen
                                                            </Link>
                                                            <button
                                                                onClick={() => copyToClipboard(urlFull)}
                                                                className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                                title="Copy Full Screen Link"
                                                            >
                                                                Copy
                                                            </button>
                                                        </div>
                                                        {user && (
                                                            <button 
                                                                onClick={() => handleRefresh(race.id, cat)}
                                                                disabled={!!processingKey}
                                                                className={`w-full px-2 py-1 mt-1 text-[10px] uppercase font-bold rounded border transition-colors flex items-center justify-center ${
                                                                    processingKey === `${race.id}-${cat}` 
                                                                        ? 'bg-slate-700 text-slate-400 border-slate-600 cursor-wait' 
                                                                        : 'bg-green-900/30 border-green-800 text-green-400 hover:bg-green-900/50 hover:text-green-300'
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
                        {/* League Standings Row */}
                        <tr className="border-t-2 border-slate-700 bg-slate-800/80">
                            <td className="p-4 border-r border-slate-800 sticky left-0 bg-slate-800 z-10 font-bold text-slate-100 shadow-[2px_0_5px_-2px_rgba(0,0,0,0.5)]">
                                League Standings
                            </td>
                            {allCategories.map(cat => {
                                const latestRaceId = races.length > 0 ? races[races.length - 1].id : 'no-race';
                                const urlOverlay = generateUrl(latestRaceId, cat, 'standings', false);
                                const urlFull = generateUrl(latestRaceId, cat, 'standings', true);
                                
                                return (
                                    <td key={cat} className="p-3 text-center border-r border-slate-800/50 last:border-0 min-w-[140px]">
                                        {latestRaceId !== 'no-race' ? (
                                            <div className="flex flex-col gap-2 items-center w-full">
                                                <div className="grid grid-cols-[1fr_auto] gap-2 w-full">
                                                    <Link 
                                                        href={urlOverlay} 
                                                        target="_blank"
                                                        className="px-2 py-1 bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                    >
                                                        Overlay
                                                    </Link>
                                                    <button
                                                        onClick={() => copyToClipboard(urlOverlay)}
                                                        className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                        title="Copy Overlay Link"
                                                    >
                                                        Copy
                                                    </button>
                                                    
                                                    <Link 
                                                        href={urlFull} 
                                                        target="_blank"
                                                        className="px-2 py-1 bg-purple-600 hover:bg-purple-500 text-white text-[10px] font-bold rounded transition-colors text-center truncate"
                                                    >
                                                        Full Screen
                                                    </Link>
                                                    <button
                                                        onClick={() => copyToClipboard(urlFull)}
                                                        className="px-2 py-1 bg-slate-800 border border-slate-700 hover:border-slate-500 text-slate-400 hover:text-white text-[10px] font-bold rounded transition-colors"
                                                        title="Copy Full Screen Link"
                                                    >
                                                        Copy
                                                    </button>
                                                </div>
                                            </div>
                                        ) : (
                                            <span className="text-slate-600 text-sm italic">No data</span>
                                        )}
                                    </td>
                                );
                            })}
                        </tr>
                    </tbody>
                </table>
            </div>
            
            <div className="mt-8 text-slate-500 text-sm text-center">
                Click "Open" buttons to view in a new tab, or "Copy" buttons to paste into OBS/Streaming software.
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

            {/* Category Results Modal */}
            {viewingCategory && (() => {
                const relevantRaces = races.filter(r => r.results && r.results[viewingCategory] && r.results[viewingCategory].length > 0);
                
                return (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
                        <div className="bg-slate-900 w-full max-w-5xl max-h-[90vh] overflow-hidden rounded-lg shadow-2xl border border-slate-700 flex flex-col">
                            <div className="p-4 border-b border-slate-700 flex justify-between items-center bg-slate-800">
                                <h3 className="text-lg font-bold text-slate-100">
                                    Results: Category {viewingCategory}
                                </h3>
                                <button 
                                    onClick={() => setViewingCategory(null)}
                                    className="text-slate-400 hover:text-slate-100 p-1"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="overflow-y-auto p-4 space-y-8">
                                {relevantRaces.length === 0 ? (
                                    <div className="text-center text-slate-400 p-8">No results calculated for this category yet.</div>
                                ) : (
                                    relevantRaces.map(race => {
                                        const results = race.results?.[viewingCategory] || [];
                                        
                                        return (
                                            <div key={race.id} className="border border-slate-700 rounded-lg overflow-hidden">
                                                <div className="bg-slate-800 px-4 py-2 font-semibold text-sm border-b border-slate-700 flex justify-between items-center">
                                                    <span>{race.name}</span>
                                                    <span className="text-xs text-slate-400">{new Date(race.date).toLocaleDateString()}</span>
                                                </div>
                                                <table className="w-full text-left text-sm">
                                                    <thead className="bg-slate-800/50 text-xs text-slate-400">
                                                        <tr>
                                                            <th className="px-4 py-2 w-12">Pos</th>
                                                            <th className="px-4 py-2">Rider</th>
                                                            <th className="px-4 py-2 text-right">Time</th>
                                                            <th className="px-4 py-2 text-right">Pts</th>
                                                            <th className="px-4 py-2 text-center w-12">DQ</th>
                                                            <th className="px-4 py-2 text-center w-12">DC</th>
                                                            <th className="px-4 py-2 text-center w-12">EX</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-slate-800">
                                                        {results.map((rider: any, idx: number) => {
                                                            const isManualDQ = (race.manualDQs || []).includes(rider.zwiftId);
                                                            const isManualDeclass = (race.manualDeclassifications || []).includes(rider.zwiftId);
                                                            const isManualExcluded = (race.manualExclusions || []).includes(rider.zwiftId);

                                                            return (
                                                                <tr key={rider.zwiftId} className={`hover:bg-slate-800/50 ${isManualExcluded ? 'bg-slate-800/30' : isManualDQ ? 'bg-red-950/30' : isManualDeclass ? 'bg-yellow-950/20' : ''}`}>
                                                                    <td className="px-4 py-2 text-slate-400">{isManualExcluded ? '×' : isManualDQ ? '-' : isManualDeclass ? '*' : idx + 1}</td>
                                                                    <td className="px-4 py-2 font-medium">
                                                                        {rider.name}
                                                                        {isManualExcluded && <div className="text-[10px] text-slate-400 font-bold mt-0.5">EXCLUDED</div>}
                                                                        {isManualDQ && <div className="text-[10px] text-red-500 font-bold mt-0.5">DISQUALIFIED</div>}
                                                                        {isManualDeclass && <div className="text-[10px] text-yellow-500 font-bold mt-0.5">DECLASSIFIED</div>}
                                                                    </td>
                                                                    <td className="px-4 py-2 text-right font-mono text-slate-400">
                                                                        {rider.finishTime > 0 ? new Date(rider.finishTime).toISOString().substr(11, 8) : '-'}
                                                                    </td>
                                                                    <td className="px-4 py-2 text-right font-bold text-blue-400">
                                                                        {rider.totalPoints}
                                                                    </td>
                                                                    <td className="px-4 py-2 text-center">
                                                                        <input 
                                                                            type="checkbox"
                                                                            checked={isManualDQ}
                                                                            onChange={() => handleToggleDQ(race.id, rider.zwiftId, isManualDQ)}
                                                                            disabled={isManualDeclass || isManualExcluded}
                                                                            className="w-4 h-4 rounded border-slate-700 text-blue-500 focus:ring-blue-500 cursor-pointer disabled:opacity-30"
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2 text-center">
                                                                        <input 
                                                                            type="checkbox"
                                                                            checked={isManualDeclass}
                                                                            onChange={() => handleToggleDeclass(race.id, rider.zwiftId, isManualDeclass)}
                                                                            disabled={isManualDQ || isManualExcluded}
                                                                            className="w-4 h-4 rounded border-slate-700 text-yellow-500 focus:ring-yellow-500 cursor-pointer disabled:opacity-30"
                                                                        />
                                                                    </td>
                                                                    <td className="px-4 py-2 text-center">
                                                                        <input 
                                                                            type="checkbox"
                                                                            checked={isManualExcluded}
                                                                            onChange={() => handleToggleExclude(race.id, rider.zwiftId, isManualExcluded)}
                                                                            className="w-4 h-4 rounded border-slate-700 text-slate-400 focus:ring-slate-500 cursor-pointer"
                                                                        />
                                                                    </td>
                                                                </tr>
                                                            );
                                                        })}
                                                    </tbody>
                                                </table>
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}
        </div>
    );
}
