'use client';

import type React from 'react';
import { useMemo, useState } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, Brush,
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
}: Props) {
    if (!open) return null;

    const { status, verifiedAt, comparison, failingMetrics = [], stravaActivityId, zwiftActivityId } = verification;
    const failureReasons = explainDrFailureMetrics(failingMetrics);

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
                    {onRunForRider && (
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
                                : 'Verifikation fejlede. Prøv igen via "Verificer DR"-knappen.'}
                        </div>
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
                            <RecordingStreamsChart result={streamResult} />
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

function RecordingStreamsChart({ result }: { result: DualRecordingResult }) {
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
            <div className="text-[11px] text-muted-foreground mb-2">
                t=0 = Zwift recording start · Strava aligned by power MSE · click legend to toggle
            </div>
            <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 8 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.25} />
                        <XAxis dataKey="t" tickFormatter={fmtRaceTime} tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="w" tick={{ fontSize: 10 }} width={34} />
                        <YAxis yAxisId="other" orientation="right" tick={{ fontSize: 10 }} width={30} />
                        <Tooltip labelFormatter={(v) => fmtRaceTime(Number(v))} />
                        <Legend
                            wrapperStyle={{ fontSize: 11, cursor: 'pointer' }}
                            onClick={(entry: any) => {
                                const key = String(entry?.dataKey || '');
                                if (!key) return;
                                setHidden(prev => {
                                    const next = new Set(prev);
                                    if (next.has(key)) next.delete(key); else next.add(key);
                                    return next;
                                });
                            }}
                        />

                        {/* Draw Strava first, then Zwift on top so overlap remains visible */}
                        {!hidden.has('stravaW') && (
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
                            />
                        )}
                        {!hidden.has('zwiftW') && (
                            <Line
                                yAxisId="w"
                                type="monotone"
                                dataKey="zwiftW"
                                stroke="#2563eb"
                                dot={false}
                                strokeWidth={2.2}
                                name="Zwift Power"
                            />
                        )}
                        {!hidden.has('zwiftHR') && <Line yAxisId="other" type="monotone" dataKey="zwiftHR" stroke="#a0a0a0" dot={false} strokeWidth={1} name="Zwift HR" />}
                        {!hidden.has('stravaHR') && <Line yAxisId="other" type="monotone" dataKey="stravaHR" stroke="#8b8b8b" dot={false} strokeWidth={1} name="Strava HR" />}
                        {!hidden.has('zwiftCad') && <Line yAxisId="other" type="monotone" dataKey="zwiftCad" stroke="#66b3a6" dot={false} strokeWidth={1} name="Zwift Cad" />}
                        {!hidden.has('stravaCad') && <Line yAxisId="other" type="monotone" dataKey="stravaCad" stroke="#4fa18f" dot={false} strokeWidth={1} name="Strava Cad" />}
                        {!hidden.has('zwiftAlt') && <Line yAxisId="other" type="monotone" dataKey="zwiftAlt" stroke="#c9c9c9" dot={false} strokeWidth={1} name="Zwift Elev" />}
                        {!hidden.has('stravaAlt') && <Line yAxisId="other" type="monotone" dataKey="stravaAlt" stroke="#b5b5b5" dot={false} strokeWidth={1} name="Strava Elev" />}
                        <Brush dataKey="t" tickFormatter={fmtRaceTime} height={20} />
                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
