'use client';

import { createContext, useContext, type ReactNode } from 'react';

// ─── Context value type ───────────────────────────────────────────────────────

export interface StickyWattsContextValue {
    stream: {
        time: number[];
        watts: (number | null)[];
    };
}

// ─── Context ──────────────────────────────────────────────────────────────────

const StickyWattsContext = createContext<StickyWattsContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface StickyWattsProviderProps extends StickyWattsContextValue {
    children: ReactNode;
}

export function StickyWattsProvider({ children, ...value }: StickyWattsProviderProps) {
    return (
        <StickyWattsContext.Provider value={value}>
            {children}
        </StickyWattsContext.Provider>
    );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useStickyWattsContext(): StickyWattsContextValue {
    const ctx = useContext(StickyWattsContext);
    if (!ctx) {
        throw new Error('useStickyWattsContext must be used within a StickyWattsProvider');
    }
    return ctx;
}
