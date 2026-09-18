'use client';

import type { DualRecordingVerification } from '@/types/admin';
import { explainDrFailureMetrics } from '@/lib/drFailureLabels';
import { dualRecordingSourceCopy, isVoluntaryDualRecording } from '@/lib/drSource';

interface Props {
    verification: DualRecordingVerification | undefined;
    onClick: () => void;
}

export default function DualRecordingStatusBadge({ verification, onClick }: Props) {
    if (!verification) return null;
    if (verification.status === 'sw_only') return null;

    const { status } = verification;
    const voluntary = isVoluntaryDualRecording(verification.source);
    const sourceCopy = dualRecordingSourceCopy(verification.source);

    let icon: string;
    let colorClass: string;
    let title: string;

    if (status === 'passed') {
        icon = '✓';
        colorClass = 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200';
        title = 'Dual recording: Godkendt';
    } else if (status === 'failed') {
        icon = '✗';
        colorClass = 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200';
        const reasons = explainDrFailureMetrics(verification.failingMetrics);
        title = reasons.length > 0
            ? `Dual recording: Underkendtes\n- ${reasons.join('\n- ')}`
            : 'Dual recording: Underkendtes';
    } else if (status === 'missing_strava') {
        icon = '?';
        colorClass = 'bg-yellow-100 text-yellow-700 border-yellow-300 hover:bg-yellow-200';
        title = 'Dual recording: No matching Strava activities found';
    } else if (status === 'missing_activity') {
        icon = '!';
        colorClass = 'bg-amber-100 text-amber-700 border-amber-300 hover:bg-amber-200';
        title = 'Dual recording: Mangler Zwift-aktivitet';
    } else if (status === 'error') {
        icon = '!';
        colorClass = 'bg-slate-200 text-slate-700 border-slate-400 hover:bg-slate-300';
        title = 'Dual recording: Verifikation fejlede';
    } else {
        icon = '–';
        colorClass = 'bg-slate-100 text-slate-500 border-slate-300 hover:bg-slate-200';
        title = 'Dual recording: Ikke verificeret';
    }

    const fullTitle = `${title}\n${sourceCopy.title}`;
    const captionClass = voluntary
        ? 'text-slate-500'
        : status === 'failed'
            ? 'text-red-700'
            : 'text-slate-600';

    return (
        <button
            type="button"
            onClick={onClick}
            title={fullTitle}
            className="inline-flex flex-col items-center gap-0.5 cursor-pointer"
            aria-label={fullTitle}
        >
            <span
                className={`inline-flex items-center justify-center w-6 h-6 rounded-full border text-xs font-bold transition-colors ${colorClass} ${voluntary ? 'border-dashed' : ''}`}
            >
                {icon}
            </span>
            <span className={`text-[9px] leading-none font-semibold uppercase tracking-wide whitespace-nowrap ${captionClass}`}>
                {sourceCopy.short}
            </span>
        </button>
    );
}
