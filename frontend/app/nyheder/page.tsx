import type { Metadata } from 'next';
import { loadPublishedPosts } from '@/lib/postsServer';
import NewsCard from '@/components/blog/NewsCard';
import NewsListClient from '@/components/blog/NewsListClient';
import MarkNewsRead from '@/components/blog/MarkNewsRead';

// Rendered on every request, like /llms.txt, so a post shows up as soon as it is published.
export const dynamic = 'force-dynamic';

const DESCRIPTION = 'Race previews, analyser og nyt fra ligaen.';

export const metadata: Metadata = {
    title: 'Nyheder',
    description: DESCRIPTION,
    alternates: {
        canonical: '/nyheder',
        types: { 'application/rss+xml': [{ url: '/nyheder/rss.xml', title: 'DCU E-serien – Nyheder' }] },
    },
};

export default async function NyhederPage() {
    // Rendered on the server so search engines, link previews and bots see the posts.
    // null means Firestore could not be reached; the list then loads in the browser as before.
    const posts = await loadPublishedPosts();

    return (
        <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
            <h1 className="text-3xl font-bold mb-2 text-foreground">Nyheder</h1>
            <p className="text-muted-foreground mb-8">{DESCRIPTION}</p>

            {posts === null && <NewsListClient />}

            {posts !== null && posts.length === 0 && (
                <div className="bg-card rounded-lg border border-border p-8 text-center text-muted-foreground">
                    Ingen indlæg endnu.
                </div>
            )}

            {posts !== null && posts.length > 0 && (
                <>
                    <MarkNewsRead postId={posts[0].id} />
                    <div className="space-y-6">
                        {posts.map(post => <NewsCard key={post.id} post={post} />)}
                    </div>
                </>
            )}
        </div>
    );
}
