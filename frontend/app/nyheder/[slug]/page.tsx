import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { loadPublishedPostBySlug, loadPublishedPosts } from '@/lib/postsServer';
import { postExcerpt, renderPostHtml } from '@/lib/postHtml';
import PostHeader from '@/components/blog/PostHeader';
import PostComments from '@/components/blog/PostComments';
import PostPageClient from '@/components/blog/PostPageClient';
import MarkNewsRead from '@/components/blog/MarkNewsRead';

// Rendered on every request, so an edit or a new post shows straight away.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
    const { slug } = await params;
    const post = await loadPublishedPostBySlug(slug);
    if (!post) return { title: 'Nyheder' };
    const description = postExcerpt(post.body, 200) || 'Nyt fra DCU E-serien.';
    const url = `/nyheder/${post.slug}`;
    return {
        title: post.title,
        description,
        alternates: { canonical: url },
        openGraph: {
            type: 'article',
            title: post.title,
            description,
            url,
            publishedTime: post.publishedAt ?? undefined,
            authors: post.authorName ? [post.authorName] : undefined,
            tags: post.tags,
            ...(post.coverImageUrl ? { images: [{ url: post.coverImageUrl, alt: post.title }] } : {}),
        },
        twitter: {
            card: 'summary_large_image',
            title: post.title,
            description,
            ...(post.coverImageUrl ? { images: [post.coverImageUrl] } : {}),
        },
    };
}

export default async function PostPage({ params }: Props) {
    const { slug } = await params;
    const [post, latest] = await Promise.all([loadPublishedPostBySlug(slug), loadPublishedPosts(1)]);

    // Firestore could not be reached from the server: load the post in the browser as before.
    if (post === undefined) return <PostPageClient slug={slug} />;
    if (post === null) notFound();

    return (
        <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
            <MarkNewsRead postId={latest?.[0]?.id ?? null} />
            <PostHeader post={post} />

            {/* Body: rendered on the server so search engines, link previews and bots can read it. */}
            <div className="mb-12">
                <div className="blog-content" dangerouslySetInnerHTML={{ __html: renderPostHtml(post.body) }} />
            </div>

            <PostComments postId={post.id} />
        </div>
    );
}
