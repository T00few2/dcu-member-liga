'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { getAllPosts, deletePost } from '@/lib/posts';
import { Post } from '@/types/posts';

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function PostsManager() {
    const [posts, setPosts] = useState<Post[]>([]);
    const [loading, setLoading] = useState(true);
    const [deleting, setDeleting] = useState<string | null>(null);

    const load = async () => {
        setLoading(true);
        try {
            setPosts(await getAllPosts());
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => { load(); }, []);

    const handleDelete = async (post: Post) => {
        if (!confirm(`Slet "${post.title}"? Dette kan ikke fortrydes.`)) return;
        setDeleting(post.id);
        try {
            await deletePost(post.id);
            setPosts(prev => prev.filter(p => p.id !== post.id));
        } finally {
            setDeleting(null);
        }
    };

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-xl font-bold text-foreground">Nyheder</h2>
                    <p className="text-sm text-muted-foreground mt-0.5">Administrer race previews og indlæg.</p>
                </div>
                <Link
                    href="/admin/nyheder/new"
                    className="bg-primary text-primary-foreground px-4 py-2 rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
                >
                    + Nyt indlæg
                </Link>
            </div>

            {loading && (
                <div className="space-y-2">
                    {[1, 2, 3].map(i => <div key={i} className="h-16 bg-muted rounded-lg animate-pulse" />)}
                </div>
            )}

            {!loading && posts.length === 0 && (
                <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
                    Ingen indlæg endnu.{' '}
                    <Link href="/admin/nyheder/new" className="text-primary hover:underline">Opret det første.</Link>
                </div>
            )}

            {!loading && posts.length > 0 && (
                <div className="space-y-2">
                    {posts.map(post => (
                        <div key={post.id} className="bg-card rounded-lg border border-border px-4 py-3 flex items-center gap-4">
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${post.status === 'published' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                        {post.status === 'published' ? 'Publiceret' : 'Kladde'}
                                    </span>
                                    <h3 className="font-medium text-foreground truncate">{post.title}</h3>
                                </div>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                    {post.publishedAt ? formatDate(post.publishedAt) : `Opdateret ${formatDate(post.updatedAt)}`}
                                    {' · '}{post.commentCount} {post.commentCount === 1 ? 'kommentar' : 'kommentarer'}
                                </p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                                {post.status === 'published' && (
                                    <Link href={`/nyheder/${post.slug}`} target="_blank" className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 border border-border rounded">
                                        Vis
                                    </Link>
                                )}
                                <Link href={`/admin/nyheder/${post.id}/edit`} className="text-xs text-muted-foreground hover:text-primary transition-colors px-2 py-1 border border-border rounded">
                                    Rediger
                                </Link>
                                <button
                                    onClick={() => handleDelete(post)}
                                    disabled={deleting === post.id}
                                    className="text-xs text-destructive hover:opacity-80 transition-opacity px-2 py-1 border border-destructive/30 rounded disabled:opacity-50"
                                >
                                    {deleting === post.id ? '...' : 'Slet'}
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
