'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useRoutesQuery, useRacesQuery, useStageRacesQuery, useLeagueSettingsQuery } from '@/hooks/queries';
import type { Race, LeagueSettings, LoadingStatus } from '@/types/admin';
import {
    RacesTab,
    EventsTab,
    ResultsTab,
    LeagueSettingsForm,
    TestDataPanel,
    RawDataViewer,
    RoutePlanningTab,
} from './league-manager';

export type LeagueManagerTab = 'races' | 'season' | 'results' | 'settings' | 'testing' | 'rawdata' | 'planning';

interface LeagueManagerProps {
    initialActiveTab?: LeagueManagerTab;
    onTabChange?: (tab: LeagueManagerTab) => void;
}

const TABS: LeagueManagerTab[] = ['races', 'season', 'results', 'settings', 'testing', 'rawdata', 'planning'];
const TAB_LABELS: Record<LeagueManagerTab, string> = {
    races: 'Races',
    season: 'Season',
    results: 'Results',
    settings: 'Scoring Settings',
    testing: 'Testing',
    rawdata: 'Results Editor',
    planning: 'Route Planning',
};

const DEFAULT_SETTINGS: LeagueSettings = {
    finishPoints: [],
    sprintPoints: [],
    leagueRankPoints: [],
    bestRacesCount: 5,
};

export default function LeagueManager({ initialActiveTab = 'races', onTabChange }: LeagueManagerProps) {
    const { user, loading: authLoading } = useAuth();
    const queryClient = useQueryClient();
    const routesQuery = useRoutesQuery();
    const racesQuery = useRacesQuery();
    const stageRacesQuery = useStageRacesQuery();
    const settingsQuery = useLeagueSettingsQuery();

    const routes = routesQuery.data ?? [];
    const races = (racesQuery.data ?? []) as unknown as Race[];
    const stageRaces = stageRacesQuery.data ?? [];
    const leagueSettings = settingsQuery.data ?? DEFAULT_SETTINGS;

    const [activeTab, setActiveTab] = useState<LeagueManagerTab>(() =>
        TABS.includes(initialActiveTab) ? initialActiveTab : 'races',
    );
    const [status, setStatus] = useState<LoadingStatus>('idle');

    // Sync from URL only when the URL tab changes (refresh, back/forward, deep link).
    // Do not depend on activeTab — that races with click handlers and briefly
    // resets the tab to the stale URL value, unmounting panels mid-fetch.
    useEffect(() => {
        if (TABS.includes(initialActiveTab)) {
            setActiveTab(initialActiveTab);
        }
    }, [initialActiveTab]);

    const handleTabChange = useCallback(
        (tab: LeagueManagerTab) => {
            setActiveTab(tab);
            onTabChange?.(tab);
        },
        [onTabChange],
    );

    const handleRaceUpdate = useCallback(
        (updatedRace: Race) => {
            queryClient.setQueryData<Race[]>(['races'], prev =>
                prev ? prev.map(r => (r.id === updatedRace.id ? updatedRace : r)) : [updatedRace],
            );
        },
        [queryClient],
    );

    if (
        authLoading
        || racesQuery.isLoading
        || stageRacesQuery.isLoading
        || settingsQuery.isLoading
        || routesQuery.isLoading
    ) {
        return <div className="p-8 text-center">Loading...</div>;
    }

    return (
        <div>
            <div className="flex gap-2 sm:gap-4 mb-8 border-b border-border overflow-x-auto scrollbar-hide">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => handleTabChange(tab)}
                        className={`shrink-0 whitespace-nowrap pb-2 px-2 sm:px-4 text-sm sm:text-base font-medium transition ${
                            activeTab === tab
                                ? 'text-primary border-b-2 border-primary'
                                : 'text-muted-foreground hover:text-foreground'
                        }`}
                    >
                        {TAB_LABELS[tab]}
                    </button>
                ))}
            </div>

            {activeTab === 'races' && (
                <RacesTab
                    user={user}
                    races={races}
                    routes={routes}
                    leagueSettings={leagueSettings}
                    status={status}
                    setStatus={setStatus}
                />
            )}

            {activeTab === 'season' && (
                <EventsTab
                    user={user}
                    races={races}
                    stageRaces={stageRaces}
                    leagueSettings={leagueSettings}
                    status={status}
                    setStatus={setStatus}
                />
            )}

            {activeTab === 'results' && (
                <ResultsTab
                    user={user}
                    races={races}
                    status={status}
                    setStatus={setStatus}
                />
            )}

            {activeTab === 'settings' && (
                <LeagueSettingsForm
                    user={user}
                    settings={leagueSettings}
                    status={status}
                    setStatus={setStatus}
                />
            )}

            {activeTab === 'testing' && (
                <TestDataPanel
                    user={user}
                    races={races}
                    status={status}
                    setStatus={setStatus}
                    onRacesChanged={() => {
                        void queryClient.invalidateQueries({ queryKey: ['races'] });
                        void queryClient.invalidateQueries({ queryKey: ['stageRaces'] });
                    }}
                />
            )}

            {activeTab === 'rawdata' && (
                <RawDataViewer races={races} onRaceUpdate={handleRaceUpdate} />
            )}

            {activeTab === 'planning' && (
                <RoutePlanningTab routes={routes} />
            )}
        </div>
    );
}
