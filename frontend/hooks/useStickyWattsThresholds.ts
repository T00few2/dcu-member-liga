'use client';

import { useState, useEffect, useCallback } from 'react';
import { db } from '@/lib/firebase';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { DEFAULT_THRESHOLDS, type StickyWattsThresholds } from '@/lib/stickyWatts';

interface UseStickyWattsThresholdsReturn {
    thresholds: StickyWattsThresholds;
    setThresholds: (t: StickyWattsThresholds) => void;
    save: () => Promise<void>;
    saving: boolean;
    saveError: string | null;
}

export function useStickyWattsThresholds(): UseStickyWattsThresholdsReturn {
    const [thresholds, setThresholds] = useState<StickyWattsThresholds>(DEFAULT_THRESHOLDS);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState<string | null>(null);

    useEffect(() => {
        const load = async () => {
            try {
                const snap = await getDoc(doc(db, 'league', 'adminSettings'));
                if (snap.exists()) {
                    const saved = (snap.data() || {}).stickyWattsThresholds;
                    if (saved && typeof saved === 'object') {
                        setThresholds({ ...DEFAULT_THRESHOLDS, ...saved });
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
                { stickyWattsThresholds: thresholds },
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
