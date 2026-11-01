'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getComments, addComment, deleteComment, reportComment } from '@/lib/posts';
import { Comment } from '@/types/posts';
import { useAuth } from '@/lib/auth-context';
import { formatCommentDateTime } from '@/lib/postDates';

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
                    <span className="text-xs text-muted-foreground">{formatCommentDateTime(comment.createdAt)}</span>
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
                                <span className="text-xs text-muted-foreground">{formatCommentDateTime(reply.createdAt)}</span>
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

/** The admin edit link and the comment thread under a post. Needs the signed-in user, so it runs in the browser. */
export default function PostComments({ postId }: { postId: string }) {
    const { user, isAdmin, loading: authLoading } = useAuth();

    const [comments, setComments] = useState<Comment[]>([]);
    const [commentBody, setCommentBody] = useState('');
    const [replyToId, setReplyToId] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [submitError, setSubmitError] = useState('');

    const loadComments = useCallback(async (id: string) => {
        const c = await getComments(id);
        setComments(c);
    }, []);

    useEffect(() => {
        loadComments(postId);
    }, [postId, loadComments]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!user) return;
        const body = commentBody.trim();
        if (!body) return;
        if (body.length > 2000) { setSubmitError('Kommentaren må maks være 2000 tegn.'); return; }

        setSubmitting(true);
        setSubmitError('');
        try {
            await addComment(postId, {
                uid: user.uid,
                displayName: user.displayName ?? user.email ?? 'Anonym',
                body,
                parentId: replyToId,
            });
            setCommentBody('');
            setReplyToId(null);
            await loadComments(postId);
        } catch {
            setSubmitError('Kunne ikke sende kommentar. Prøv igen.');
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (commentId: string) => {
        await deleteComment(postId, commentId);
        await loadComments(postId);
    };

    const handleReport = async (commentId: string) => {
        await reportComment(postId, commentId);
        await loadComments(postId);
    };

    const topLevelComments = comments.filter(c => !c.parentId);
    const replies = comments.filter(c => c.parentId);

    return (
        <>
            {isAdmin && (
                <div className="mb-8">
                    <Link href={`/admin/nyheder/${postId}/edit`} className="text-sm text-primary hover:underline">
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
                            postId={postId}
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
        </>
    );
}
