'use client';

import { RevisitDecision } from './WeightVerificationList';

export interface RevisitState {
    id: string;
    name: string;
    currentDecision: RevisitDecision;
    currentReason: string;
    weighInDate?: string;
}

export interface WeightVerificationDetailProps {
    revisitState: RevisitState | null;
    revisitDecision: RevisitDecision;
    revisitReason: string;
    revisitWeighInDate: string;
    reviewingId: string | null;
    onDecisionChange: (decision: RevisitDecision) => void;
    onReasonChange: (reason: string) => void;
    onWeighInDateChange: (date: string) => void;
    onClose: () => void;
    onSubmit: () => void;
}

export default function WeightVerificationDetail({
    revisitState,
    revisitDecision,
    revisitReason,
    revisitWeighInDate,
    reviewingId,
    onDecisionChange,
    onReasonChange,
    onWeighInDateChange,
    onClose,
    onSubmit,
}: WeightVerificationDetailProps) {
    if (!revisitState) return null;

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
            <div className="w-full max-w-lg rounded-lg border border-border bg-card p-5 shadow-xl">
                <h3 className="text-lg font-bold text-card-foreground">Revisit verification</h3>
                <p className="text-sm text-muted-foreground mt-1">
                    Rider: <span className="font-semibold text-foreground">{revisitState.name}</span>
                </p>
                <p className="text-xs text-muted-foreground mt-1">
                    Current decision: {revisitState.currentDecision}
                </p>

                <div className="mt-4 space-y-3">
                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">New decision</label>
                        <select
                            value={revisitDecision}
                            onChange={(e) => onDecisionChange(e.target.value as RevisitDecision)}
                            className="w-full p-2 bg-background border border-input rounded text-foreground"
                        >
                            <option value="approve">Approve</option>
                            <option value="reject">Reject</option>
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">Weigh-in date</label>
                        <input
                            type="date"
                            value={revisitWeighInDate}
                            max={new Date().toISOString().slice(0, 10)}
                            onChange={(e) => onWeighInDateChange(e.target.value)}
                            className="w-full p-2 bg-background border border-input rounded text-foreground"
                        />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-muted-foreground mb-1">
                            Text / reason ({revisitDecision === 'reject' ? 'optional but recommended' : 'optional'})
                        </label>
                        <textarea
                            value={revisitReason}
                            onChange={(e) => onReasonChange(e.target.value)}
                            rows={4}
                            className="w-full p-2 bg-background border border-input rounded text-foreground"
                            placeholder="Write reason or note..."
                        />
                    </div>
                </div>

                <div className="mt-5 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={!!reviewingId}
                        className="px-3 py-2 text-sm rounded border border-input hover:bg-secondary disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onSubmit}
                        disabled={!!reviewingId}
                        className="px-3 py-2 text-sm rounded bg-primary text-primary-foreground hover:bg-primary-dark disabled:opacity-50 font-semibold"
                    >
                        {reviewingId ? 'Saving...' : 'Save decision'}
                    </button>
                </div>
            </div>
        </div>
    );
}
