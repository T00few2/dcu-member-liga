import Link from 'next/link';
import type { Post } from '@/types/posts';
import { coverObjectPosition } from '@/lib/coverPosition';
import { formatPostDate } from '@/lib/postDates';

/** Back link, cover, tags, date, title and byline of a post. No hooks, so it renders anywhere. */
export default function PostHeader({ post }: { post: Post }) {
    return (
        <>
            {/* Back */}
            <Link href="/nyheder" className="text-sm text-muted-foreground hover:text-primary transition-colors mb-6 inline-block">
                ← Tilbage til Nyheder
            </Link>

            {/* Cover */}
            {post.coverImageUrl && (
                <img
                    src={post.coverImageUrl}
                    alt={post.title}
                    className="w-full h-48 sm:h-72 rounded-lg mb-6 object-cover"
                    style={{ objectPosition: coverObjectPosition({ x: post.coverPositionX, y: post.coverPositionY }) }}
                />
            )}

            {/* Meta */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
                {post.tags.map(tag => (
                    <span key={tag} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {tag}
                    </span>
                ))}
                {post.publishedAt && (
                    <span className="text-xs text-muted-foreground">{formatPostDate(post.publishedAt)}</span>
                )}
            </div>

            <h1 className="text-3xl font-bold text-foreground mb-2">{post.title}</h1>
            <p className="text-sm text-muted-foreground mb-8">Af {post.authorName}</p>
        </>
    );
}
