'use client';

import type React from 'react';
import { useMemo } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
} from 'recharts';
import { RecordingStreamsSection } from '@/components/shared/RecordingStreamsSection';
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
const EXTENDED_PEAK_DURATIONS_SEC = [
    5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1500, 1800,
];

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

function formatDurationTick(sec: number): string {
    if (!Number.isFinite(sec)) return '—';
    if (sec < 60) return `${sec}s`;
    if (sec % 60 === 0) return `${sec / 60}m`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m${s}s`;
}

function durationFromCpRow(row: CpDiffRow): number | null {
    const keyMatch = row.key.match(/^w(\d+)$/);
    if (keyMatch) {
        const sec = Number(keyMatch[1]);
        return Number.isFinite(sec) ? sec : null;
    }
    const label = String(row.label || '').trim().toLowerCase();
    if (label.endsWith('s')) {
        const sec = Number(label.slice(0, -1));
        return Number.isFinite(sec) ? sec : null;
    }
    if (label.endsWith('m')) {
        const min = Number(label.slice(0, -1));
        return Number.isFinite(min) ? min * 60 : null;
    }
    return null;
}

function computePeaksWithoutInterpolation(
    time: number[] | null | undefined,
    watts: Array<number | null> | null | undefined,
    durationsSec: number[],
): Record<number, number | null> {
    const result: Record<number, number | null> = {};
    if (!time?.length || !watts?.length) {
        durationsSec.forEach((d) => { result[d] = null; });
        return result;
    }

    const points: Array<{ t: number; w: number }> = [];
    for (let i = 0; i < Math.min(time.length, watts.length); i += 1) {
        const t = Number(time[i]);
        const w = watts[i];
        if (!Number.isFinite(t) || w == null || !Number.isFinite(Number(w))) continue;
        points.push({ t, w: Number(w) });
    }
    points.sort((a, b) => a.t - b.t);
    if (!points.length) {
        durationsSec.forEach((d) => { result[d] = null; });
        return result;
    }

    const prefix: number[] = [0];
    for (const p of points) prefix.push(prefix[prefix.length - 1] + p.w);

    for (const duration of durationsSec) {
        if (duration <= 0) {
            result[duration] = null;
            continue;
        }
        let bestAvg: number | null = null;
        let j = 0;
        for (let i = 0; i < points.length; i += 1) {
            if (j < i) j = i;
            while (j < points.length && (points[j].t - points[i].t) < duration) j += 1;
            if (j >= points.length) break;
            const count = j - i + 1;
            if (count <= 0) continue;
            const sum = prefix[j + 1] - prefix[i];
            const avg = sum / count;
            if (bestAvg == null || avg > bestAvg) bestAvg = avg;
        }
        result[duration] = bestAvg != null ? Math.round(bestAvg * 10) / 10 : null;
    }
    return result;
}

function ExtendedPeakProfileChart({
    result,
    cpDiff,
}: {
    result: DualRecordingResult;
    cpDiff: CpDiffRow[];
}) {
    const chartData = useMemo(() => {
        const zwiftPeaks = computePeaksWithoutInterpolation(
            result.zwift.streams?.time,
            result.zwift.streams?.watts as Array<number | null> | undefined,
            EXTENDED_PEAK_DURATIONS_SEC,
        );
        const stravaPeaks = computePeaksWithoutInterpolation(
            result.strava?.streams?.time,
            result.strava?.streams?.watts as Array<number | null> | undefined,
            EXTENDED_PEAK_DURATIONS_SEC,
        );
        const zwiftCpByDuration = new Map<number, number>();
        const stravaCpByDuration = new Map<number, number>();
        for (const row of cpDiff) {
            const d = durationFromCpRow(row);
            if (d == null) continue;
            if (row.zwift != null) zwiftCpByDuration.set(d, row.zwift);
            if (row.strava != null) stravaCpByDuration.set(d, row.strava);
        }
        return EXTENDED_PEAK_DURATIONS_SEC.map((durationSec) => ({
            durationSec,
            zwift: zwiftPeaks[durationSec] ?? zwiftCpByDuration.get(durationSec) ?? null,
            strava: stravaPeaks[durationSec] ?? stravaCpByDuration.get(durationSec) ?? null,
        })).filter((r) => r.zwift != null || r.strava != null);
    }, [result, cpDiff]);

    if (!chartData.length) return null;
    const yValues = chartData.flatMap((row) => [row.zwift, row.strava]).filter((v): v is number => v != null);
    const minPeak = yValues.length ? Math.min(...yValues) : 0;
    const maxPeak = yValues.length ? Math.max(...yValues) : 100;
    const yPadding = Math.max(8, (maxPeak - minPeak) * 0.08);
    const yMin = Math.max(0, Math.floor(minPeak - yPadding));
    const yMax = Math.ceil(maxPeak + yPadding);

    return (
        <div className="space-y-2">
            <div className="h-[260px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} />
                        <XAxis
                            type="number"
                            dataKey="durationSec"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={formatDurationTick}
                            tick={{ fontSize: 10 }}
                        />
                        <YAxis domain={[yMin, yMax]} tick={{ fontSize: 10 }} width={38} />
                        <Tooltip
                            labelFormatter={(sec: number) => `Duration: ${formatDurationTick(Number(sec))}`}
                            formatter={(v: unknown, name: string) => {
                                const numeric = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
                                return Number.isFinite(numeric) ? [`${numeric} W`, name] : ['—', name];
                            }}
                        />
                        <Line
                            type="monotone"
                            dataKey="zwift"
                            name="Zwift"
                            stroke="#2563eb"
                            strokeWidth={2}
                            dot={{ r: 2.5 }}
                            connectNulls={false}
                            isAnimationActive={false}
                        />
                        <Line
                            type="monotone"
                            dataKey="strava"
                            name="Strava"
                            stroke="#FC4C02"
                            strokeWidth={2}
                            strokeDasharray="5 3"
                            dot={{ r: 2.5 }}
                            connectNulls={false}
                            isAnimationActive={false}
                        />
                    </LineChart>
                </ResponsiveContainer>
            </div>
            <p className="text-xs text-muted-foreground">
                Peak profile over more durations. Stream-based (no interpolation) with CP fallback when stream points are unavailable.
            </p>
        </div>
    );
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
    if (!open) return null;

    const { status, verifiedAt, comparison, failingMetrics = [], stravaActivityId, zwiftActivityId } = verification;
    const cpDiffRows = streamResult?.comparison?.cpDiff ?? comparison?.cpDiff ?? [];
    const failureReasons = explainDrFailureMetrics(failingMetrics);
    const matchingDebug = streamResult?.matchingDebug;
    const candidates = (matchingDebug?.candidates || []).filter((c) => (c.overlapSec || 0) > 0);

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
                                {runForRiderBusy ? 'Kører DR...' : 'Perform DR for this rider'}
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
                            Ingen Strava-aktivitet fundet inden for 4 timer af Zwift-aktiviteten.
                            Rytteren har muligvis ikke forbundet Strava, eller aktiviteten er endnu ikke synkroniseret.
                        </div>
                    )}

                    {/* Missing activity message */}
                    {(status === 'missing_activity' || status === 'error') && (
                        <div className="rounded-lg bg-slate-50 border border-slate-200 px-4 py-3 text-sm text-slate-700">
                            {status === 'missing_activity'
                                ? 'Ingen Zwift-aktivitet fundet for dette løb.'
                                : 'Verifikation fejlede. Prøv igen via "Verify Dual Recording"-knappen.'}
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

                    {/* Extended peak profile */}
                    {streamResult && cpDiffRows.length > 0 && (
                        <div>
                            <h3 className="text-sm font-semibold text-foreground mb-2">Peak Profile by Duration (Extended)</h3>
                            <ExtendedPeakProfileChart result={streamResult} cpDiff={cpDiffRows} />
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

                    {/* Streams graph */}
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
                            />
                        ) : (
                            <div className="text-xs text-muted-foreground">No stream data available.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

