'use client';

import { formatCopenhagenDateTime } from './utils';

export interface PendingVerification {
    id: string;
    name: string;
    email?: string;
    club: string;
    videoLink: string;
    submittedAt: string | any;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

export interface ActiveRequest {
    id: string;
    name: string;
    email?: string;
    club: string;
    deadline: string | any;
}

export interface ApprovedVerification {
    id: string;
    name: string;
    club: string;
    approvedAt: string | any;
    approvedBy: string;
    videoLink?: string;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

export interface RejectedVerification {
    id: string;
    name: string;
    club: string;
    rejectedAt: string | any;
    rejectedBy: string;
    rejectionReason?: string;
    videoLink?: string;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

export type RevisitDecision = 'approve' | 'reject';

export interface WeightVerificationListProps {
    loading: boolean;
    activeRequests: ActiveRequest[];
    pendingReviews: PendingVerification[];
    approvedList: ApprovedVerification[];
    rejectedList: RejectedVerification[];
    reviewingId: string | null;
    revokingId: string | null;
    rejectionReasons: Record<string, string>;
    onRejectionReasonChange: (id: string, reason: string) => void;
    onRevoke: (id: string) => void;
    onReview: (id: string, action: 'approve' | 'reject') => void;
    onOpenCompose: (target: Pick<PendingVerification, 'id' | 'name' | 'email'>, template?: 'default' | 'awaitingSubmission') => void;
    onOpenRevisit: (id: string, name: string, currentDecision: RevisitDecision, currentReason?: string) => void;
    onRefetch: () => void;
}

export default function WeightVerificationList({
    loading,
    activeRequests,
    pendingReviews,
    approvedList,
    rejectedList,
    reviewingId,
    revokingId,
    rejectionReasons,
    onRejectionReasonChange,
    onRevoke,
    onReview,
    onOpenCompose,
    onOpenRevisit,
    onRefetch,
}: WeightVerificationListProps) {
    return (
        <>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">

                {/* AWAITING SUBMISSION LIST */}
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-card-foreground">Awaiting Submission ({activeRequests.length})</h2>
                    </div>

                    {loading ? (
                        <div className="text-center p-8 text-muted-foreground">Loading...</div>
                    ) : activeRequests.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                            No active requests.
                        </div>
                    ) : (
                        <div className="space-y-3 max-h-[500px] overflow-y-auto">
                            {activeRequests.map(req => (
                                <div key={req.id} className="border border-border rounded p-3 bg-secondary/10 flex justify-between items-center">
                                    <div>
                                        <div className="font-bold text-foreground">{req.name}</div>
                                        <div className="text-xs text-muted-foreground">
                                            {req.club || 'No Club'}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-3">
                                        {req.deadline && (
                                            <div className="text-xs text-orange-600 dark:text-orange-400 font-medium">
                                                Due: {new Date(req.deadline).toLocaleDateString()}
                                            </div>
                                        )}
                                        <button
                                            onClick={() => onOpenCompose({ id: req.id, name: req.name, email: req.email }, 'awaitingSubmission')}
                                            className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 font-medium"
                                        >
                                            Email
                                        </button>
                                        <button
                                            onClick={() => onRevoke(req.id)}
                                            disabled={revokingId === req.id}
                                            className="px-2 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 disabled:opacity-50 font-medium"
                                        >
                                            {revokingId === req.id ? 'Revoking...' : 'Revoke'}
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* PENDING REVIEWS LIST */}
                <div className="bg-card p-6 rounded-lg shadow border border-border">
                    <div className="flex justify-between items-center mb-4">
                        <h2 className="text-xl font-bold text-card-foreground">Pending Reviews ({pendingReviews.length})</h2>
                        <button onClick={onRefetch} className="text-sm text-primary hover:underline">Refresh</button>
                    </div>

                    {loading ? (
                        <div className="text-center p-8 text-muted-foreground">Loading...</div>
                    ) : pendingReviews.length === 0 ? (
                        <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                            No pending reviews. Good job!
                        </div>
                    ) : (
                        <div className="space-y-4">
                            {pendingReviews.map(req => (
                                <div key={req.id} className="border border-border rounded-lg p-4 bg-card flex flex-col gap-3">
                                    <div className="flex justify-between items-start">
                                        <div>
                                            <div className="font-bold text-lg text-foreground">{req.name}</div>
                                            <div className="text-sm text-muted-foreground">
                                                Club: {req.club || 'None'}
                                            </div>
                                            <div className="text-xs text-muted-foreground mt-1">
                                                Submitted: {new Date(req.submittedAt).toLocaleDateString()}
                                            </div>
                                            {req.lastRaceWeightKg != null && (
                                                <div className="text-xs text-muted-foreground mt-1">
                                                    Last race weight: <span className="font-semibold text-foreground">{req.lastRaceWeightKg.toFixed(1)} kg</span>
                                                    {formatCopenhagenDateTime(req.latestProfileUpdatedAt)
                                                        ? ` (updated ${formatCopenhagenDateTime(req.latestProfileUpdatedAt)})`
                                                        : ''}
                                                </div>
                                            )}
                                        </div>
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-blue-500 hover:underline flex items-center gap-1 text-sm font-bold"
                                        >
                                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path></svg>
                                            View Video
                                        </a>
                                    </div>

                                    <button
                                        onClick={() => onOpenCompose({ id: req.id, name: req.name, email: req.email })}
                                        className="self-start px-3 py-2 bg-blue-600 text-white rounded font-bold hover:bg-blue-700 text-sm"
                                    >
                                        Email
                                    </button>

                                    <div className="flex flex-col gap-2 pt-2 border-t border-border mt-2">
                                        {reviewingId === req.id ? (
                                            <div className="flex items-center gap-2 text-muted-foreground justify-center py-2">
                                                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-primary"></div>
                                                Processing...
                                            </div>
                                        ) : (
                                            <>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => onReview(req.id, 'approve')}
                                                        className="flex-1 px-3 py-2 bg-green-600 text-white rounded font-bold hover:bg-green-700 text-sm"
                                                    >
                                                        Approve
                                                    </button>
                                                    <button
                                                        onClick={() => onReview(req.id, 'reject')}
                                                        className="flex-1 px-3 py-2 bg-red-600 text-white rounded font-bold hover:bg-red-700 text-sm"
                                                    >
                                                        Reject
                                                    </button>
                                                </div>
                                                <input
                                                    type="text"
                                                    placeholder="Rejection reason (optional)"
                                                    className="text-sm bg-background border border-input rounded px-2 py-1 w-full"
                                                    value={rejectionReasons[req.id] ?? ''}
                                                    onChange={(e) => onRejectionReasonChange(req.id, e.target.value)}
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

            {/* APPROVED LIST */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-card-foreground">Approved Verifications ({approvedList.length})</h2>
                </div>

                {loading ? (
                    <div className="text-center p-8 text-muted-foreground">Loading...</div>
                ) : approvedList.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                        No approved verifications found.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                        {approvedList.map(req => (
                            <div key={req.id} className="border border-border rounded p-3 bg-secondary/10 flex justify-between items-center">
                                <div>
                                    <div className="font-bold text-foreground">{req.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {req.club || 'No Club'}
                                    </div>
                                    <div className="text-xs text-green-600 dark:text-green-400 font-medium">
                                        Approved: {new Date(req.approvedAt).toLocaleDateString()} by {req.approvedBy}
                                    </div>
                                    {req.lastRaceWeightKg != null && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Registered weight: <span className="font-semibold text-foreground">{req.lastRaceWeightKg.toFixed(1)} kg</span>
                                            {formatCopenhagenDateTime(req.latestProfileUpdatedAt)
                                                ? ` (updated ${formatCopenhagenDateTime(req.latestProfileUpdatedAt)})`
                                                : ''}
                                        </div>
                                    )}
                                    {req.videoLink && (
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                                        >
                                            View submitted video
                                        </a>
                                    )}
                                </div>
                                <button
                                    onClick={() => onOpenRevisit(req.id, req.name, 'approve')}
                                    disabled={reviewingId === req.id}
                                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                                >
                                    {reviewingId === req.id ? 'Updating...' : 'Revisit'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* REJECTED LIST */}
            <div className="bg-card p-6 rounded-lg shadow border border-border">
                <div className="flex justify-between items-center mb-4">
                    <h2 className="text-xl font-bold text-card-foreground">Rejected Verifications ({rejectedList.length})</h2>
                </div>

                {loading ? (
                    <div className="text-center p-8 text-muted-foreground">Loading...</div>
                ) : rejectedList.length === 0 ? (
                    <div className="text-center p-8 text-muted-foreground italic bg-muted/20 rounded">
                        No rejected verifications found.
                    </div>
                ) : (
                    <div className="space-y-3 max-h-[500px] overflow-y-auto">
                        {rejectedList.map(req => (
                            <div key={req.id} className="border border-border rounded p-3 bg-secondary/10 flex justify-between items-center gap-4">
                                <div>
                                    <div className="font-bold text-foreground">{req.name}</div>
                                    <div className="text-xs text-muted-foreground">
                                        {req.club || 'No Club'}
                                    </div>
                                    <div className="text-xs text-red-600 dark:text-red-400 font-medium">
                                        Rejected: {req.rejectedAt ? new Date(req.rejectedAt).toLocaleDateString() : 'Unknown'} by {req.rejectedBy}
                                    </div>
                                    {req.rejectionReason && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Reason: {req.rejectionReason}
                                        </div>
                                    )}
                                    {req.lastRaceWeightKg != null && (
                                        <div className="text-xs text-muted-foreground mt-1">
                                            Registered weight: <span className="font-semibold text-foreground">{req.lastRaceWeightKg.toFixed(1)} kg</span>
                                            {formatCopenhagenDateTime(req.latestProfileUpdatedAt)
                                                ? ` (updated ${formatCopenhagenDateTime(req.latestProfileUpdatedAt)})`
                                                : ''}
                                        </div>
                                    )}
                                    {req.videoLink && (
                                        <a
                                            href={req.videoLink}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                                        >
                                            View submitted video
                                        </a>
                                    )}
                                </div>
                                <button
                                    onClick={() => onOpenRevisit(req.id, req.name, 'reject', req.rejectionReason)}
                                    disabled={reviewingId === req.id}
                                    className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 font-medium"
                                >
                                    {reviewingId === req.id ? 'Updating...' : 'Revisit'}
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    );
}
