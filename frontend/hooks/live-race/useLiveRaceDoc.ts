'use client';

import { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { normalizeRace } from '@/lib/firestore-normalizers';
import type { Race } from '@/types/live';

export function useLiveRaceDoc(raceId: string | undefined) {
    const [race, setRace] = useState<Race | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!raceId) {
            setRace(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        const ref = doc(db, 'races', raceId);
        const unsub = onSnapshot(
            ref,
            (snap) => {
                if (snap.exists()) {
                    setRace(normalizeRace(snap.data(), snap.id));
                    setError(null);
                } else {
                    setRace(null);
                    setError('Race not found');
                }
                setLoading(false);
            },
            (err) => {
                setError(err.message);
                setLoading(false);
            },
        );

        return () => unsub();
    }, [raceId]);

    return { race, loading, error };
}
