'use client';

import { useState, useEffect, useCallback } from 'react';
import { User } from 'firebase/auth';
import { db } from '@/lib/firebase';
import { doc, getDoc } from 'firebase/firestore';
import type { Route, Race, Segment, LeagueSettings, LoadingStatus } from '@/types/admin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

interface UseLeagueDataOptions {
    user: User | null;
    authLoading: boolean;
}

interface UseLeagueDataReturn {
    routes: Route[];
    races: Race[];
    leagueSettings: LeagueSettings;
    status: LoadingStatus;
    error: string;
    setRaces: React.Dispatch<React.SetStateAction<Race[]>>;
    setLeagueSettings: React.Dispatch<React.SetStateAction<LeagueSettings>>;
    setStatus: React.Dispatch<React.SetStateAction<LoadingStatus>>;
    fetchSegments: (routeId: string, laps: number) => Promise<Segment[]>;
    refreshRace: (raceId: string) => Promise<void>;
    refreshRaces: () => Promise<void>;
}

const defaultSettings: LeagueSettings = {
    finishPoints: [],
    sprintPoints: [],
    leagueRankPoints: [],
    bestRacesCount: 5,
};

export function useLeagueData({ user, authLoading }: UseLeagueDataOptions): UseLeagueDataReturn {
    const [routes, setRoutes] = useState<Route[]>([]);
    const [races, setRaces] = useState<Race[]>([]);
    const [leagueSettings, setLeagueSettings] = useState<LeagueSettings>(defaultSettings);
    const [status, setStatus] = useState<LoadingStatus>('idle');
    const [error, setError] = useState('');

    // Fetch initial data
    useEffect(() => {
        const fetchData = async () => {
            if (!user) return;
            setStatus('loading');
            setError('');
            
            try {
                const token = await user.getIdToken();
                
                const [routesRes, racesRes, settingsRes] = await Promise.all([
                    fetch(`${API_URL}/routes`),
                    fetch(`${API_URL}/races`, { 
                        headers: { 'Authorization': `Bearer ${token}` } 
                    }),
                    fetch(`${API_URL}/league/settings`, { 
                        headers: { 'Authorization': `Bearer ${token}` } 
                    }),
                ]);

                const routesData = await routesRes.json();
                setRoutes(routesData.routes || []);

                if (racesRes.ok) {
                    const racesData = await racesRes.json();
                    setRaces(racesData.races || []);
                }
                
                if (settingsRes.ok) {
                    const settingsData = await settingsRes.json();
                    const settings = settingsData.settings || {};
                    setLeagueSettings({
                        name: settings.name || '',
                        finishPoints: settings.finishPoints || [],
                        sprintPoints: settings.sprintPoints || [],
                        leagueRankPoints: settings.leagueRankPoints || [],
                        bestRacesCount: settings.bestRacesCount || 5,
                    });
                }
            } catch (e) {
                setError('Failed to load data');
                console.error('Error loading league data:', e);
            } finally {
                setStatus('idle');
            }
        };
        
        if (user && !authLoading) {
            fetchData();
        }
    }, [user, authLoading]);

    // Fetch segments for a specific route and lap count
    const fetchSegments = useCallback(async (routeId: string, laps: number): Promise<Segment[]> => {
        if (!routeId) return [];
        
        try {
            const res = await fetch(`${API_URL}/segments?routeId=${routeId}&laps=${laps}`);
            if (res.ok) {
                const data = await res.json();
                return data.segments || [];
            }
        } catch (e) {
            console.error('Error fetching segments:', e);
        }
        return [];
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
                } as Race;
                
                setRaces(prev => prev.map(r => r.id === raceId ? updatedRace : r));
            }
        } catch (error) {
            console.error("Error refreshing race:", error);
        }
    }, []);

    // Refresh all races list
    const refreshRaces = useCallback(async () => {
        if (!user) return;
        
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${API_URL}/races`, { 
                headers: { 'Authorization': `Bearer ${token}` } 
            });
            if (res.ok) {
                const data = await res.json();
                setRaces(data.races || []);
            }
        } catch (e) {
            console.error('Error refreshing races:', e);
        }
    }, [user]);

    return {
        routes,
        races,
        leagueSettings,
        status,
        error,
        setRaces,
        setLeagueSettings,
        setStatus,
        fetchSegments,
        refreshRace,
        refreshRaces,
    };
}

// Helper to group segments by lap
export function groupSegmentsByLap(segments: Segment[]): Record<number, Segment[]> {
    return segments.reduce((acc, seg) => {
        const lap = seg.lap || 1;
        if (!acc[lap]) acc[lap] = [];
        acc[lap].push(seg);
        return acc;
    }, {} as Record<number, Segment[]>);
}

// Helper to get derived route data
export function getRouteHelpers(routes: Route[], selectedMap: string, selectedRouteId: string) {
    const maps = Array.from(new Set(routes.map(r => r.map))).sort();
    const filteredRoutes = selectedMap ? routes.filter(r => r.map === selectedMap) : [];
    const selectedRoute = routes.find(r => r.id === selectedRouteId);
    
    return { maps, filteredRoutes, selectedRoute };
}
