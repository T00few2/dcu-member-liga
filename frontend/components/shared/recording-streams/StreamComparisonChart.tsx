'use client';

import {
    ResponsiveContainer, ComposedChart, Line, Area, XAxis, YAxis,
    CartesianGrid, Tooltip, Brush, ReferenceArea, ReferenceLine,
} from 'recharts';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ChartRow = {
    t: number;
    zwiftW: number | null; stravaW: number | null;
    zwiftHR: number | null; stravaHR: number | null;
    zwiftCad: number | null; stravaCad: number | null;
    zwiftAlt: number | null;
};

export interface SyncedWindow {
    startSec: number;
    endSec: number;
}

export interface SeriesMeta {
    key: string;
    label: string;
    color: string;
    show: boolean;
}

export interface HasSeries {
    zwiftW: boolean;
    stravaW: boolean;
    zwiftHR: boolean;
    stravaHR: boolean;
    zwiftCad: boolean;
    stravaCad: boolean;
    zwiftAlt: boolean;
}

export interface GapInfo {
    zwiftStreamStartSec: number;
    zwiftStreamEndSec: number;
    gapSec: number;
    showGapOverlay: boolean;
    endGapSec: number;
    lastStravaDataT: number | null;
    showEndGapOverlay: boolean;
    cropExceedsLimit: boolean;
}

