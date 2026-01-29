import { useState, useEffect } from 'react';
import { doc, onSnapshot, collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { Race } from '@/types/live';

export function useLiveRace(raceId: string) {
    const [race, setRace] = useState<Race | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!raceId) return;

        const setupSubscription = async () => {
            let docRef;
            
            try {
                // 1. Try Document ID
                docRef = doc(db, 'races', raceId);
                const docSnap = await getDocs(query(collection(db, 'races'), where('__name__', '==', raceId)));
                
                if (docSnap.empty) {
                     // 2. Try Legacy Event ID
                     const q = query(collection(db, 'races'), where('eventId', '==', raceId));
                     const snapshot = await getDocs(q);
                     if (!snapshot.empty) {
                        docRef = doc(db, 'races', snapshot.docs[0].id);
                     } else {
                        // 3. Try Linked Event IDs
                        const q2 = query(collection(db, 'races'), where('linkedEventIds', 'array-contains', raceId));
                        const snapshot2 = await getDocs(q2);
                        
                        if (!snapshot2.empty) {
                            docRef = doc(db, 'races', snapshot2.docs[0].id);
                        } else {
                            setError(`No race found with ID: ${raceId}`);
                            setLoading(false);
                            return;
                        }
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
                        setRace({ ...(docSnap.data() as Race), id: docSnap.id });
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
