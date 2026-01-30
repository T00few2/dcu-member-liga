'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { db } from '@/lib/firebase';
import { collection, getDocs, getDoc, query, doc, updateDoc, arrayUnion, arrayRemove } from 'firebase/firestore';
import { User } from 'firebase/auth';

// Simplified Race type for live dashboard
export interface LiveRace {
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

interface UseLiveRacesReturn {
    races: LiveRace[];
    allCategories: string[];
    loading: boolean;
    setRaces: React.Dispatch<React.SetStateAction<LiveRace[]>>;
    getRaceCategories: (race: LiveRace) => Set<string>;
    refreshRace: (raceId: string) => Promise<void>;
    handleToggleDQ: (raceId: string, zwiftId: string, isCurrentlyDQ: boolean) => Promise<void>;
    handleToggleDeclass: (raceId: string, zwiftId: string, isCurrentlyDeclass: boolean) => Promise<void>;
    handleToggleExclude: (raceId: string, zwiftId: string, isCurrentlyExcluded: boolean) => Promise<void>;
}

export function useLiveRaces(user: User | null): UseLiveRacesReturn {
    const [races, setRaces] = useState<LiveRace[]>([]);
    const [loading, setLoading] = useState(true);

    // Fetch races on mount
    useEffect(() => {
        const fetchRaces = async () => {
            try {
                const racesRef = collection(db, 'races');
                const q = query(racesRef);
                const snapshot = await getDocs(q);
                
                const fetchedRaces = snapshot.docs.map(doc => ({
                    id: doc.id,
                    ...doc.data()
                })) as LiveRace[];

                // Sort by date ascending
                fetchedRaces.sort((a, b) => 
                    new Date(a.date).getTime() - new Date(b.date).getTime()
                );

                setRaces(fetchedRaces);
            } catch (error) {
                console.error("Error fetching races:", error);
            } finally {
                setLoading(false);
            }
        };

        fetchRaces();
    }, []);

    // Extract and sort all categories
    const allCategories = useMemo(() => {
        const categories = new Set<string>();
        
        races.forEach(race => {
            if (race.eventConfiguration?.length) {
                race.eventConfiguration.forEach(c => {
                    if (c.customCategory) categories.add(c.customCategory);
                });
            }
            if (race.singleModeCategories?.length) {
                race.singleModeCategories.forEach(c => {
                    if (c.category) categories.add(c.category);
                });
            }
            if (race.results) {
                Object.keys(race.results).forEach(c => categories.add(c));
            }
        });

        if (categories.size === 0) {
            ['A', 'B', 'C', 'D', 'E'].forEach(c => categories.add(c));
        }

        const availableCategories = Array.from(categories);
        
        // Find reference race for ordering
        const referenceRaceMulti = [...races].reverse().find(
            r => r.eventMode === 'multi' && r.eventConfiguration?.length
        );
        const referenceRaceSingle = [...races].reverse().find(
            r => r.singleModeCategories?.length
        );

        if (referenceRaceMulti?.eventConfiguration) {
            const orderMap = new Map<string, number>();
            referenceRaceMulti.eventConfiguration.forEach((cfg, idx) => {
                if (cfg.customCategory) orderMap.set(cfg.customCategory, idx);
            });
            
            availableCategories.sort((a, b) => {
                const idxA = orderMap.get(a) ?? 999;
                const idxB = orderMap.get(b) ?? 999;
                if (idxA === idxB) return a.localeCompare(b);
                return idxA - idxB;
            });
        } else if (referenceRaceSingle?.singleModeCategories) {
            const orderMap = new Map<string, number>();
            referenceRaceSingle.singleModeCategories.forEach((cfg, idx) => {
                if (cfg.category) orderMap.set(cfg.category, idx);
            });
            
            availableCategories.sort((a, b) => {
                const idxA = orderMap.get(a) ?? 999;
                const idxB = orderMap.get(b) ?? 999;
                if (idxA === idxB) return a.localeCompare(b);
                return idxA - idxB;
            });
        } else {
            availableCategories.sort();
        }

        return availableCategories;
    }, [races]);

    // Get categories for a specific race
    const getRaceCategories = useCallback((race: LiveRace): Set<string> => {
        const raceCats = new Set<string>();
        
        if (race.eventConfiguration?.length) {
            race.eventConfiguration.forEach(c => 
                c.customCategory && raceCats.add(c.customCategory)
            );
        }
        if (race.singleModeCategories?.length) {
            race.singleModeCategories.forEach(c => 
                c.category && raceCats.add(c.category)
            );
        }
        if (race.results) {
            Object.keys(race.results).forEach(c => raceCats.add(c));
        }
        if (raceCats.size === 0) {
            ['A', 'B', 'C', 'D', 'E'].forEach(c => raceCats.add(c));
        }
        
        return raceCats;
    }, []);

    // Refresh a single race from Firebase (call after results calculation)
    const refreshRace = useCallback(async (raceId: string) => {
        try {
            const raceRef = doc(db, 'races', raceId);
            const raceSnap = await getDoc(raceRef);
            
            if (raceSnap.exists()) {
                const updatedRace = {
                    id: raceSnap.id,
                    ...raceSnap.data(),
                } as LiveRace;
                
                setRaces(prev => prev.map(r => r.id === raceId ? updatedRace : r));
            }
        } catch (error) {
            console.error("Error refreshing race:", error);
        }
    }, []);

    // Helper to update local race state
    const updateRaceLocally = useCallback((
        raceId: string, 
        updater: (race: LiveRace) => LiveRace
    ) => {
        setRaces(prev => prev.map(r => r.id === raceId ? updater(r) : r));
    }, []);

    const toggleValue = (
        values: string[] | undefined, 
        zwiftId: string, 
        isCurrentlySet: boolean
    ): string[] => {
        const list = values ? [...values] : [];
        if (isCurrentlySet) {
            return list.filter(v => v !== zwiftId);
        }
        if (!list.includes(zwiftId)) {
            list.push(zwiftId);
        }
        return list;
    };

    const handleToggleDQ = useCallback(async (
        raceId: string, 
        zwiftId: string, 
        isCurrentlyDQ: boolean
    ) => {
        if (!user) {
            alert('Please log in to update results.');
            return;
        }
        try {
            const raceRef = doc(db, 'races', raceId);
            if (isCurrentlyDQ) {
                await updateDoc(raceRef, { manualDQs: arrayRemove(zwiftId) });
            } else {
                await updateDoc(raceRef, {
                    manualDQs: arrayUnion(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                    manualExclusions: arrayRemove(zwiftId),
                });
            }
            updateRaceLocally(raceId, race => ({
                ...race,
                manualDQs: toggleValue(race.manualDQs, zwiftId, isCurrentlyDQ),
                manualDeclassifications: toggleValue(race.manualDeclassifications, zwiftId, true),
                manualExclusions: toggleValue(race.manualExclusions, zwiftId, true),
            }));
        } catch (e) {
            console.error("Error updating DQ status:", e);
            alert("Failed to update DQ status");
        }
    }, [user, updateRaceLocally]);

    const handleToggleDeclass = useCallback(async (
        raceId: string, 
        zwiftId: string, 
        isCurrentlyDeclass: boolean
    ) => {
        if (!user) {
            alert('Please log in to update results.');
            return;
        }
        try {
            const raceRef = doc(db, 'races', raceId);
            if (isCurrentlyDeclass) {
                await updateDoc(raceRef, { manualDeclassifications: arrayRemove(zwiftId) });
            } else {
                await updateDoc(raceRef, {
                    manualDeclassifications: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                    manualExclusions: arrayRemove(zwiftId),
                });
            }
            updateRaceLocally(raceId, race => ({
                ...race,
                manualDeclassifications: toggleValue(race.manualDeclassifications, zwiftId, isCurrentlyDeclass),
                manualDQs: toggleValue(race.manualDQs, zwiftId, true),
                manualExclusions: toggleValue(race.manualExclusions, zwiftId, true),
            }));
        } catch (e) {
            console.error("Error updating Declass status:", e);
            alert("Failed to update Declass status");
        }
    }, [user, updateRaceLocally]);

    const handleToggleExclude = useCallback(async (
        raceId: string, 
        zwiftId: string, 
        isCurrentlyExcluded: boolean
    ) => {
        if (!user) {
            alert('Please log in to update results.');
            return;
        }
        try {
            const raceRef = doc(db, 'races', raceId);
            if (isCurrentlyExcluded) {
                await updateDoc(raceRef, { manualExclusions: arrayRemove(zwiftId) });
            } else {
                await updateDoc(raceRef, {
                    manualExclusions: arrayUnion(zwiftId),
                    manualDQs: arrayRemove(zwiftId),
                    manualDeclassifications: arrayRemove(zwiftId),
                });
            }
            updateRaceLocally(raceId, race => ({
                ...race,
                manualExclusions: toggleValue(race.manualExclusions, zwiftId, isCurrentlyExcluded),
                manualDQs: toggleValue(race.manualDQs, zwiftId, true),
                manualDeclassifications: toggleValue(race.manualDeclassifications, zwiftId, true),
            }));
        } catch (e) {
            console.error("Error updating exclusion status:", e);
            alert("Failed to update exclusion status");
        }
    }, [user, updateRaceLocally]);

    return {
        races,
        allCategories,
        loading,
        setRaces,
        getRaceCategories,
        refreshRace,
        handleToggleDQ,
        handleToggleDeclass,
        handleToggleExclude,
    };
}
