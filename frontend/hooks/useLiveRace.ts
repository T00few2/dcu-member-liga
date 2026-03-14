import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, query, where, getDocs, getDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Race } from '@/types/live';
import { normalizeRace } from '@/lib/firestore-normalizers';

export function useLiveRace(raceId: string) {
    const [race, setRace] = useState<Race | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!raceId) return;

        const setupSubscription = async () => {
            let docRef;
            
            try {
                // 1) Canonical path: race doc ID
                docRef = doc(db, 'races', raceId);
                const docSnap = await getDoc(docRef);
                
                if (!docSnap.exists()) {
                    // 2) Minimal compatibility: linked event IDs
                    const q = query(collection(db, 'races'), where('linkedEventIds', 'array-contains', raceId));
                    const snapshot = await getDocs(q);

                    if (!snapshot.empty) {
                        docRef = doc(db, 'races', snapshot.docs[0].id);
                    } else {
                        setError(`No race found with ID: ${raceId}`);
                        setLoading(false);
                        return;
                    }
                }
            } catch (err: any) {
                console.error("Query error:", err);
                setError(`Query Error: ${err.message}`);
                setLoading(false);
                return;
            }

            const unsubscribe = onSnapshot(
                docRef,
                (docSnap) => {
                    if (docSnap.exists()) {
                        setRace(normalizeRace(docSnap.data(), docSnap.id));
                        setLoading(false);
                    } else {
                        setError('Race not found');
                        setLoading(false);
                    }
                },
                (err) => {
                    console.error("Firestore error:", err);
                    setError(`Error: ${err.message} (${err.code})`);
                    setLoading(false);
                }
            );

            return unsubscribe;
        };

        let unsubscribeFn: (() => void) | undefined;
        setupSubscription().then(unsub => {
            unsubscribeFn = unsub;
        });

        return () => {
            if (unsubscribeFn) unsubscribeFn();
        };
    }, [raceId]);

    return { race, loading, error };
}
