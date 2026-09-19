'use client';

import { createContext, useContext, type ReactNode } from 'react';

export interface GhostWattsContextValue {
    stream: {
        time: number[];
        watts: (number | null)[];
        cadence: (number | null)[];
    };
}

const GhostWattsContext = createContext<GhostWattsContextValue | null>(null);

interface GhostWattsProviderProps extends GhostWattsContextValue {
    children: ReactNode;
}

export function GhostWattsProvider({ children, ...value }: GhostWattsProviderProps) {
    return (
        <GhostWattsContext.Provider value={value}>
            {children}
        </GhostWattsContext.Provider>
    );
}

export function useGhostWattsContext(): GhostWattsContextValue {
    const ctx = useContext(GhostWattsContext);
    if (!ctx) {
        throw new Error('useGhostWattsContext must be used within a GhostWattsProvider');
    }
    return ctx;
}
