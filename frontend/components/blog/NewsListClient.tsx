'use client';

import { useEffect, useState } from 'react';
import { getPublishedPosts } from '@/lib/posts';
import { Post } from '@/types/posts';
import { useUnreadNews } from '@/hooks/useUnreadNews';
import NewsCard from './NewsCard';

/**
 * The news list loaded in the browser. /nyheder renders on the server; this is its fallback when
 * the server could not reach Firestore.
 */
export default function NewsListClient() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const { markNewsAsRead } = useUnreadNews();

    useEffect(() => {
        getPublishedPosts()
            .then(data => {
                setPosts(data);
                if (data.length > 0) markNewsAsRead(data[0].id);
            })
            .finally(() => setLoading(false));
    // markNewsAsRead is stable (useCallback); intentionally omitting from deps to fire once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return (
        <>
            {loading && (
                <div className="space-y-4">
                    {[1, 2, 3].map(i => (
                        <div key={i} className="bg-card rounded-lg border border-border h-40 animate-pulse" />
                    ))}
                </div>
            )}

            {!loading && posts.length === 0 && (
                <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
                    Ingen indlæg endnu.
                </div>
            )}

            {!loading && posts.length > 0 && (
                <div className="space-y-6">
                    {posts.map(post => <NewsCard key={post.id} post={post} />)}
                </div>
            )}
        </>
    );
}
