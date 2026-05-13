'use client';

import { useMemo } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { DualRecordingResult, CpDiffRow } from '@/hooks/useDualRecording';

// ─── Constants ────────────────────────────────────────────────────────────────

export const EXTENDED_PEAK_DURATIONS_SEC = [
    5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1500, 1800,
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatDurationTick(sec: number): string {
    if (!Number.isFinite(sec)) return '—';
    if (sec < 60) return `${sec}s`;
    if (sec % 60 === 0) return `${sec / 60}m`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m${s}s`;
}

export function durationFromCpRow(row: CpDiffRow): number | null {
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

export function computePeaksWithoutInterpolation(
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
        if (duration <= 0) { result[duration] = null; continue; }
        let bestAvg: number | null = null;
        let j = 0;
        for (let i = 0; i < points.length; i += 1) {
            if (j < i) j = i;
            while (j < points.length && (points[j].t - points[i].t) < duration) j += 1;
            if (j >= points.length) break;
            const avg = (prefix[j + 1] - prefix[i]) / (j - i + 1);
            if (bestAvg == null || avg > bestAvg) bestAvg = avg;
        }
        result[duration] = bestAvg != null ? Math.round(bestAvg * 10) / 10 : null;
    }
    return result;
}

// ─── Component ────────────────────────────────────────────────────────────────

interface ExtendedPeakProfileChartProps {
    result: DualRecordingResult;
    /** Falls back to result.comparison.cpDiff when omitted. */
    cpDiff?: CpDiffRow[];
    onDurationHover?: (durationSec: number | null) => void;
}

export function ExtendedPeakProfileChart({
    result,
    cpDiff: cpDiffProp,
    onDurationHover,
}: ExtendedPeakProfileChartProps) {
    const cpDiff = cpDiffProp ?? result.comparison?.cpDiff ?? [];

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
            if (row.zwift  != null) zwiftCpByDuration.set(d, row.zwift);
            if (row.strava != null) stravaCpByDuration.set(d, row.strava);
        }
        return EXTENDED_PEAK_DURATIONS_SEC
            .map((durationSec) => ({
                durationSec,
                durationLabel: formatDurationTick(durationSec),
                zwift:  zwiftPeaks[durationSec]  ?? zwiftCpByDuration.get(durationSec)  ?? null,
                strava: stravaPeaks[durationSec] ?? stravaCpByDuration.get(durationSec) ?? null,
            }))
            .filter((row) => row.zwift != null || row.strava != null);
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
                    <LineChart
                        data={chartData}
                        margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
                        onMouseMove={(e: unknown) => {
                            const payload = (e as { activePayload?: { payload?: { durationSec?: unknown } }[] })
                                ?.activePayload?.[0]?.payload?.durationSec;
                            if (payload != null) onDurationHover?.(Number(payload));
                        }}
                        onMouseLeave={() => onDurationHover?.(null)}
                    >
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                        <XAxis
                            type="number"
                            dataKey="durationSec"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={formatDurationTick}
                            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                            label={{
                                value: 'Duration',
                                position: 'insideBottom',
                                offset: -2,
                                style: { textAnchor: 'middle', fontSize: 11 },
                            }}
                        />
                        <YAxis
                            domain={[yMin, yMax]}
                            tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                            label={{ value: 'Peak watts', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                        />
                        <Tooltip
                            labelFormatter={(sec: number) => `Duration: ${formatDurationTick(Number(sec))}`}
                            formatter={(v: unknown, name: string) => {
                                const numeric = typeof v === 'number' ? v : (typeof v === 'string' ? Number(v) : NaN);
                                return Number.isFinite(numeric) ? [`${numeric} W`, name] : ['—', name];
                            }}
                        />
                        <Legend verticalAlign="top" height={28} />
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
            <p className="text-xs text-muted-foreground px-1">
                Calculated from recorded stream samples only (no interpolation). A duration is included only where
                the recorded stream can support the full window. Where stream samples are unavailable, the standard
                CP comparison points are used as fallback.
            </p>
        </div>
    );
}
