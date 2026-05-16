'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Legend,
} from 'recharts';
import type { DualRecordingResult, CpDiffRow } from '@/hooks/useDualRecording';
import { computeSyncedPeakWindows } from '@/lib/dualRecordingSyncedPeaks';

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

// ─── Tooltip ─────────────────────────────────────────────────────────────────

type TooltipPayload = {
    payload?: { durationSec?: number };
    value?: unknown;
    name?: string;
    color?: string;
};

function PeakTooltipContent({
    active,
    payload,
    onActiveDuration,
}: {
    active?: boolean;
    payload?: TooltipPayload[];
    onActiveDuration: (d: number | null) => void;
}) {
    const dur = active && payload?.length ? (payload[0].payload?.durationSec ?? null) : null;

    useEffect(() => {
        onActiveDuration(dur ?? null);
    }, [dur, onActiveDuration]);

    if (!active || !payload?.length) return null;
    return (
        <div className="bg-background border border-border rounded p-2 text-xs shadow-md">
            <p className="text-muted-foreground mb-1">
                Duration: {formatDurationTick(payload[0].payload?.durationSec ?? 0)}
            </p>
            {payload.map((entry, i) => (
                <p key={i} style={{ color: entry.color }}>
                    {entry.name}:{' '}
                    {typeof entry.value === 'number' ? Math.round(entry.value) : '—'} W
                </p>
            ))}
        </div>
    );
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

    // Internal hover state — updated by the Tooltip content component
    const [activeDuration, setActiveDuration] = useState<number | null>(null);

    // Propagate to parent
    useEffect(() => {
        onDurationHover?.(activeDuration);
    }, [activeDuration, onDurationHover]);

    // Stable callback passed to PeakTooltipContent
    const handleActiveDuration = useCallback((d: number | null) => {
        setActiveDuration(d);
    }, []);

    // Stable Tooltip content renderer (must not re-create on every render)
    const tooltipContent = useCallback(
        (props: unknown) => {
            const p = props as { active?: boolean; payload?: TooltipPayload[] };
            return (
                <PeakTooltipContent
                    active={p.active}
                    payload={p.payload}
                    onActiveDuration={handleActiveDuration}
                />
            );
        },
        [handleActiveDuration],
    );

    const chartData = useMemo(() => {
        const synced = computeSyncedPeakWindows(
            result,
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
                zwift:  synced?.byDuration[durationSec]?.zwift ?? zwiftCpByDuration.get(durationSec)  ?? null,
                strava: synced?.byDuration[durationSec]?.strava ?? stravaCpByDuration.get(durationSec) ?? null,
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
                        onMouseLeave={() => setActiveDuration(null)}
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
                        <Tooltip content={tooltipContent} />
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
        </div>
    );
}
