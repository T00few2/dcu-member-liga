'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import type { LiveConfig, OverlayColorScheme } from '@/types/overlay';
import { DEFAULT_LIVE_CONFIG, getOverlaySchemeFromConfig } from '@/types/overlay';

interface UseOverlayConfigReturn {
    config: LiveConfig;
    savedSchemes: OverlayColorScheme[];
    schemeName: string;
    setSchemeName: (name: string) => void;
    updateConfig: <K extends keyof LiveConfig>(field: K, value: LiveConfig[K]) => void;
    applyPalette: (palette: OverlayColorScheme) => void;
    saveScheme: () => Promise<void>;
    deleteScheme: (name: string) => Promise<void>;
}

export function useOverlayConfig(): UseOverlayConfigReturn {
    const [config, setConfig] = useState<LiveConfig>(DEFAULT_LIVE_CONFIG);
    const [savedSchemes, setSavedSchemes] = useState<OverlayColorScheme[]>([]);
    const [schemeName, setSchemeName] = useState('');

    // Load saved schemes on mount
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

    const updateConfig = useCallback(<K extends keyof LiveConfig>(field: K, value: LiveConfig[K]) => {
        setConfig(prev => ({ ...prev, [field]: value }));
    }, []);

    const applyPalette = useCallback((palette: OverlayColorScheme) => {
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
            overlayBackground: palette.overlayBackground,
        }));
    }, []);

    const saveSchemes = useCallback(async (schemes: OverlayColorScheme[]) => {
        setSavedSchemes(schemes);
        const settingsRef = doc(db, 'league', 'liveOverlay');
        try {
            await setDoc(settingsRef, { schemes }, { merge: true });
        } catch (e) {
            console.error('Failed to save overlay schemes:', e);
            alert('Failed to save color schemes.');
        }
    }, []);

    const saveScheme = useCallback(async () => {
        const name = schemeName.trim();
        if (!name) return;
        
        const nextScheme = getOverlaySchemeFromConfig(name, config);
        const existingIdx = savedSchemes.findIndex(
            s => s.name.toLowerCase() === name.toLowerCase()
        );
        const next = existingIdx >= 0
            ? savedSchemes.map((s, idx) => (idx === existingIdx ? nextScheme : s))
            : [...savedSchemes, nextScheme];
        
        await saveSchemes(next);
        setSchemeName('');
    }, [schemeName, config, savedSchemes, saveSchemes]);

    const deleteScheme = useCallback(async (name: string) => {
        const next = savedSchemes.filter(s => s.name !== name);
        await saveSchemes(next);
    }, [savedSchemes, saveSchemes]);

    return {
        config,
        savedSchemes,
        schemeName,
        setSchemeName,
        updateConfig,
        applyPalette,
        saveScheme,
        deleteScheme,
    };
}
