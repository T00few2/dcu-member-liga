'use client';

import type React from 'react';
import { useState } from 'react';
import { RecordingStreamsSection } from '@/components/shared/RecordingStreamsSection';
import { ExtendedPeakProfileChart } from '@/components/shared/ExtendedPeakProfileChart';
import type { DualRecordingVerification, CpDiffRow } from '@/types/admin';
import type { DualRecordingResult } from '@/hooks/useDualRecording';
import { explainDrFailureMetrics } from '@/lib/drFailureLabels';

interface Props {
    open: boolean;
    onClose: () => void;
    riderName: string;
    verification: DualRecordingVerification;
    onRunForRider?: () => Promise<void>;
    runForRiderBusy?: boolean;
    runForRiderStatus?: { type: 'info' | 'success' | 'error'; text: string } | null;
    streamResult?: DualRecordingResult | null;
    streamLoading?: boolean;
    streamError?: string | null;
    hideHeartRate?: boolean;
    showRunActions?: boolean;
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
        return Math.abs(pct) > limit ? 'text-red-600 font-bold' : 'text-green-600';
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
    if (status === 'missing_activity') {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-100 text-amber-800 font-semibold text-sm">
                ! Mangler Zwift-aktivitet
            </span>
        );
    }
    if (status === 'error') {
        return (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-200 text-slate-800 font-semibold text-sm">
                ! Verifikation fejlede
            </span>
        );
    }
    return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-100 text-slate-700 font-semibold text-sm">
            – Ikke verificeret
        </span>
    );
}

function formatSelectionReason(reason: string | undefined): string {
    switch (reason) {
        case 'manual_strava_id':
            return 'Manual Strava activity selected';
        case 'lowest_similarity':
            return 'Selected by lowest similarity score';
        case 'best_overlap':
            return 'Selected by best overlap window';
        case 'no_meaningful_overlap':
            return 'No meaningful overlap candidates';
        case 'invalid_zwift_window':
            return 'Invalid Zwift duration window';
        case 'manual_strava_id_not_found':
            return 'Manual Strava activity not found';
        default:
            return reason || 'Not specified';
    }
}


