'use client';

import type { WeightVerificationRecord } from '@/types/admin';

interface Props {
    verification: WeightVerificationRecord | undefined;
}

export default function WeightVerificationStatusBadge({ verification }: Props) {
    if (!verification) return null;

    const status = String(verification.status || '').toLowerCase();
    let icon = '?';
    let colorClass = 'bg-slate-100 text-slate-600 border-slate-300';
    let title = 'Weight verification: Unknown status';

    if (status === 'pending') {
        icon = 'P';
        colorClass = 'bg-amber-100 text-amber-700 border-amber-300';
        title = 'Weight verification: Pending submission';
    } else if (status === 'submitted') {
        icon = 'S';
        colorClass = 'bg-blue-100 text-blue-700 border-blue-300';
        title = 'Weight verification: Submitted, awaiting review';
    } else if (status === 'approved') {
        icon = '✓';
        colorClass = 'bg-green-100 text-green-700 border-green-300';
        title = 'Weight verification: Approved';
    } else if (status === 'rejected') {
        icon = '✗';
        colorClass = 'bg-red-100 text-red-700 border-red-300';
        title = verification.rejectionReason
            ? `Weight verification: Rejected\nReason: ${verification.rejectionReason}`
            : 'Weight verification: Rejected';
    } else if (status === 'revoked') {
        icon = 'R';
        colorClass = 'bg-slate-100 text-slate-700 border-slate-300';
        title = 'Weight verification: Request revoked';
    } else if (status === 'none') {
        icon = '–';
        colorClass = 'bg-slate-100 text-slate-500 border-slate-300';
        title = 'Weight verification: No active request';
    }

    return (
        <span
            title={title}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold ${colorClass}`}
            aria-label={title}
        >
            {icon}
        </span>
    );
}
