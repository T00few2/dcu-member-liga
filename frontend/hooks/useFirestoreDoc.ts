'use client';

import { useEffect, useState } from 'react';
import { db } from '@/lib/firebase';
import { doc, onSnapshot, DocumentData } from 'firebase/firestore';

interface UseFirestoreDocResult<T> {
    data: T | null;
    loading: boolean;
    error: Error | null;
}

export function useFirestoreDoc<T = DocumentData>(
    path: string,
    id: string | null | undefined,
): UseFirestoreDocResult<T> {
    const [data, setData] = useState<T | null>(null);
    const [loading, setLoading] = useState(!!id);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!id) {
            setData(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        const unsubscribe = onSnapshot(
            doc(db, path, id),
            (snap) => {
                setData(snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null);
                setLoading(false);
                setError(null);
            },
            (err) => {
                console.error(`Firestore [${path}/${id}]:`, err);
                setError(err);
                setLoading(false);
            },
        );

        return unsubscribe;
    }, [path, id]);

    return { data, loading, error };
}
