'use client';

import type React from 'react';
import type { DualRecordingVerification, CpDiffRow } from '@/types/admin';

interface Props {
    open: boolean;
    onClose: () => void;
    riderName: string;
    verification: DualRecordingVerification;
}

const THRESHOLD_LABELS: Record<string, string> = {
    w1200: '20 min (max 5%)',
    w300: '5 min (max 5,5%)',
    w60: '1 min (max 6%)',
    w15: '15 sek (max 6,5%)',
};

function diffColour(pct: number | null | undefined, key: string): string {
    if (pct == null) return 'text-muted-foreground';
    const thresholds: Record<string, number> = { w1200: 5, w300: 5.5, w60: 6, w15: 6.5 };
    const limit = thresholds[key];
    if (limit !== undefined) {
        return pct > limit ? 'text-red-600 font-bold' : 'text-green-600';
    }
    return Math.abs(pct) <= 3 ? 'text-green-600' : Math.abs(pct) <= 8 ? 'text-yellow-600' : 'text-red-600';
}

function StatusHeader({ status, passed }: { status: string; passed?: boolean }) {
    if (status === 'passed') {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-green-100 text-green-800 font-semibold text-sm">
                ✓ Godkendt
            </span>
        );
    }
    if (status === 'failed') {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-red-100 text-red-800 font-semibold text-sm">
                ✗ Underkendtes
            </span>
        );
    }
    if (status === 'missing_strava') {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-yellow-100 text-yellow-800 font-semibold text-sm">
                ? Afventer Strava-data
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold text-sm">
            – Ikke verificeret
        </span>
    );
}

export default function DualRecordingResultModal({ open, onClose, riderName, verification }: Props) {
    if (!open) return null;

    const { status, verifiedAt, comparison, failingMetrics = [], stravaActivityId, zwiftActivityId } = verification;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold text-foreground">Dual Recording</h2>
                        <p className="text-sm text-muted-foreground">{riderName}</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-muted-foreground hover:text-foreground text-xl leading-none px-2"
                        aria-label="Luk"
                    >
                        ×
                    </button>
                </div>

                <div className="px-6 py-4 space-y-4">
                    {/* Status */}
                    <div className="flex items-center justify-between">
                        <StatusHeader status={status} passed={verification.passed} />
                        {verifiedAt && (
                            <span className="text-xs text-muted-foreground">
                                {new Date(verifiedAt).toLocaleString('da-DK')}
                            </span>
                        )}
                    </div>

                    {/* Missing Strava message */}
                    {status === 'missing_strava' && (
                        <div className="rounded-lg bg-yellow-50 border border-yellow-200 px-4 py-3 text-sm text-yellow-800">
                            Ingen Strava-aktivitet fundet inden for 4 timer af Zwift-aktiviteten.
                            Rytteren har muligvis ikke forbundet Strava, eller aktiviteten er endnu ikke synkroniseret.
                        </div>
                    )}

                    {/* Missing activity message */}
                    {(status === 'missing_activity' || status === 'error') && (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
                            {status === 'missing_activity'
                                ? 'Ingen Zwift-aktivitet fundet for dette løb.'
                                : 'Verifikation fejlede. Prøv igen via "Verificer DR"-knappen.'}
                        </div>
                    )}

                    {/* Comparison table */}
                    {comparison && comparison.cpDiff && comparison.cpDiff.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-foreground mb-2">CP-sammenligning (Zwift vs Strava)</h3>
                            <div className="overflow-x-auto rounded-lg border border-border">
                                <table className="w-full text-sm text-left">
                                    <thead className="bg-muted/20 text-xs text-muted-foreground">
                                        <tr>
                                            <th className="px-3 py-2">Varighed</th>
                                            <th className="px-3 py-2 text-right">Zwift (W)</th>
                                            <th className="px-3 py-2 text-right">Strava (W)</th>
                                            <th className="px-3 py-2 text-right">Afvigelse</th>
                                            <th className="px-3 py-2 text-center w-16">Grænse</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-border">
                                        {comparison.cpDiff.map((row: CpDiffRow) => {
                                            const isFailing = failingMetrics.includes(row.key);
                                            return (
                                                <tr key={row.key} className={isFailing ? 'bg-red-50 dark:bg-red-950/20' : ''}>
                                                    <td className="px-3 py-2 font-medium">
                                                        {row.label}
                                                        {THRESHOLD_LABELS[row.key] && (
                                                            <span className="ml-1 text-xs text-muted-foreground">
                                                                ({THRESHOLD_LABELS[row.key].split('(')[1]?.replace(')', '')})
                                                            </span>
                                                        )}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono">
                                                        {row.zwift != null ? Math.round(row.zwift) : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-right font-mono">
                                                        {row.strava != null ? Math.round(row.strava) : '—'}
                                                    </td>
                                                    <td className={`px-3 py-2 text-right font-mono ${diffColour(row.diffPct, row.key)}`}>
                                                        {row.diffPct != null
                                                            ? `${row.diffPct >= 0 ? '+' : ''}${row.diffPct.toFixed(1)}%`
                                                            : '—'}
                                                    </td>
                                                    <td className="px-3 py-2 text-center">
                                                        {isFailing
                                                            ? <span className="text-red-600 font-bold">✗</span>
                                                            : row.diffPct != null
                                                                ? <span className="text-green-600">✓</span>
                                                                : '—'}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {/* Average power */}
                    {comparison?.avgPower && (
                        <div className="rounded-lg bg-muted/10 border border-border px-4 py-3 text-sm">
                            <div className="flex justify-between">
                                <span className="text-muted-foreground">Gennemsnit (synkroniseret)</span>
                                <span className="font-mono">
                                    {comparison.avgPower.zwift != null ? `${Math.round(comparison.avgPower.zwift)}W` : '—'}
                                    {' / '}
                                    {comparison.avgPower.strava != null ? `${Math.round(comparison.avgPower.strava)}W` : '—'}
                                    {comparison.avgPower.diffPct != null && (
                                        <span className={`ml-2 ${diffColour(comparison.avgPower.diffPct, '')}`}>
                                            ({comparison.avgPower.diffPct >= 0 ? '+' : ''}{comparison.avgPower.diffPct.toFixed(1)}%)
                                        </span>
                                    )}
                                </span>
                            </div>
                        </div>
                    )}

                    {/* Thresholds reference */}
                    <div className="text-xs text-muted-foreground border-t border-border pt-3">
                        <p className="font-semibold mb-1">Grænseværdier (Zwift vs Strava):</p>
                        <p>20 min: max 5% · 5 min: max 5,5% · 1 min: max 6% · 15 sek: max 6,5%</p>
                    </div>
                </div>
            </div>
        </div>
    );
}
