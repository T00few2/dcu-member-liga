'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { DualRecordingVerification } from '@/types/admin';
import type { DualRecordingResult } from '@/hooks/useDualRecording';

// ─── Context value type ───────────────────────────────────────────────────────

export interface DualRecordingContextValue {
    verification: DualRecordingVerification;
    streamResult: DualRecordingResult | null;
    streamLoading: boolean;
    streamError: string | null;
    hideHeartRate: boolean;
    runForRiderBusy: boolean;
    runForRiderStatus: { type: 'info' | 'success' | 'error'; text: string } | null;
    onRunForRider: (() => Promise<void>) | undefined;
    showRunActions: boolean;
}

// ─── Context ──────────────────────────────────────────────────────────────────

const DualRecordingContext = createContext<DualRecordingContextValue | null>(null);

// ─── Provider ────────────────────────────────────────────────────────────────

interface DualRecordingProviderProps extends DualRecordingContextValue {
    children: ReactNode;
}

export function DualRecordingProvider({ children, ...value }: DualRecordingProviderProps) {
    return (
        <DualRecordingContext.Provider value={value}>
            {children}
        </DualRecordingContext.Provider>
    );
}

// ─── Hook ────────────────────────────────────────────────────────────────────

export function useDualRecordingContext(): DualRecordingContextValue {
    const ctx = useContext(DualRecordingContext);
    if (!ctx) {
        throw new Error('useDualRecordingContext must be used within a DualRecordingProvider');
    }
    return ctx;
}
