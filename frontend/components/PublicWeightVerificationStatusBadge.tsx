'use client';

interface Props {
    status?: string;
}

export default function PublicWeightVerificationStatusBadge({ status }: Props) {
    const normalized = String(status || '').trim().toLowerCase();

    let icon: string | null = null;
    let colorClass = '';
    let title = '';

    if (normalized === 'pending' || normalized === 'submitted') {
        icon = 'P';
        colorClass = 'bg-yellow-100 text-yellow-700 border-yellow-300';
        title = 'Pending';
    } else if (normalized === 'approved') {
        icon = '✓';
        colorClass = 'bg-green-100 text-green-700 border-green-300';
        title = 'Accepted';
    } else if (normalized === 'rejected') {
        icon = '✗';
        colorClass = 'bg-red-100 text-red-700 border-red-300';
        title = 'Rejected';
    }

    if (!icon) return null;

    return (
        <span
            title={title}
            aria-label={title}
            className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold ${colorClass}`}
        >
            {icon}
        </span>
    );
}
