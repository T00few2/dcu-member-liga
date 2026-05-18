'use client';

import { useEffect, useState, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useLeagueData } from '@/hooks/useLeagueData';
import type { Race } from '@/types/admin';
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

export default function LeagueManager({ initialActiveTab = 'races', onTabChange }: LeagueManagerProps) {
    const { user, loading: authLoading } = useAuth();
    const { routes, races, leagueSettings, status, error, setRaces, setLeagueSettings, setStatus, fetchSegments, refreshRace } =
        useLeagueData({ user, authLoading });

    const [activeTab, setActiveTab] = useState<LeagueManagerTab>(() =>
        TABS.includes(initialActiveTab) ? initialActiveTab : 'races',
    );

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
            setRaces(prev => prev.map(r => (r.id === updatedRace.id ? updatedRace : r)));
        },
        [setRaces],
    );

    if (authLoading || status === 'loading') {
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
                    setRaces={setRaces}
                    setLeagueSettings={setLeagueSettings}
                    setStatus={setStatus}
                    fetchSegments={fetchSegments}
                />
            )}

            {activeTab === 'results' && (
                <ResultsTab
                    user={user}
                    races={races}
                    status={status}
                    setStatus={setStatus}
                    refreshRace={refreshRace}
                />
            )}

            {activeTab === 'settings' && (
                <LeagueSettingsForm
                    user={user}
                    settings={leagueSettings}
                    onSave={setLeagueSettings}
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
