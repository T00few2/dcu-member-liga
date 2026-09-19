'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { DEFAULT_GW_THRESHOLDS, type GhostWattsThresholds } from '@/lib/ghostWatts';

interface UseGhostWattsThresholdsReturn {
    thresholds: GhostWattsThresholds;
    setThresholds: (t: GhostWattsThresholds) => void;
    save: () => Promise<void>;
    saving: boolean;
    saveError: string | null;
}

export function useGhostWattsThresholds(): UseGhostWattsThresholdsReturn {
    const [thresholds, setThresholds] = useState<GhostWattsThresholds>(DEFAULT_GW_THRESHOLDS);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const snap = await getDoc(doc(db, 'league', 'adminSettings'));
                if (snap.exists()) {
                    const saved = (snap.data() || {}).ghostWattsThresholds;
                    if (saved && typeof saved === 'object') {
                        setThresholds({ ...DEFAULT_GW_THRESHOLDS, ...saved });
                    }
                }
            } catch {
                // Use defaults on failure — non-fatal
            }
        };
        void load();
    }, []);

    const save = useCallback(async () => {
        setSaving(true);
        setSaveError(null);
        try {
            await setDoc(
                doc(db, 'league', 'adminSettings'),
                { ghostWattsThresholds: thresholds },
                { merge: true },
            );
        } catch (err) {
            setSaveError(err instanceof Error ? err.message : 'Failed to save');
        } finally {
            setSaving(false);
        }
    }, [thresholds]);

    return { thresholds, setThresholds, save, saving, saveError };
}
