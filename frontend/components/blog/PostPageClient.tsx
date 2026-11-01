'use client';

import { useEffect, useState } from 'react';
import { notFound } from 'next/navigation';
import dynamic from 'next/dynamic';
import { getPostBySlug, getLatestPublishedPost } from '@/lib/posts';
import { Post } from '@/types/posts';
import { useUnreadNews } from '@/hooks/useUnreadNews';
import PostHeader from './PostHeader';
import PostComments from './PostComments';

const PostBody = dynamic(() => import('@/components/blog/PostBody'), { ssr: false });

/**
 * A post loaded in the browser. /nyheder/[slug] renders on the server; this is its fallback when
 * the server could not reach Firestore.
 */
export default function PostPageClient({ slug }: { slug: string }) {
    const { markNewsAsRead } = useUnreadNews();

    const [post, setPost] = useState<Post | null | 'not-found'>('not-found');
    const [postLoading, setPostLoading] = useState(true);

    useEffect(() => {
        getPostBySlug(slug)
            .then(p => {
                setPost(p ?? 'not-found');
            })
            .finally(() => setPostLoading(false));

        getLatestPublishedPost()
            .then(latest => {
                if (latest) markNewsAsRead(latest.id);
            })
            .catch((err) => console.error('Failed to update news read state:', err));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    if (postLoading) {
        return (
            <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
                <div className="h-8 bg-muted rounded animate-pulse mb-4 w-2/3" />
                <div className="h-4 bg-muted rounded animate-pulse mb-8 w-1/3" />
                <div className="space-y-3">
                    {[1, 2, 3, 4].map(i => <div key={i} className="h-4 bg-muted rounded animate-pulse" />)}
                </div>
            </div>
        );
    }

    if (post === 'not-found' || post === null) {
        notFound();
        return null;
    }

    return (
        <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
            <PostHeader post={post} />

            {/* Body */}
            <div className="mb-12">
                <PostBody content={post.body} />
            </div>

            <PostComments postId={post.id} />
        </div>
    );
}
