'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, notFound } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import { getPostBySlug, getComments, addComment, deleteComment, reportComment } from '@/lib/posts';
import { Post, Comment } from '@/types/posts';
import { useAuth } from '@/lib/auth-context';
import { useUnreadNews } from '@/hooks/useUnreadNews';

const PostBody = dynamic(() => import('@/components/blog/PostBody'), { ssr: false });

function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('da-DK', { day: 'numeric', month: 'long', year: 'numeric' });
}

function formatDateTime(iso: string) {
    return new Date(iso).toLocaleString('da-DK', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

interface CommentItemProps {
    comment: Comment;
    replies: Comment[];
    onReply: (parentId: string) => void;
    onDelete: (id: string) => void;
    onReport: (id: string) => void;
    postId: string;
    currentUid: string | null;
    isAdmin: boolean;
}

function CommentItem({ comment, replies, onReply, onDelete, onReport, currentUid, isAdmin }: CommentItemProps) {
    const canDelete = isAdmin || comment.uid === currentUid;

    return (
        <div className="space-y-3">
            <div className="bg-card rounded-lg border border-border p-4">
                <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-sm text-foreground">{comment.displayName}</span>
                    <span className="text-xs text-muted-foreground">{formatDateTime(comment.createdAt)}</span>
                </div>
                <p className="text-sm text-foreground whitespace-pre-wrap">{comment.body}</p>
                <div className="flex gap-3 mt-2">
                    {currentUid && (
                        <button onClick={() => onReply(comment.id)} className="text-xs text-muted-foreground hover:text-primary transition-colors">
                            Svar
                        </button>
                    )}
                    {!canDelete && currentUid && !comment.reported && (
                        <button onClick={() => onReport(comment.id)} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                            Rapporter
                        </button>
                    )}
                    {comment.reported && !canDelete && (
                        <span className="text-xs text-muted-foreground">Rapporteret</span>
                    )}
                    {canDelete && (
                        <button onClick={() => onDelete(comment.id)} className="text-xs text-destructive hover:opacity-80 transition-colors">
                            Slet
                        </button>
                    )}
                </div>
            </div>

            {replies.length > 0 && (
                <div className="ml-6 space-y-3">
                    {replies.map(reply => (
                        <div key={reply.id} className="bg-muted/40 rounded-lg border border-border p-4">
                            <div className="flex items-center justify-between mb-2">
                                <span className="font-medium text-sm text-foreground">{reply.displayName}</span>
                                <span className="text-xs text-muted-foreground">{formatDateTime(reply.createdAt)}</span>
                            </div>
                            <p className="text-sm text-foreground whitespace-pre-wrap">{reply.body}</p>
                            <div className="flex gap-3 mt-2">
                                {!isAdmin && reply.uid !== currentUid && currentUid && !reply.reported && (
                                    <button onClick={() => onReport(reply.id)} className="text-xs text-muted-foreground hover:text-destructive transition-colors">
                                        Rapporter
                                    </button>
                                )}
                                {(isAdmin || reply.uid === currentUid) && (
                                    <button onClick={() => onDelete(reply.id)} className="text-xs text-destructive hover:opacity-80 transition-colors">
                                        Slet
                                    </button>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default function PostPage() {
    const { slug } = useParams<{ slug: string }>();
    const { user, isAdmin, loading: authLoading } = useAuth();
    const { markNewsAsRead } = useUnreadNews();

    const [post, setPost] = useState<Post | null | 'not-found'>('not-found');
    const [postLoading, setPostLoading] = useState(true);
    const [comments, setComments] = useState<Comment[]>([]);
    const [commentBody, setCommentBody] = useState('');
    const [replyToId, setReplyToId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    useEffect(() => {
        getPostBySlug(slug)
            .then(p => {
                setPost(p ?? 'not-found');
                if (p) markNewsAsRead(p.id);
            })
            .finally(() => setPostLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [slug]);

    const loadComments = useCallback(async (postId: string) => {
        const c = await getComments(postId);
        setComments(c);
    }, []);

    useEffect(() => {
        if (post && post !== 'not-found') loadComments(post.id);
    }, [post, loadComments]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user || !post || post === 'not-found') return;
        const body = commentBody.trim();
        if (!body) return;
        if (body.length > 2000) { setSubmitError('Kommentaren må maks være 2000 tegn.'); return; }

        setSubmitting(true);
        setSubmitError('');
        try {
            await addComment(post.id, {
                uid: user.uid,
                displayName: user.displayName ?? user.email ?? 'Anonym',
                body,
                parentId: replyToId,
            });
            setCommentBody('');
            setReplyToId(null);
            await loadComments(post.id);
        } catch {
            setSubmitError('Kunne ikke sende kommentar. Prøv igen.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (commentId: string) => {
        if (!post || post === 'not-found') return;
        await deleteComment(post.id, commentId);
        await loadComments(post.id);
    };

    const handleReport = async (commentId: string) => {
        if (!post || post === 'not-found') return;
        await reportComment(post.id, commentId);
        await loadComments(post.id);
    };

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

    const topLevelComments = comments.filter(c => !c.parentId);
    const replies = comments.filter(c => c.parentId);

    return (
        <div className="max-w-3xl mx-auto mt-8 px-4 pb-16">
            {/* Back */}
            <Link href="/nyheder" className="text-sm text-muted-foreground hover:text-primary transition-colors mb-6 inline-block">
                ← Tilbage til Nyheder
            </Link>

            {/* Cover */}
            {post.coverImageUrl && (
                <img src={post.coverImageUrl} alt={post.title} className="w-full rounded-lg mb-6 object-cover max-h-72" />
            )}

            {/* Meta */}
            <div className="flex items-center gap-2 flex-wrap mb-3">
                {post.tags.map(tag => (
                    <span key={tag} className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-primary/10 text-primary">
                        {tag}
                    </span>
                ))}
                {post.publishedAt && (
                    <span className="text-xs text-muted-foreground">{formatDate(post.publishedAt)}</span>
                )}
            </div>

            <h1 className="text-3xl font-bold text-foreground mb-2">{post.title}</h1>
            <p className="text-sm text-muted-foreground mb-8">Af {post.authorName}</p>

            {/* Body */}
            <div className="mb-12">
                <PostBody content={post.body} />
            </div>

            {isAdmin && (
                <div className="mb-8">
                    <Link href={`/admin/nyheder/${post.id}/edit`} className="text-sm text-primary hover:underline">
                        Rediger indlæg
                    </Link>
                </div>
            )}

            {/* Comments */}
            <section>
                <h2 className="text-xl font-bold text-foreground mb-6">
                    Kommentarer {comments.length > 0 && <span className="text-muted-foreground font-normal text-base">({comments.length})</span>}
                </h2>

                {topLevelComments.length === 0 && (
                    <p className="text-muted-foreground text-sm mb-6">Ingen kommentarer endnu. Vær den første!</p>
                )}

                <div className="space-y-6 mb-8">
                    {topLevelComments.map(comment => (
                        <CommentItem
                            key={comment.id}
                            comment={comment}
                            replies={replies.filter(r => r.parentId === comment.id)}
                            onReply={(id) => { setReplyToId(id); setCommentBody(''); }}
                            onDelete={handleDelete}
                            onReport={handleReport}
                            postId={post.id}
                            currentUid={user?.uid ?? null}
                            isAdmin={isAdmin}
                        />
                    ))}
                </div>

                {/* Comment form */}
                {!authLoading && !user && (
                    <p className="text-sm text-muted-foreground">
                        Du skal være <button onClick={() => {}} className="text-primary hover:underline">logget ind</button> for at kommentere.
                    </p>
                )}

                {!authLoading && user && (
                    <form onSubmit={handleSubmit} className="bg-card rounded-lg border border-border p-4">
                        {replyToId && (
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-muted-foreground">
                                    Svarer på: <strong>{comments.find(c => c.id === replyToId)?.displayName}</strong>
                                </span>
                                <button type="button" onClick={() => setReplyToId(null)} className="text-xs text-muted-foreground hover:text-foreground">
                                    Annuller
                                </button>
                            </div>
                        )}
                        <textarea
                            value={commentBody}
                            onChange={e => setCommentBody(e.target.value)}
                            placeholder={replyToId ? 'Skriv dit svar...' : 'Skriv en kommentar...'}
                            rows={3}
                            maxLength={2000}
                            className="w-full px-3 py-2 border border-input rounded-lg text-sm bg-background text-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
                        />
                        <div className="flex items-center justify-between mt-2">
                            <span className="text-xs text-muted-foreground">{commentBody.length}/2000</span>
                            <div className="flex items-center gap-2">
                                {submitError && <span className="text-xs text-destructive">{submitError}</span>}
                                <button
                                    type="submit"
                                    disabled={submitting || !commentBody.trim()}
                                    className="bg-primary text-primary-foreground px-4 py-1.5 rounded text-sm font-medium hover:opacity-90 disabled:opacity-50 transition-opacity"
                                >
                                    {submitting ? 'Sender...' : 'Send'}
                                </button>
                            </div>
                        </div>
                    </form>
                )}
            </section>
        </div>
    );
}
