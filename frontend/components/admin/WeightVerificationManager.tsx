'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ToastProvider';

interface PendingVerification {
    id: string; // eLicense or UID
    name: string;
    eLicense: string;
    club: string;
    videoLink: string;
    submittedAt: string | any;
}

export default function WeightVerificationManager() {
    const { user } = useAuth();
    const { showToast } = useToast();

    // Trigger State
    const [triggerPercent, setTriggerPercent] = useState(5);
    const [triggering, setTriggering] = useState(false);

    // Pending List State
    const [pending, setPending] = useState<PendingVerification[]>([]);
    const [loadingPending, setLoadingPending] = useState(true);

    // Review State
    const [reviewingId, setReviewingId] = useState<string | null>(null);
    const [rejectionReason, setRejectionReason] = useState('');

    const fetchPending = async () => {
        if (!user) return;
        setLoadingPending(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/verification/pending`, {
                headers: { 'Authorization': `Bearer ${token}` }
            });
            if (res.ok) {
                const data = await res.json();
                setPending(data.pending || []);
            }
        } catch (e) {
            console.error(e);
            showToast('Failed to load pending verifications', 'error');
        } finally {
            setLoadingPending(false);
        }
    };

    useEffect(() => {
        fetchPending();
    }, [user]);

    const handleTrigger = async () => {
        if (!user) return;
        if (!confirm(`Are you sure you want to verify ${triggerPercent}% of registered riders? This will send notifications/requirements to them.`)) return;

        setTriggering(true);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/verification/trigger`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({ percentage: triggerPercent, deadlineDays: 7 })
            });
            const data = await res.json();
            if (res.ok) {
                showToast(data.message || 'Verification triggered!', 'success');
            } else {
                showToast(data.message || 'Failed to trigger', 'error');
            }
        } catch (e) {
            showToast('Network error triggering verification', 'error');
        } finally {
            setTriggering(false);
        }
    };

    const handleReview = async (id: string, action: 'approve' | 'reject') => {
        if (!user) return;
        if (action === 'reject' && !rejectionReason && !confirm('Reject without a reason?')) return;

        setReviewingId(id);
        try {
            const token = await user.getIdToken();
            const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/admin/verification/review`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: id,
                    action,
                    reason: rejectionReason
                })
            });

            if (res.ok) {
                showToast(`Rider ${action}d successfully`, 'success');
                // Remove from local list
                setPending(prev => prev.filter(p => p.id !== id));
                setRejectionReason('');
            } else {
                const data = await res.json();
                showToast(data.message || 'Review failed', 'error');
            }
        } catch (e) {
            showToast('Network error submitting review', 'error');
        } finally {
            setReviewingId(null);
        }
    };

    return (
        <div className="space-y-8">
            {/* TRIGGER SECTION */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <h2 className="text-xl font-bold mb-4 text-card-foreground">Trigger Random Verification</h2>
                <div className="flex items-end gap-4">
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Percentage of Riders</label>
                        <div className="relative">
                            <input
                                type="number"
                                min="1"
                                max="100"
                                value={triggerPercent}
                                onChange={(e) => setTriggerPercent(Number(e.target.value))}
                                className="w-24 p-2 bg-background border border-input rounded text-foreground"
                            />
                            <span className="absolute right-3 top-2 text-muted-foreground">%</span>
                        </div>
                    </div>
                    <button
                        onClick={handleTrigger}
                        disabled={triggering}
                        className="bg-primary text-primary-foreground px-4 py-2 rounded font-bold hover:bg-primary/90 disabled:opacity-50"
                    >
                        {triggering ? 'Triggering...' : 'Start Verification Wave'}
                    </button>
                </div>
                <p className="text-sm text-muted-foreground mt-2">
                    Selected riders will be notified and required to submit a weight verification video within 7 days.
                </p>
            </div>

            {/* PENDING LIST SECTION */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-card-foreground">Pending Reviews ({pending.length})</h2>
                    <button onClick={fetchPending} className="text-sm text-primary hover:underline">Refresh</button>
                </div>

                {loadingPending ? (
                    <div className="text-center p-8 text-muted-foreground">Loading pending requests...</div>
                ) : pending.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                        No pending verifications found. Good job!
                    </div>
                ) : (
                    <div className="space-y-4">
                        {pending.map(req => (
                            <div key={req.id} className="border border-border rounded-lg p-4 bg-card flex flex-col md:flex-row gap-4 items-start md:items-center justify-between">
                                <div className="flex-1">
                                    <div className="font-bold text-lg text-foreground">{req.name}</div>
                                    <div className="text-sm text-muted-foreground">
                                        License: {req.eLicense} • Club: {req.club || 'None'}
                                    </div>
                                    <div className="text-xs text-muted-foreground mt-1">
                                        Submitted: {new Date(req.submittedAt).toLocaleDateString()}
                                    </div>

                                    <div className="mt-2">
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-500 hover:underline flex items-center gap-1"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                            View Video Proof
                                        </a>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-2 w-full md:w-auto">
                                    {reviewingId === req.id ? (
                                        <div className="flex items-center gap-2 text-muted-foreground">
                                            <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                                            Processing...
                                        </div>
                                    ) : (
                                        <>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => handleReview(req.id, 'approve')}
                                                    className="flex-1 px-4 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700"
                                                >
                                                    Approve
                                                </button>
                                                <button
                                                    onClick={() => handleReview(req.id, 'reject')}
                                                    className="flex-1 px-4 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700"
                                                >
                                                    Reject
                                                </button>
                                            </div>
                                            <input
                                                type="text"
                                                placeholder="Rejection reason (optional)"
                                                className="text-sm bg-background border border-input rounded px-2 py-1 w-full"
                                                value={rejectionReason}
                                                onChange={(e) => setRejectionReason(e.target.value)}
                                            />
                                        </>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
