'use client';

import { useState, useEffect, useCallback } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/lib/firebase';
import { getLatestPublishedPost } from '@/lib/posts';
import { useAuth } from '@/lib/auth-context';

export function useUnreadNews() {
    const { user } = useAuth();
    const [hasUnreadNews, setHasUnreadNews] = useState(false);

    useEffect(() => {
        let cancelled = false;

        async function check() {
            const latest = await getLatestPublishedPost();
            if (!latest || cancelled) return;

            let lastReadId: string | null = null;
            if (user) {
                const snap = await getDoc(doc(db, 'users', user.uid));
                lastReadId = (snap.data()?.lastReadNewsPostId as string) ?? null;
            } else if (typeof localStorage !== 'undefined') {
                lastReadId = localStorage.getItem('news_last_read');
            }

            if (!cancelled) {
                setHasUnreadNews(latest.id !== lastReadId);
            }
        }

        check().catch(() => {});
        return () => { cancelled = true; };
    }, [user]);

    const markNewsAsRead = useCallback(async (postId: string) => {
        setHasUnreadNews(false);
        if (user) {
            await setDoc(doc(db, 'users', user.uid), { lastReadNewsPostId: postId }, { merge: true });
        } else if (typeof localStorage !== 'undefined') {
            localStorage.setItem('news_last_read', postId);
        }
    }, [user]);

    return { hasUnreadNews, markNewsAsRead };
}
