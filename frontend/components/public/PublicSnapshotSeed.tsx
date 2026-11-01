'use client';

import { createContext, useContext } from 'react';
import type { LeagueSettings, StageRace } from '@/types/admin';

const SettingsContext = createContext<LeagueSettings | null>(null);
const StageRacesContext = createContext<StageRace[] | null>(null);

/** Puts the server snapshot into the queries those pages render on the first HTML. */
export function PublicSnapshotSeed({
    settings,
    stageRaces,
    children,
}: {
    settings: LeagueSettings | null;
    stageRaces: StageRace[] | null;
    children: React.ReactNode;
}) {
    return (
        <SettingsContext.Provider value={settings}>
            <StageRacesContext.Provider value={stageRaces}>
                {children}
            </StageRacesContext.Provider>
        </SettingsContext.Provider>
    );
}

export function useSeededLeagueSettings(): LeagueSettings | null {
    return useContext(SettingsContext);
}

export function useSeededStageRaces(): StageRace[] | null {
    return useContext(StageRacesContext);
}
