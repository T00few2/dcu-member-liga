'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getPublishedPosts } from '@/lib/posts';
import { Post } from '@/types/posts';
import { useUnreadNews } from '@/hooks/useUnreadNews';

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
}

export default function NyhederPage() {
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
        <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
            <h1 className="text-3xl font-bold mb-2 text-foreground">Nyheder</h1>
            <p className="text-muted-foreground mb-8">Race previews, analyser og nyt fra ligaen.</p>

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
                    {posts.map(post => (
                        <Link key={post.id} href={`/nyheder/${post.slug}`} className="block group">
                            <article className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-shadow">
                                {post.coverImageUrl && (
                                    <img
                                        src={post.coverImageUrl}
                                        alt={post.title}
                                        className="w-full h-48 object-cover"
                                    />
                                )}
                                <div className="p-5">
                                    <div className="flex items-center gap-2 mb-2 flex-wrap">
                                        {post.tags.map(tag => (
                                            <span key={tag} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                                                {tag}
                                            </span>
                                        ))}
                                        {post.publishedAt && (
                                            <span className="text-xs text-muted-foreground ml-auto">{formatDate(post.publishedAt)}</span>
                                        )}
                                    </div>
                                    <h2 className="text-xl font-bold text-foreground group-hover:text-primary transition-colors mb-1">
                                        {post.title}
                                    </h2>
                                    <div className="flex items-center gap-3 mt-3 text-xs text-muted-foreground">
                                        <span>{post.authorName}</span>
                                        {post.commentCount > 0 && (
                                            <span>💬 {post.commentCount} {post.commentCount === 1 ? 'kommentar' : 'kommentarer'}</span>
                                        )}
                                    </div>
                                </div>
                            </article>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
