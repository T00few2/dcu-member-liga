'use client';

import { useEffect, useState, useCallback } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useRoutesQuery, useRacesQuery, useLeagueSettingsQuery } from '@/hooks/queries';
import type { Race, LeagueSettings, LoadingStatus } from '@/types/admin';
import {
    RacesTab,
    ResultsTab,
    LeagueSettingsForm,
    TestDataPanel,
    RawDataViewer,
} from './league-manager';

export type LeagueManagerTab = 'races' | 'results' | 'settings' | 'testing' | 'rawdata';

interface LeagueManagerProps {
    initialActiveTab?: LeagueManagerTab;
    onTabChange?: (tab: LeagueManagerTab) => void;
}

const TABS: LeagueManagerTab[] = ['races', 'results', 'settings', 'testing', 'rawdata'];
const TAB_LABELS: Record<LeagueManagerTab, string> = {
    races: 'Races',
    results: 'Results',
    settings: 'Scoring Settings',
    testing: 'Testing',
    rawdata: 'Results Editor',
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
    const settingsQuery = useLeagueSettingsQuery();

    const routes = routesQuery.data ?? [];
    const races = (racesQuery.data ?? []) as unknown as Race[];
    const leagueSettings = settingsQuery.data ?? DEFAULT_SETTINGS;

    const [activeTab, setActiveTab] = useState<LeagueManagerTab>(() =>
        TABS.includes(initialActiveTab) ? initialActiveTab : 'races',
    );
    const [status, setStatus] = useState<LoadingStatus>('idle');

    useEffect(() => {
        if (TABS.includes(initialActiveTab) && initialActiveTab !== activeTab) {
            setActiveTab(initialActiveTab);
        }
    }, [initialActiveTab, activeTab]);

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

    if (authLoading || racesQuery.isLoading || settingsQuery.isLoading || routesQuery.isLoading) {
        return <div className="p-8 text-center">Loading...</div>;
    }

    return (
        <div>
            <div className="flex gap-4 mb-8 border-b border-border">
                {TABS.map(tab => (
                    <button
                        key={tab}
                        onClick={() => handleTabChange(tab)}
                        className={`pb-2 px-4 font-medium transition ${
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
                />
            )}

            {activeTab === 'rawdata' && (
                <RawDataViewer races={races} onRaceUpdate={handleRaceUpdate} />
            )}
        </div>
    );
}