export interface StreamComparisonChartProps {
    chartData: ChartRow[];
    hasSeries: HasSeries;
    hidden: Set<string>;
    onToggleSeries: (dataKey: string) => void;
    seriesMeta: SeriesMeta[];
    zwiftColor: string;
    stravaColor: string;
    height: number;
    gap: GapInfo;
    syncedWindowForDuration: SyncedWindow | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtRaceTime(sec: number) {
    const neg = sec < 0;
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export function StreamComparisonChart({
    chartData,
    hasSeries,
    hidden,
    onToggleSeries,
    seriesMeta,
    zwiftColor,
    stravaColor,
    height,
    gap,
    syncedWindowForDuration,
}: StreamComparisonChartProps) {
    const {
        zwiftStreamStartSec,
        zwiftStreamEndSec,
        gapSec,
        showGapOverlay,
        endGapSec,
        lastStravaDataT,
        showEndGapOverlay,
        cropExceedsLimit,
    } = gap;

    const hrAxisOn = (hasSeries.zwiftHR   && !hidden.has('zwiftHR'))   ||
                     (hasSeries.stravaHR  && !hidden.has('stravaHR'))  ||
                     (hasSeries.zwiftCad  && !hidden.has('zwiftCad'))  ||
                     (hasSeries.stravaCad && !hidden.has('stravaCad'));

    return (
        <>
            {/* Clickable legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 px-1">
                {seriesMeta.map(s => (
                    <button
                        key={s.key}
                        onClick={() => onToggleSeries(s.key)}
                        className="flex items-center gap-1.5 text-xs select-none"
                        style={{
                            opacity:        hidden.has(s.key) ? 0.35 : 1,
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

            <div style={{ height }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                        <XAxis
                            dataKey="t"
                            type="number"
                            domain={['dataMin', 'dataMax']}
                            tickFormatter={fmtRaceTime}
                            tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
                        />
                        <YAxis
                            yAxisId="w"
                            orientation="left"
                            label={{ value: 'W', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                            tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }}
                        />
                        <YAxis
                            yAxisId="hr"
                            orientation="right"
                            hide={!hrAxisOn}
                            width={hrAxisOn ? 40 : 0}
                            label={hrAxisOn
                                ? { value: 'bpm/rpm', angle: 90, position: 'insideRight', style: { fontSize: 9 } }
                                : undefined}
                            tick={hrAxisOn ? { fontSize: 9, fill: 'var(--muted-foreground)' } : false}
                        />
                        <YAxis
                            yAxisId="elevBg"
                            hide
                            width={0}
                            domain={[0, (dataMax: number) => (Number.isFinite(dataMax) ? Math.ceil(dataMax + 10) : 100)]}
                        />
                        <Tooltip
                            labelFormatter={(t: number) => fmtRaceTime(Number(t))}
                            formatter={(v: unknown, name: string) =>
                                v != null ? [`${Math.round(v as number)}`, name] : ['—', name]}
                        />
                        <Brush
                            dataKey="t"
                            height={20}
                            stroke="var(--border)"
                            fill="var(--background)"
                            tickFormatter={fmtRaceTime}
                        />

                        {/* Background overlays */}
                        {hasSeries.zwiftAlt && (
                            <Area
                                yAxisId="elevBg"
                                type="monotone"
                                dataKey="zwiftAlt"
                                stroke="none"
                                fill="#94a3b8"
                                fillOpacity={0.28}
                                isAnimationActive={false}
                                connectNulls
                            />
                        )}

                        {syncedWindowForDuration && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={syncedWindowForDuration.startSec}
                                x2={syncedWindowForDuration.endSec}
                                fill="#16a34a"
                                fillOpacity={0.35}
                                stroke="#16a34a"
                                strokeOpacity={0.8}
                                strokeWidth={2}
                            />
                        )}
                        {syncedWindowForDuration && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={syncedWindowForDuration.startSec}
                                x2={syncedWindowForDuration.endSec}
                                fill="#4ade80"
                                fillOpacity={0.28}
                                stroke="#4ade80"
                                strokeOpacity={0.8}
                                strokeWidth={2}
                            />
                        )}
                        {syncedWindowForDuration && (
                            <ReferenceLine
                                yAxisId="w"
                                x={syncedWindowForDuration.startSec}
                                stroke="#16a34a"
                                strokeWidth={2}
                                strokeDasharray="4 2"
                                strokeOpacity={0.9}
                            />
                        )}
                        {syncedWindowForDuration && (
                            <ReferenceLine
                                yAxisId="w"
                                x={syncedWindowForDuration.endSec}
                                stroke="#16a34a"
                                strokeWidth={2}
                                strokeDasharray="4 2"
                                strokeOpacity={0.9}
                            />
                        )}

                        {showGapOverlay && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={zwiftStreamStartSec}
                                x2={zwiftStreamStartSec + gapSec}
                                fill={cropExceedsLimit ? '#f59e0b' : '#6b7280'}
                                fillOpacity={0.12}
                                strokeOpacity={0}
                            />
                        )}
                        {showEndGapOverlay && lastStravaDataT != null && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={lastStravaDataT}
                                x2={zwiftStreamEndSec}
                                fill={cropExceedsLimit ? '#f59e0b' : '#6b7280'}
                                fillOpacity={0.12}
                                strokeOpacity={0}
                            />
                        )}

                        {/* Data lines */}
                        {hasSeries.stravaW && (
                            <Line yAxisId="w" type="monotone" dataKey="stravaW"
                                stroke={stravaColor} dot={false} strokeWidth={1.5} strokeDasharray="5 3"
                                name="Strava Power (W)" isAnimationActive={false} connectNulls={false}
                                hide={hidden.has('stravaW')} />
                        )}
                        {hasSeries.zwiftW && (
                            <Line yAxisId="w" type="monotone" dataKey="zwiftW"
                                stroke={zwiftColor} dot={false} strokeWidth={2}
                                name="Zwift Power (W)" isAnimationActive={false} connectNulls={false}
                                hide={hidden.has('zwiftW')} />
                        )}

                        {hasSeries.zwiftHR && (
                            <Line yAxisId="hr" type="monotone" dataKey="zwiftHR"
                                stroke="#ef4444" dot={false} strokeWidth={1.5}
                                name="Zwift HR (bpm)" isAnimationActive={false}
                                hide={hidden.has('zwiftHR')} />
                        )}
                        {hasSeries.stravaHR && (
                            <Line yAxisId="hr" type="monotone" dataKey="stravaHR"
                                stroke="#f87171" dot={false} strokeWidth={1} strokeDasharray="4 2"
                                name="Strava HR (bpm)" isAnimationActive={false}
                                hide={hidden.has('stravaHR')} />
                        )}

                        {hasSeries.zwiftCad && (
                            <Line yAxisId="hr" type="monotone" dataKey="zwiftCad"
                                stroke="#22c55e" dot={false} strokeWidth={1.5}
                                name="Zwift Cadence (rpm)" isAnimationActive={false}
                                hide={hidden.has('zwiftCad')} />
                        )}
                        {hasSeries.stravaCad && (
                            <Line yAxisId="hr" type="monotone" dataKey="stravaCad"
                                stroke="#86efac" dot={false} strokeWidth={1} strokeDasharray="4 2"
                                name="Strava Cadence (rpm)" isAnimationActive={false}
                                hide={hidden.has('stravaCad')} />
                        )}
                    </ComposedChart>
                </ResponsiveContainer>
            </div>
        </>
    );
}