export default function DualRecordingResultModal({
    open,
    onClose,
    riderName,
    verification,
    onRunForRider,
    runForRiderBusy = false,
    runForRiderStatus = null,
    streamResult = null,
    streamLoading = false,
    streamError = null,
    hideHeartRate = false,
    showRunActions = true,
}: Props) {
    const [hoveredDurationSec, setHoveredDurationSec] = useState<number | null>(null);

    if (!open) return null;

    const { status, verifiedAt, comparison, failingMetrics = [], stravaActivityId, zwiftActivityId } = verification;
    const cpDiffRows = streamResult?.comparison?.cpDiff ?? comparison?.cpDiff ?? [];
    const failureReasons = explainDrFailureMetrics(failingMetrics);
    const matchingDebug = streamResult?.matchingDebug;
    const candidates = (matchingDebug?.candidates || []).filter((c) => (c.overlapSec || 0) > 0);
    const hasStravaCandidates = (matchingDebug?.candidates?.length || 0) > 0;

    return (
        <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
            onClick={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg md:max-w-2xl lg:max-w-5xl xl:max-w-6xl max-h-[90vh] overflow-y-auto">
                {/* Header */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-border">
                    <div>
                        <h2 className="text-lg font-bold text-foreground">Verification</h2>
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
                    {showRunActions && onRunForRider && (
                        <div className="space-y-2">
                            <button
                                onClick={() => void onRunForRider()}
                                disabled={runForRiderBusy}
                                className="text-xs bg-blue-600 text-white px-3 py-1 rounded hover:opacity-90 font-medium disabled:opacity-50 inline-flex items-center gap-2"
                            >
                                {runForRiderBusy && (
                                    <span className="inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin" />
                                )}
                                {runForRiderBusy ? 'Kører...' : 'Run Verification for this rider'}
                            </button>
                            {runForRiderStatus && (
                                <div className={`text-xs ${
                                    runForRiderStatus.type === 'success'
                                        ? 'text-green-600'
                                        : runForRiderStatus.type === 'error'
                                            ? 'text-red-600'
                                            : 'text-muted-foreground'
                                }`}>
                                    {runForRiderStatus.text}
                                </div>
                            )}
                        </div>
                    )}

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
                            {hasStravaCandidates
                                ? 'No matching Strava activities found.'
                                : 'No Strava activities found.'}
                        </div>
                    )}

                    {/* Missing activity message */}
                    {(status === 'missing_activity' || status === 'error') && (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
                            {status === 'missing_activity'
                                ? 'Ingen Zwift-aktivitet fundet for dette løb.'
                                : 'Verifikation fejlede. Prøv igen via "Run Verification"-knappen.'}
                        </div>
                    )}

                    {matchingDebug && (
                        <details className="rounded-lg border border-border bg-muted/10 px-4 py-3 text-xs">
                            <summary className="font-semibold text-foreground cursor-pointer select-none">
                                Strava matching debug
                            </summary>
                            <div className="mt-2 space-y-2">
                                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 text-muted-foreground">
                                    <div>Reason: <span className="text-foreground">{formatSelectionReason(matchingDebug.selectionReason)}</span></div>
                                    <div>Anchor: <span className="text-foreground">{matchingDebug.anchorUsed || 'n/a'}</span></div>
                                    <div>Fallback used: <span className="text-foreground">{matchingDebug.anchorFallbackUsed ? 'yes' : 'no'}</span></div>
                                    <div>Min overlap: <span className="text-foreground">{matchingDebug.minOverlapSec ?? 'n/a'}s</span></div>
                                    <div>Meaningful candidates: <span className="text-foreground">{matchingDebug.meaningfulCandidateCount ?? 0}</span></div>
                                    <div>Chosen activity: <span className="text-foreground">{matchingDebug.chosenActivityId || 'none'}</span></div>
                                </div>
                                {candidates.length > 0 && (
                                    <div className="overflow-x-auto rounded border border-border">
                                        <table className="w-full text-xs">
                                            <thead className="bg-muted/20 text-muted-foreground">
                                                <tr>
                                                    <th className="px-2 py-1 text-left">Activity</th>
                                                    <th className="px-2 py-1 text-right">Overlap</th>
                                                    <th className="px-2 py-1 text-right">End Δ</th>
                                                    <th className="px-2 py-1 text-right">Sim.</th>
                                                    <th className="px-2 py-1 text-center">Flags</th>
                                                </tr>
                                            </thead>
                                            <tbody className="divide-y divide-border">
                                                {candidates.map((c) => (
                                                    <tr key={`${c.activityId}-${c.startDate || ''}`} className={c.selected ? 'bg-green-50 dark:bg-green-900/20' : ''}>
                                                        <td className="px-2 py-1 font-mono">
                                                            {c.activityId}
                                                        </td>
                                                        <td className="px-2 py-1 text-right">{c.overlapSec ?? 0}s</td>
                                                        <td className="px-2 py-1 text-right">{c.endDeltaSec ?? 0}s</td>
                                                        <td className="px-2 py-1 text-right">
                                                            {c.similarityScore == null ? '—' : c.similarityScore.toFixed(4)}
                                                        </td>
                                                        <td className="px-2 py-1 text-center">
                                                            {c.selected ? 'picked' : ''}
                                                            {c.meaningful ? (c.selected ? ' · meaningful' : 'meaningful') : (c.selected ? '' : 'low overlap')}
                                                        </td>
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </details>
                    )}

                    {status === 'failed' && failureReasons.length > 0 && (
                        <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3 text-sm text-red-800">
                            <div className="font-semibold mb-1">Failure reasons</div>
                            <ul className="list-disc ml-5 space-y-0.5">
                                {failureReasons.map((reason) => (
                                    <li key={reason}>{reason}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {/* On large screens: graphs left (peak profile + recording streams),
                        CP table + avg power + thresholds right */}
                    <div className="lg:grid lg:grid-cols-[1.6fr_1fr] lg:gap-6 lg:items-start space-y-4 lg:space-y-0">

                        {/* Left column: peak profile directly above recording streams */}
                        <div className="space-y-3">
                            {streamResult && cpDiffRows.length > 0 && (
                                <div>
                                    <h3 className="text-sm font-semibold text-foreground mb-2">Peak Profile by Duration (Extended)</h3>
                                    <ExtendedPeakProfileChart result={streamResult} cpDiff={cpDiffRows} onDurationHover={setHoveredDurationSec} />
                                </div>
                            )}

                            <div className="border-t border-border pt-3">
                                <h3 className="text-sm font-semibold text-foreground mb-2">Recording Streams</h3>
                                {streamLoading ? (
                                    <div className="text-xs text-muted-foreground inline-flex items-center gap-2">
                                        <span className="inline-block w-3 h-3 border-2 border-current border-r-transparent rounded-full animate-spin" />
                                        Loading stream comparison...
                                    </div>
                                ) : streamError ? (
                                    <div className="text-xs text-red-600">{streamError}</div>
                                ) : streamResult ? (
                                    <RecordingStreamsSection
                                        result={streamResult}
                                        hideHeartRate={hideHeartRate}
                                        zwiftColor="#2563eb"
                                        stravaColor="#FC4C02"
                                        height={280}
                                        highlightDurationSec={hoveredDurationSec}
                                    />
                                ) : (
                                    <div className="text-xs text-muted-foreground">No stream data available.</div>
                                )}
                            </div>
                        </div>

                        {/* Right column: table + avg power + thresholds */}
                        <div className="space-y-4">
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

                            <div className="text-xs text-muted-foreground border-t border-border pt-3">
                                <p className="font-semibold mb-1">Grænseværdier (Zwift vs Strava):</p>
                                <p>20 min: max 5% · 5 min: max 5,5% · 1 min: max 6% · 15 sek: max 6,5%</p>
                            </div>
                        </div>

                    </div>
                </div>
            </div>
        </div>
    );
}

