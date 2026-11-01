import Link from 'next/link';
import type { Post } from '@/types/posts';
import { coverObjectPosition } from '@/lib/coverPosition';
import { formatPostDate } from '@/lib/postDates';

/** One post in the /nyheder list. No hooks, so it renders on the server or in the browser. */
export default function NewsCard({ post }: { post: Post }) {
    return (
        <Link href={`/nyheder/${post.slug}`} className="block group">
            <article className="bg-card rounded-lg border border-border overflow-hidden hover:shadow-md transition-shadow">
                {post.coverImageUrl && (
                    <img
                        src={post.coverImageUrl}
                        alt={post.title}
                        className="w-full h-48 object-cover"
                        style={{ objectPosition: coverObjectPosition({ x: post.coverPositionX, y: post.coverPositionY }) }}
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
                            <span className="text-xs text-muted-foreground ml-auto">{formatPostDate(post.publishedAt)}</span>
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
    );
}
