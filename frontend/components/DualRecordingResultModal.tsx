'use client';

import type React from 'react';
import { useMemo, useState } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Brush, ReferenceArea,
} from 'recharts';
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
                            <RecordingStreamsChart result={streamResult} hideHeartRate={hideHeartRate} />
                        ) : (
                            <div className="text-xs text-muted-foreground">No stream data available.</div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

const CHART_STEP = 5;
const IDENTICAL_TOLERANCE_W = 3;
const IDENTICAL_MIN_INTERVAL_SEC = 90;
const MAX_MEAN_ABS_DIFF_W = 5;
const MAX_STD_DIFF_W = 6;
const MAX_STD_DELTA_DIFF_W = 3;
const MIN_OVERLAP_SEC_FOR_SIMILARITY = 180;

function fmtRaceTime(sec: number) {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function RecordingStreamsChart({
    result,
    hideHeartRate = false,
}: {
    result: DualRecordingResult;
    hideHeartRate?: boolean;
}) {
    const { zwift, strava } = result;
    const [hidden, setHidden] = useState<Set<string>>(
        () => new Set(['zwiftHR', 'stravaHR', 'zwiftCad', 'stravaCad', 'zwiftAlt', 'stravaAlt'])
    );

    const hasZwift = (zwift.streams?.time?.length ?? 0) > 0;
    const hasStrava = (strava?.streams?.time?.length ?? 0) > 0;
    if (!hasZwift && !hasStrava) return <div className="text-xs text-muted-foreground">No stream samples.</div>;

    type StreamPoint = { w: number | null; hr: number | null; cad: number | null; alt: number | null };
    type ChartRow = {
        t: number;
        zwiftW: number | null; stravaW: number | null;
        zwiftHR: number | null; stravaHR: number | null;
        zwiftCad: number | null; stravaCad: number | null;
        zwiftAlt: number | null; stravaAlt: number | null;
    };

    const chartData = useMemo<ChartRow[]>(() => {
        const bucket = (t: number) => Math.round(t / CHART_STEP) * CHART_STEP;

        const zwiftByTime = new Map<number, StreamPoint>();
        if (hasZwift && zwift.streams) {
            const { time, watts, heartrate, cadence, altitude } = zwift.streams;
            time.forEach((t, i) => zwiftByTime.set(bucket(t), {
                w: watts[i] ?? null,
                hr: heartrate[i] ?? null,
                cad: cadence[i] ?? null,
                alt: altitude[i] ?? null,
            }));
        }

        const stravaByTime = new Map<number, StreamPoint>();
        if (hasStrava && strava?.streams) {
            const { time, watts, heartrate, cadence, altitude } = strava.streams;
            time.forEach((t, i) => stravaByTime.set(bucket(t), {
                w: watts[i] ?? null,
                hr: heartrate[i] ?? null,
                cad: cadence[i] ?? null,
                alt: altitude[i] ?? null,
            }));
        }

        const allT = [...(zwift.streams?.time || []), ...(strava?.streams?.time || [])].map(bucket);
        const minT = Math.floor(Math.min(...allT) / CHART_STEP) * CHART_STEP;
        const maxT = Math.ceil(Math.max(...allT) / CHART_STEP) * CHART_STEP;

        const rows: ChartRow[] = [];
        for (let t = minT; t <= maxT; t += CHART_STEP) {
            const zp = zwiftByTime.get(t);
            const sp = stravaByTime.get(t);
            rows.push({
                t,
                zwiftW: zp?.w ?? null,
                stravaW: sp?.w ?? null,
                zwiftHR: zp?.hr ?? null,
                stravaHR: sp?.hr ?? null,
                zwiftCad: zp?.cad ?? null,
                stravaCad: sp?.cad ?? null,
                zwiftAlt: zp?.alt ?? null,
                stravaAlt: sp?.alt ?? null,
            });
        }
        return rows;
    }, [hasZwift, hasStrava, zwift.streams, strava?.streams]);

    const similarity = useMemo(() => {
        const paired = chartData
            .map((d) => {
                if (d.zwiftW == null || d.stravaW == null) return null;
                const signed = d.zwiftW - d.stravaW;
                return {
                    t: d.t,
                    signed,
                    abs: Math.abs(signed),
                };
            })
            .filter((v): v is { t: number; signed: number; abs: number } => v != null);

        if (paired.length === 0) {
            return null;
        }

        const absDiffs = paired.map((p) => p.abs);
        const signedDiffs = paired.map((p) => p.signed);
        const sortedAbs = [...absDiffs].sort((a, b) => a - b);
        const meanAbs = absDiffs.reduce((acc, n) => acc + n, 0) / absDiffs.length;
        const p95 = sortedAbs[Math.min(sortedAbs.length - 1, Math.floor(sortedAbs.length * 0.95))];
        const max = sortedAbs[sortedAbs.length - 1];
        const nearIdenticalSamples = absDiffs.filter((d) => d <= IDENTICAL_TOLERANCE_W).length;
        const nearIdenticalPct = (nearIdenticalSamples / absDiffs.length) * 100;

        const std = (values: number[]): number => {
            if (values.length === 0) return 0;
            const mean = values.reduce((acc, n) => acc + n, 0) / values.length;
            const variance = values.reduce((acc, n) => acc + ((n - mean) ** 2), 0) / values.length;
            return Math.sqrt(variance);
        };
        const stdDiff = std(signedDiffs);

        const deltaDiffs: number[] = [];
        for (let i = 1; i < paired.length; i++) {
            deltaDiffs.push(paired[i].signed - paired[i - 1].signed);
        }
        const stdDeltaDiff = std(deltaDiffs);

        let longestNearIdenticalRunSamples = 0;
        let currentRun = 0;
        paired.forEach((p) => {
            if (p.abs <= IDENTICAL_TOLERANCE_W) {
                currentRun += 1;
                if (currentRun > longestNearIdenticalRunSamples) longestNearIdenticalRunSamples = currentRun;
            } else {
                currentRun = 0;
            }
        });
        const longestNearIdenticalRunSec = longestNearIdenticalRunSamples * CHART_STEP;
        const overlapSec = paired.length * CHART_STEP;
        const suspiciousByVolatility = (
            overlapSec >= MIN_OVERLAP_SEC_FOR_SIMILARITY &&
            meanAbs <= MAX_MEAN_ABS_DIFF_W &&
            stdDiff <= MAX_STD_DIFF_W &&
            stdDeltaDiff <= MAX_STD_DELTA_DIFF_W
        );
        const suspiciousByRun = longestNearIdenticalRunSec >= IDENTICAL_MIN_INTERVAL_SEC || nearIdenticalPct >= 80;
        const suspicious = suspiciousByVolatility || suspiciousByRun;

        return {
            samples: absDiffs.length,
            overlapSec,
            meanAbsDiff: meanAbs,
            p95Diff: p95,
            maxDiff: max,
            stdDiff,
            stdDeltaDiff,
            nearIdenticalPct,
            longestNearIdenticalRunSec,
            suspiciousByVolatility,
            suspiciousByRun,
            suspicious,
        };
    }, [chartData]);

    const hasSeries = useMemo(() => {
        const hasAny = (key: keyof ChartRow) => chartData.some((row) => row[key] != null);
        return {
            zwiftW: hasAny('zwiftW'),
            stravaW: hasAny('stravaW'),
            zwiftHR: !hideHeartRate && hasAny('zwiftHR'),
            stravaHR: !hideHeartRate && hasAny('stravaHR'),
            zwiftCad: hasAny('zwiftCad'),
            stravaCad: hasAny('stravaCad'),
            zwiftAlt: hasAny('zwiftAlt'),
            stravaAlt: hasAny('stravaAlt'),
        };
    }, [chartData, hideHeartRate]);

    const zwiftStreamStartSec  = chartData.find(row => row.zwiftW  !== null)?.t ?? 0;
    const firstStravaDataT     = chartData.find(row => row.stravaW !== null)?.t ?? null;
    const gapSec = (hasZwift && hasStrava && firstStravaDataT != null)
        ? Math.max(0, firstStravaDataT - zwiftStreamStartSec)
        : 0;
    const zwiftStreamDurationSec = hasZwift && zwift.streams
        ? (zwift.streams.time[zwift.streams.time.length - 1] - zwiftStreamStartSec)
        : 0;
    const gapFraction = gapSec > 0 && zwiftStreamDurationSec > 0
        ? gapSec / zwiftStreamDurationSec : 0;
    const gapExceedsLimit = gapFraction > 0.15;
    const showGapOverlay = gapSec > 0;

    function fmtGapLabel(sec: number, frac: number): string {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        const time = m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
        return `Strava gap: ${time} (${(frac * 100).toFixed(1)}%)`;
    }

    const seriesMeta = [
        { key: 'zwiftW', label: 'Zwift Power', color: '#2563eb', show: hasSeries.zwiftW },
        { key: 'stravaW', label: 'Strava Power', color: '#FC4C02', show: hasSeries.stravaW },
        { key: 'zwiftHR', label: 'Zwift HR', color: '#a0a0a0', show: hasSeries.zwiftHR },
        { key: 'stravaHR', label: 'Strava HR', color: '#8b8b8b', show: hasSeries.stravaHR },
        { key: 'zwiftCad', label: 'Zwift Cad', color: '#66b3a6', show: hasSeries.zwiftCad },
        { key: 'stravaCad', label: 'Strava Cad', color: '#4fa18f', show: hasSeries.stravaCad },
        { key: 'zwiftAlt', label: 'Zwift Elev', color: '#c9c9c9', show: hasSeries.zwiftAlt },
        { key: 'stravaAlt', label: 'Strava Elev', color: '#b5b5b5', show: hasSeries.stravaAlt },
    ].filter((s) => s.show);

    return (
        <div className="w-full">
            {similarity && (
                <div className={`mb-2 rounded-md border px-3 py-2 text-xs ${
                    similarity.suspicious
                        ? 'border-amber-300 bg-amber-50 text-amber-900'
                        : 'border-border bg-muted/20 text-muted-foreground'
                }`}>
                    <div className="font-semibold mb-1">Power similarity check</div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1">
                        <div>Mean |diff|: <span className="font-mono">{similarity.meanAbsDiff.toFixed(1)} W</span></div>
                        <div>P95 diff: <span className="font-mono">{similarity.p95Diff.toFixed(1)} W</span></div>
                        <div>Max diff: <span className="font-mono">{similarity.maxDiff.toFixed(1)} W</span></div>
                        <div>Samples: <span className="font-mono">{similarity.samples}</span></div>
                        <div>Overlap: <span className="font-mono">{Math.round(similarity.overlapSec)}s</span></div>
                        <div>Std(diff): <span className="font-mono">{similarity.stdDiff.toFixed(2)} W</span></div>
                        <div>Std(Δdiff): <span className="font-mono">{similarity.stdDeltaDiff.toFixed(2)} W</span></div>
                        <div>Near-identical (&lt;= {IDENTICAL_TOLERANCE_W}W): <span className="font-mono">{similarity.nearIdenticalPct.toFixed(1)}%</span></div>
                        <div>Longest near-identical run: <span className="font-mono">{Math.round(similarity.longestNearIdenticalRunSec)}s</span></div>
                    </div>
                    <div className="mt-1">
                        {similarity.suspicious
                            ? `Suspiciously similar power traces (${similarity.suspiciousByVolatility ? 'volatility' : 'run-length'} trigger). This can indicate shared recording source.`
                            : 'Similarity level looks plausible for independent recordings.'}
                    </div>
                </div>
            )}
            <div className="text-[11px] text-muted-foreground mb-1">
                t=0 = Zwift recording start · Strava aligned by power MSE · click legend to toggle
            </div>
            {showGapOverlay && gapExceedsLimit && (
                <p className="text-xs text-amber-700 mb-2">
                    {fmtGapLabel(gapSec, gapFraction)} — gap exceeds 15%, Zwift stream not cropped. Comparison may be distorted.
                </p>
            )}
            {showGapOverlay && !gapExceedsLimit && (
                <p className="text-xs text-blue-700 mb-2">
                    Strava recording gap: {fmtGapLabel(gapSec, gapFraction)} — Zwift stream cropped to match.
                </p>
            )}
            {hasZwift && hasStrava && !showGapOverlay && (
                <p className="text-xs text-green-700 mb-2">
                    No Strava recording gap detected — both streams start at the same point.
                </p>
            )}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 px-1">
                {seriesMeta.map((s) => (
                    <button
                        key={s.key}
                        onClick={() => {
                            setHidden((prev) => {
                                const next = new Set(prev);
                                if (next.has(s.key)) next.delete(s.key);
                                else next.add(s.key);
                                return next;
                            });
                        }}
                        className="flex items-center gap-1.5 text-xs select-none"
                        style={{
                            opacity: hidden.has(s.key) ? 0.35 : 1,
                            textDecoration: hidden.has(s.key) ? 'line-through' : 'none',
                            color: 'var(--muted-foreground)',
                        }}
                    >
                        <span
                            className="inline-block w-4 h-[2px] rounded flex-shrink-0"
                            style={{ backgroundColor: s.color }}
                        />
                        {s.label}
                    </button>
                ))}
            </div>
            <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} />
                        <XAxis dataKey="t" tickFormatter={fmtRaceTime} tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="w" tick={{ fontSize: 10 }} width={34} />
                        <YAxis yAxisId="other" orientation="right" tick={{ fontSize: 10 }} width={30} />
                        <Tooltip labelFormatter={(v) => fmtRaceTime(Number(v))} />

                        {/* Draw Strava first, then Zwift on top so overlap remains visible */}
                        {hasSeries.stravaW && (
                            <Line
                                yAxisId="w"
                                type="monotone"
                                dataKey="stravaW"
                                stroke="#FC4C02"
                                dot={false}
                                strokeWidth={1.8}
                                strokeDasharray="5 3"
                                strokeOpacity={0.9}
                                name="Strava Power"
                                hide={hidden.has('stravaW')}
                            />
                        )}
                        {hasSeries.zwiftW && (
                            <Line
                                yAxisId="w"
                                type="monotone"
                                dataKey="zwiftW"
                                stroke="#2563eb"
                                dot={false}
                                strokeWidth={1.8}
                                name="Zwift Power"
                                hide={hidden.has('zwiftW')}
                            />
                        )}
                        {hasSeries.zwiftHR && <Line yAxisId="other" type="monotone" dataKey="zwiftHR" stroke="#a0a0a0" dot={false} strokeWidth={1} name="Zwift HR" hide={hidden.has('zwiftHR')} />}
                        {hasSeries.stravaHR && <Line yAxisId="other" type="monotone" dataKey="stravaHR" stroke="#8b8b8b" dot={false} strokeWidth={1} name="Strava HR" hide={hidden.has('stravaHR')} />}
                        {hasSeries.zwiftCad && <Line yAxisId="other" type="monotone" dataKey="zwiftCad" stroke="#66b3a6" dot={false} strokeWidth={1} name="Zwift Cad" hide={hidden.has('zwiftCad')} />}
                        {hasSeries.stravaCad && <Line yAxisId="other" type="monotone" dataKey="stravaCad" stroke="#4fa18f" dot={false} strokeWidth={1} name="Strava Cad" hide={hidden.has('stravaCad')} />}
                        {hasSeries.zwiftAlt && <Line yAxisId="other" type="monotone" dataKey="zwiftAlt" stroke="#c9c9c9" dot={false} strokeWidth={1} name="Zwift Elev" hide={hidden.has('zwiftAlt')} />}
                        {hasSeries.stravaAlt && <Line yAxisId="other" type="monotone" dataKey="stravaAlt" stroke="#b5b5b5" dot={false} strokeWidth={1} name="Strava Elev" hide={hidden.has('stravaAlt')} />}
                        <Brush dataKey="t" tickFormatter={fmtRaceTime} height={20} />
                        {showGapOverlay && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={zwiftStreamStartSec}
                                x2={zwiftStreamStartSec + gapSec}
                                fill={gapExceedsLimit ? '#f59e0b' : '#6b7280'}
                                fillOpacity={0.12}
                                strokeOpacity={0}
                                label={{
                                    value: fmtGapLabel(gapSec, gapFraction) + (gapExceedsLimit ? '' : ' (cropped)'),
                                    position: 'insideTopRight',
                                    fontSize: 9,
                                    fill: gapExceedsLimit ? '#b45309' : '#374151',
                                }}
                            />
                        )}
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
