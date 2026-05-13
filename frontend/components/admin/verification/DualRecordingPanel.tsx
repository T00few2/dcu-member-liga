'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
    BarChart, Bar,
    XAxis, YAxis, CartesianGrid, Tooltip, Legend,
    ResponsiveContainer, LineChart, Line, Brush, ReferenceArea,
} from 'recharts';
import type { useDualRecording } from '@/hooks/useDualRecording';
import type {
    DualRecordingResult, CpDiffRow,
    EventActivityResult,
} from '@/hooks/useDualRecording';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_STEP = 5; // seconds between chart data points
const EXTENDED_PEAK_DURATIONS_SEC = [
    5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 300, 420, 600, 900, 1200, 1500, 1800,
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string | null | undefined) {
    if (!iso) return '—';
    return new Date(iso).toLocaleString();
}

function fmtDuration(sec: number | null | undefined) {
    if (!sec) return '—';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    return h > 0 ? `${h}h ${m}m` : `${m}m ${String(s).padStart(2, '0')}s`;
}

function fmtOffset(sec: number) {
    if (sec === 0) return 'simultaneous start';
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    const label = m > 0 ? `${m}m ${s}s` : `${s}s`;
    return sec > 0
        ? `Strava started ${label} after Zwift`
        : `Strava started ${label} before Zwift`;
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
        durationsSec.forEach(d => { result[d] = null; });
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
        durationsSec.forEach(d => { result[d] = null; });
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
            while (j < points.length && (points[j].t - points[i].t) < duration) {
                j += 1;
            }
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

function diffColour(pct: number | null | undefined): string {
    if (pct == null) return 'text-muted-foreground';
    const abs = Math.abs(pct);
    if (abs <= 3) return 'text-green-600';
    if (abs <= 8) return 'text-yellow-600';
    return 'text-red-600';
}

function diffBadge(pct: number | null | undefined) {
    if (pct == null) return <span className="text-muted-foreground">—</span>;
    const colour = diffColour(pct);
    const sign = pct >= 0 ? '+' : '';
    return <span className={`font-mono font-bold ${colour}`}>{sign}{pct.toFixed(1)}%</span>;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function syncMethodLabel(method: string): string {
    if (method === 'power_mse') return 'power MSE sync';
    if (method === 'power_mse_no_shift') return 'power MSE · no shift';
    return 'timestamp sync (fallback)';
}

function SyncBadge({ sync }: { sync: NonNullable<DualRecordingResult['sync']> }) {
    return (
        <span className="text-xs text-muted-foreground italic">
            {fmtOffset(sync.stravaOffsetSec)}
            {' · '}
            <span className="font-mono">{syncMethodLabel(sync.syncMethod)}</span>
        </span>
    );
}

function StatsTable({ result }: { result: DualRecordingResult }) {
    const { comparison, sync } = result;
    if (!comparison) return null;
    const { cpDiff, avgPower } = comparison;

    return (
        <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
                <thead>
                    <tr className="bg-muted/40 text-muted-foreground text-xs uppercase">
                        <th className="p-2 text-left">Duration</th>
                        <th className="p-2 text-right">Zwift (W)</th>
                        <th className="p-2 text-right">Strava (W)</th>
                        <th className="p-2 text-right">Diff (W)</th>
                        <th className="p-2 text-right">Diff (%)</th>
                    </tr>
                </thead>
                <tbody>
                    <tr className="border-t border-border bg-secondary/20">
                        <td className="p-2 font-medium">Avg Power</td>
                        <td className="p-2 text-right font-mono">
                            {avgPower.zwift != null ? `${avgPower.zwift}` : '—'}
                        </td>
                        <td className="p-2 text-right font-mono">
                            {avgPower.strava != null ? `${avgPower.strava}` : '—'}
                        </td>
                        <td className="p-2 text-right font-mono">
                            {avgPower.diffW != null ? `${avgPower.diffW > 0 ? '+' : ''}${avgPower.diffW}` : '—'}
                        </td>
                        <td className="p-2 text-right">{diffBadge(avgPower.diffPct)}</td>
                    </tr>
                    {cpDiff.map(row => (
                        <tr key={row.key} className="border-t border-border/50 hover:bg-muted/20">
                            <td className="p-2 font-medium">{row.label}</td>
                            <td className="p-2 text-right font-mono">{row.zwift ?? '—'}</td>
                            <td className="p-2 text-right font-mono">{row.strava ?? '—'}</td>
                            <td className="p-2 text-right font-mono">
                                {row.diffW != null ? `${row.diffW > 0 ? '+' : ''}${row.diffW}` : '—'}
                            </td>
                            <td className="p-2 text-right">{diffBadge(row.diffPct)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <p className="text-xs text-muted-foreground mt-2 px-1">
                Strava values computed from the synchronised race window
                {sync ? ` · ${fmtOffset(sync.stravaOffsetSec)} · ${syncMethodLabel(sync.syncMethod)}` : ''}.
                Diff = Zwift − Strava.
            </p>
        </div>
    );
}

function CpCurveChart({ result }: { result: DualRecordingResult }) {
    const cpDiff = result.comparison?.cpDiff ?? [];
    const zwiftCurve = result.zwift.cpCurve ?? {};
    const stravaCurve = result.strava?.cpCurveSynced ?? {};
    const chartData = cpDiff.map(r => ({
        label: r.label,
        Zwift: r.zwift ?? zwiftCurve[r.key] ?? null,
        Strava: r.strava ?? stravaCurve[r.key] ?? null,
    }));
    return (
        <div className="h-[260px] w-full">
            <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} barCategoryGap="25%" barGap={4}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }} />
                    <YAxis
                        label={{ value: 'Watts', angle: -90, position: 'insideLeft', style: { textAnchor: 'middle', fontSize: 11 } }}
                        tick={{ fontSize: 10, fill: 'var(--muted-foreground)' }}
                    />
                    <Tooltip formatter={(v: number) => [`${v} W`]} />
                    <Legend verticalAlign="top" height={28} />
                    <Bar dataKey="Zwift"  fill="#FC6719" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Strava" fill="#FC4C02" fillOpacity={0.65} radius={[3, 3, 0, 0]} />
                </BarChart>
            </ResponsiveContainer>
        </div>
    );
}

function ExtendedPeakCurveChart({ result }: { result: DualRecordingResult }) {
    const chartData = useMemo(() => {
        const zwiftPeaks = computePeaksWithoutInterpolation(
            result.zwift.streams?.time,
            result.zwift.streams?.watts as Array<number | null> | undefined,
            EXTENDED_PEAK_DURATIONS_SEC,
        );
        const stravaPeaks = computePeaksWithoutInterpolation(
            result.strava?.streams?.time,
            (result.strava?.streams?.watts as Array<number | null> | undefined),
            EXTENDED_PEAK_DURATIONS_SEC,
        );
        const cpDiff = result.comparison?.cpDiff ?? [];
        const zwiftCpByDuration = new Map<number, number>();
        const stravaCpByDuration = new Map<number, number>();
        for (const row of cpDiff) {
            const d = durationFromCpRow(row);
            if (d == null) continue;
            if (row.zwift != null) zwiftCpByDuration.set(d, row.zwift);
            if (row.strava != null) stravaCpByDuration.set(d, row.strava);
        }

        return EXTENDED_PEAK_DURATIONS_SEC
            .map((durationSec) => {
                const zwift = zwiftPeaks[durationSec] ?? zwiftCpByDuration.get(durationSec) ?? null;
                const strava = stravaPeaks[durationSec] ?? stravaCpByDuration.get(durationSec) ?? null;
                return {
                durationSec,
                durationLabel: formatDurationTick(durationSec),
                zwift,
                strava,
            };
            })
            .filter(row => row.zwift != null || row.strava != null);
    }, [result]);

    if (!chartData.length) return null;
    const yValues = chartData.flatMap((row) => [row.zwift, row.strava]).filter((v): v is number => v != null);
    const minPeak = yValues.length ? Math.min(...yValues) : 0;
    const maxPeak = yValues.length ? Math.max(...yValues) : 100;
    const yPadding = Math.max(8, (maxPeak - minPeak) * 0.08);
    const yMin = Math.max(0, Math.floor(minPeak - yPadding));
    const yMax = Math.ceil(maxPeak + yPadding);

    return (
        <div className="space-y-2">
            <div className="h-[280px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
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
                                const numeric = typeof v === 'number'
                                    ? v
                                    : (typeof v === 'string' ? Number(v) : NaN);
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

function fmtRaceTime(sec: number) {
    const neg = sec < 0;
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function DualStreamChart({ result }: { result: DualRecordingResult }) {
    const { zwift, strava } = result;
    const [hidden, setHidden] = useState<Set<string>>(
        () => new Set(['zwiftHR', 'stravaHR', 'zwiftCad', 'stravaCad', 'zwiftAlt', 'stravaAlt'])
    );

    const toggleSeries = (dataKey: string) =>
        setHidden((prev: Set<string>) => {
            const next = new Set(prev);
            if (next.has(dataKey)) next.delete(dataKey); else next.add(dataKey);
            return next;
        });

    const hasZwift  = (zwift.streams?.time?.length ?? 0) > 0;
    const hasStrava = (strava?.streams?.time?.length ?? 0) > 0;

    type StreamPoint = { w: number | null; hr: number | null; cad: number | null; alt: number | null };
    type ChartRow = {
        t: number;
        zwiftW: number | null; stravaW: number | null;
        zwiftHR: number | null; stravaHR: number | null;
        zwiftCad: number | null; stravaCad: number | null;
        zwiftAlt: number | null; stravaAlt: number | null;
    };

    const chartData = useMemo<ChartRow[]>(() => {
        if (!hasZwift && !hasStrava) return [];

        const zwiftByTime = new Map<number, StreamPoint>();
        if (hasZwift) {
            const { time, watts, heartrate, cadence, altitude } = zwift.streams!;
            time.forEach((t, i) => zwiftByTime.set(t, {
                w:   watts[i]     ?? null,
                hr:  heartrate[i] ?? null,
                cad: cadence[i]   ?? null,
                alt: altitude[i]  ?? null,
            }));
        }

        const stravaByTime = new Map<number, StreamPoint>();
        if (hasStrava) {
            const { time, watts, heartrate, cadence, altitude } = strava!.streams;
            time.forEach((t, i) => stravaByTime.set(t, {
                w:   watts[i]     ?? null,
                hr:  heartrate[i] ?? null,
                cad: cadence[i]   ?? null,
                alt: altitude[i]  ?? null,
            }));
        }

        const lookup = (m: Map<number, StreamPoint>, t: number) =>
            m.get(t) ?? m.get(t - 1) ?? m.get(t + 1);

        const zwiftTimes  = hasZwift  ? zwift.streams!.time : [];
        const stravaTimes = hasStrava ? strava!.streams.time : [];
        const allT = [...zwiftTimes, ...stravaTimes];
        const minT = Math.floor(Math.min(...allT) / CHART_STEP) * CHART_STEP;
        const maxT = Math.ceil(Math.max(...allT)  / CHART_STEP) * CHART_STEP;

        const rows: ChartRow[] = [];
        for (let t = minT; t <= maxT; t += CHART_STEP) {
            const zp = lookup(zwiftByTime, t);
            const sp = lookup(stravaByTime, t);
            rows.push({
                t,
                zwiftW:    zp?.w   ?? null,
                stravaW:   sp?.w   ?? null,
                zwiftHR:   zp?.hr  ?? null,
                stravaHR:  sp?.hr  ?? null,
                zwiftCad:  zp?.cad ?? null,
                stravaCad: sp?.cad ?? null,
                zwiftAlt:  zp?.alt ?? null,
                stravaAlt: sp?.alt ?? null,
            });
        }
        return rows;
    }, [hasZwift, hasStrava, zwift.streams, strava?.streams]);

    if (!hasZwift && !hasStrava) return null;

    const sync = result.sync;
    const gapSec = sync?.stravaStartGapSec ?? 0;
    const croppedSec = sync?.zwiftCroppedSec ?? 0;
    const gapExceedsLimit = sync?.zwiftGapExceedsLimit ?? false;
    const showGapOverlay = gapSec > 0;

    const hasZwiftHR   = chartData.some(d => d.zwiftHR   !== null);
    const hasStravaHR  = chartData.some(d => d.stravaHR  !== null);
    const hasZwiftCad  = chartData.some(d => d.zwiftCad  !== null);
    const hasStravaCad = chartData.some(d => d.stravaCad !== null);
    const hasZwiftAlt  = chartData.some(d => d.zwiftAlt  !== null);
    const hasStravaAlt = chartData.some(d => d.stravaAlt !== null);

    // Single right axis for all secondary data (HR, cadence, elevation).
    // Elevation shares the right axis — avoids a second right axis that would
    // squeeze the chart to half-width on mobile.
    // The axis collapses to width=0 when every secondary series is toggled off.
    const hrAxisOn = (hasZwiftHR   && !hidden.has('zwiftHR'))   ||
                     (hasStravaHR  && !hidden.has('stravaHR'))  ||
                     (hasZwiftCad  && !hidden.has('zwiftCad'))  ||
                     (hasStravaCad && !hidden.has('stravaCad')) ||
                     (hasZwiftAlt  && !hidden.has('zwiftAlt'))  ||
                     (hasStravaAlt && !hidden.has('stravaAlt'));

    const seriesMeta = [
        { key: 'zwiftW',    label: 'Zwift Power',   color: '#FC6719', show: hasZwift },
        { key: 'stravaW',   label: 'Strava Power',  color: '#e05c00', show: hasStrava },
        { key: 'zwiftHR',   label: 'Zwift HR',      color: '#ef4444', show: hasZwiftHR },
        { key: 'stravaHR',  label: 'Strava HR',     color: '#f87171', show: hasStravaHR },
        { key: 'zwiftCad',  label: 'Zwift Cad',     color: '#22c55e', show: hasZwiftCad },
        { key: 'stravaCad', label: 'Strava Cad',    color: '#86efac', show: hasStravaCad },
        { key: 'zwiftAlt',  label: 'Zwift Elev',    color: '#6366f1', show: hasZwiftAlt },
        { key: 'stravaAlt', label: 'Strava Elev',   color: '#a5b4fc', show: hasStravaAlt },
    ].filter(s => s.show);

    function fmtGapLabel(sec: number, frac: number): string {
        const m = Math.floor(sec / 60);
        const s = sec % 60;
        const time = m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
        return `Strava gap: ${time} (${(frac * 100).toFixed(1)}%)`;
    }

    return (
        <div className="w-full">
            {!hasZwift && hasStrava && (
                <p className="text-xs text-amber-700 mb-2 px-1">
                    Zwift stream data is unavailable for this comparison; showing Strava stream only.
                </p>
            )}
            {gapExceedsLimit && (
                <p className="text-xs text-amber-700 mb-2 px-1">
                    Strava recording gap ({fmtGapLabel(gapSec, sync?.stravaGapFraction ?? 0)}) exceeds
                    the 15% threshold — Zwift stream was not cropped. Peak watt comparison may be
                    distorted; the grey region shows the unrecorded portion.
                </p>
            )}
            {/* Custom wrapping legend — avoids Recharts overflow on narrow screens */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 px-1">
                {seriesMeta.map(s => (
                    <button
                        key={s.key}
                        onClick={() => toggleSeries(s.key)}
                        className="flex items-center gap-1.5 text-xs select-none"
                        style={{
                            opacity: hidden.has(s.key) ? 0.35 : 1,
                            textDecoration: hidden.has(s.key) ? 'line-through' : 'none',
                            color: 'var(--muted-foreground)',
                        }}
                    >
                        <span className="inline-block w-4 h-[2px] rounded flex-shrink-0"
                            style={{ backgroundColor: s.color }} />
                        {s.label}
                    </button>
                ))}
            </div>

            <div className="h-[360px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.3} />
                        <XAxis dataKey="t" type="number" domain={['dataMin', 'dataMax']}
                            tickFormatter={fmtRaceTime}
                            tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                        <YAxis yAxisId="w" orientation="left"
                            label={{ value: 'W', angle: -90, position: 'insideLeft', style: { fontSize: 11 } }}
                            tick={{ fontSize: 9, fill: 'var(--muted-foreground)' }} />
                        {/* Single right axis — HR, cadence AND elevation all share it.
                            Collapses to 0 width when every secondary series is toggled off. */}
                        <YAxis yAxisId="hr" orientation="right"
                            hide={!hrAxisOn} width={hrAxisOn ? 40 : 0}
                            label={hrAxisOn ? { value: 'bpm/rpm/m', angle: 90, position: 'insideRight', style: { fontSize: 9 } } : undefined}
                            tick={hrAxisOn ? { fontSize: 9, fill: 'var(--muted-foreground)' } : false} />
                        <Tooltip
                            labelFormatter={(t: number) => fmtRaceTime(Number(t))}
                            formatter={(v: unknown, name: string) =>
                                v != null ? [`${Math.round(v as number)}`, name] : ['—', name]}
                        />
                        <Brush
                            dataKey="t" height={20}
                            stroke="var(--border)" fill="var(--background)"
                            tickFormatter={fmtRaceTime}
                        />
                        {/* Power */}
                        {hasZwift && (
                            <Line yAxisId="w" type="monotone" dataKey="zwiftW"
                                stroke="#FC6719" dot={false} strokeWidth={2}
                                name="Zwift Power (W)" isAnimationActive={false} connectNulls={false}
                                hide={hidden.has('zwiftW')} />
                        )}
                        {hasStrava && (
                            <Line yAxisId="w" type="monotone" dataKey="stravaW"
                                stroke="#e05c00" dot={false} strokeWidth={1.5} strokeDasharray="5 3"
                                name="Strava Power (W)" isAnimationActive={false} connectNulls={false}
                                hide={hidden.has('stravaW')} />
                        )}
                        {/* Heart rate */}
                        {hasZwiftHR && (
                            <Line yAxisId="hr" type="monotone" dataKey="zwiftHR"
                                stroke="#ef4444" dot={false} strokeWidth={1.5}
                                name="Zwift HR (bpm)" isAnimationActive={false}
                                hide={hidden.has('zwiftHR')} />
                        )}
                        {hasStravaHR && (
                            <Line yAxisId="hr" type="monotone" dataKey="stravaHR"
                                stroke="#f87171" dot={false} strokeWidth={1} strokeDasharray="4 2"
                                name="Strava HR (bpm)" isAnimationActive={false}
                                hide={hidden.has('stravaHR')} />
                        )}
                        {/* Cadence */}
                        {hasZwiftCad && (
                            <Line yAxisId="hr" type="monotone" dataKey="zwiftCad"
                                stroke="#22c55e" dot={false} strokeWidth={1.5}
                                name="Zwift Cadence (rpm)" isAnimationActive={false}
                                hide={hidden.has('zwiftCad')} />
                        )}
                        {hasStravaCad && (
                            <Line yAxisId="hr" type="monotone" dataKey="stravaCad"
                                stroke="#86efac" dot={false} strokeWidth={1} strokeDasharray="4 2"
                                name="Strava Cadence (rpm)" isAnimationActive={false}
                                hide={hidden.has('stravaCad')} />
                        )}
                        {/* Elevation — shares the right axis with HR/cadence */}
                        {hasZwiftAlt && (
                            <Line yAxisId="hr" type="monotone" dataKey="zwiftAlt"
                                stroke="#6366f1" dot={false} strokeWidth={1.5}
                                name="Zwift Elevation (m)" isAnimationActive={false}
                                hide={hidden.has('zwiftAlt')} />
                        )}
                        {hasStravaAlt && (
                            <Line yAxisId="hr" type="monotone" dataKey="stravaAlt"
                                stroke="#a5b4fc" dot={false} strokeWidth={1} strokeDasharray="4 2"
                                name="Strava Elevation (m)" isAnimationActive={false}
                                hide={hidden.has('stravaAlt')} />
                        )}
                        {/* Grey overlay for the portion of the Zwift stream not covered by Strava */}
                        {showGapOverlay && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={0}
                                x2={gapSec}
                                fill={gapExceedsLimit ? '#f59e0b' : '#6b7280'}
                                fillOpacity={0.12}
                                strokeOpacity={0}
                                label={{
                                    value: croppedSec > 0
                                        ? fmtGapLabel(gapSec, sync?.stravaGapFraction ?? 0) + ' (cropped)'
                                        : fmtGapLabel(gapSec, sync?.stravaGapFraction ?? 0),
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

// ─── Event lookup status badge ─────────────────────────────────────────────────

function EventLookupStatus({ res }: { res: EventActivityResult }) {
    if (!res.found) {
        return (
            <p className="text-sm text-red-600 mt-2">
                {res.message || 'Rider not found in this event.'}
            </p>
        );
    }
    const { subgroupLabel, riderResult, zwiftActivity } = res;
    return (
        <div className="mt-2 p-3 bg-green-50 border border-green-200 rounded text-sm space-y-1">
            <p className="font-medium text-green-800">
                Found in {subgroupLabel || 'event'}
                {riderResult?.durationSec ? ` · ${fmtDuration(riderResult.durationSec)}` : ''}
                {riderResult?.avgWatts ? ` · ${riderResult.avgWatts} W avg` : ''}
            </p>
            {zwiftActivity ? (
                <p className="text-green-700 text-xs">
                    Zwift activity matched ({fmtDate(zwiftActivity.startedAt)}) — ready to compare.
                </p>
            ) : (
                <p className="text-amber-700 text-xs">
                    Zwift activity not in webhook store yet. Select an activity manually below.
                </p>
            )}
        </div>
    );
}

// ─── Main component ───────────────────────────────────────────────────────────

type DualHook = ReturnType<typeof useDualRecording>;

interface Props {
    riderId: string;
    hook: DualHook;
    /** Slot rendered between the compare controls and the comparison results. */
    children?: React.ReactNode;
}

export default function DualRecordingPanel({ riderId, hook, children }: Props) {
    const {
        zwiftActivities, stravaActivities, loadingActivities,
        selectedZwiftId, setSelectedZwiftId,
        selectedStravaId, setSelectedStravaId,
        eventId, setEventId,
        loadingEventActivity, eventActivityResult,
        lookupByEventId,
        result, loadingComparison, error,
        fetchActivityLists, fetchComparison,
    } = hook;

    const loaded = useRef(false);
    useEffect(() => {
        if (!loaded.current && riderId) {
            loaded.current = true;
            fetchActivityLists();
        }
    }, [riderId, fetchActivityLists]);

    useEffect(() => {
        loaded.current = false;
    }, [riderId]);

    const effectiveZwiftId =
        (eventActivityResult?.zwiftActivity?.activityId ?? null)
        || selectedZwiftId;

    const handleCompare = () => {
        if (!effectiveZwiftId) return;
        fetchComparison(effectiveZwiftId, selectedStravaId);
    };

    return (
        <div className="bg-card rounded-lg shadow border border-border overflow-hidden">
            {/* Header */}
            <div className="bg-[#FC6719]/10 p-4 border-b border-[#FC6719]/20 flex items-center justify-between">
                <div>
                    <h3 className="text-lg font-semibold text-[#FC6719]">Race Performance Verification</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">
                        Compare Zwift (primary) with Strava (secondary) for the same race.
                    </p>
                </div>
                <button
                    onClick={fetchActivityLists}
                    disabled={loadingActivities}
                    className="text-xs px-3 py-1.5 rounded border border-[#FC6719]/40 text-[#FC6719] hover:bg-[#FC6719]/10 disabled:opacity-50"
                >
                    {loadingActivities ? 'Loading…' : 'Refresh'}
                </button>
            </div>

            <div className="p-4 space-y-4">

                {/* ── Strava not linked warning ─────────────────────────────── */}
                {!loadingActivities && stravaActivities.length === 0 && (
                    <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm">
                        <span className="mt-0.5 text-base leading-none">⚠</span>
                        <div>
                            <span className="font-medium">Strava not linked.</span>
                            {' '}This rider has no connected Strava account or no recent activities.
                            Dual recording comparison requires a Strava power stream.
                        </div>
                    </div>
                )}

                {/* ── Option A: Event ID lookup ────────────────────────────── */}
                <div className="border border-border rounded-lg p-4 space-y-3">
                    <p className="text-xs font-semibold text-foreground uppercase tracking-wide">
                        Look up by Zwift Event ID
                    </p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            placeholder="e.g. 4567890"
                            value={eventId}
                            onChange={e => setEventId(e.target.value)}
                            onKeyDown={e => e.key === 'Enter' && lookupByEventId(eventId)}
                            className="flex-1 text-sm bg-background border border-input rounded px-3 py-1.5 text-foreground placeholder:text-muted-foreground/50 focus:ring-1 focus:ring-primary font-mono"
                        />
                        <button
                            onClick={() => lookupByEventId(eventId)}
                            disabled={!eventId.trim() || loadingEventActivity}
                            className="px-4 py-1.5 bg-[#FC6719] text-white rounded text-sm font-medium hover:opacity-90 disabled:opacity-40 whitespace-nowrap"
                        >
                            {loadingEventActivity ? 'Looking up…' : 'Lookup'}
                        </button>
                    </div>
                    {eventActivityResult && (
                        <EventLookupStatus res={eventActivityResult} />
                    )}
                </div>

                {/* ── Divider ──────────────────────────────────────────────── */}
                <div className="flex items-center gap-3">
                    <div className="flex-1 h-px bg-border" />
                    <span className="text-xs text-muted-foreground">or select manually</span>
                    <div className="flex-1 h-px bg-border" />
                </div>

                {/* ── Option B: Manual activity selection ──────────────────── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Zwift */}
                    <div className="space-y-2">
                        <label className="block text-xs font-medium text-muted-foreground">
                            Zwift Activity
                        </label>
                        {eventActivityResult?.found && eventActivityResult.zwiftActivity ? (
                            <div className="text-xs bg-green-50 border border-green-200 rounded px-2 py-1.5 font-mono text-green-800">
                                {eventActivityResult.zwiftActivity.activityId}
                                <span className="ml-2 text-green-600 font-sans">(from event lookup)</span>
                            </div>
                        ) : loadingActivities ? (
                            <div className="h-9 bg-muted/40 rounded animate-pulse" />
                        ) : zwiftActivities.length > 0 ? (
                            <select
                                value={selectedZwiftId ?? ''}
                                onChange={e => setSelectedZwiftId(e.target.value)}
                                className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground focus:ring-1 focus:ring-primary"
                            >
                                <option value="">— select activity —</option>
                                {zwiftActivities.map(a => (
                                    <option key={a.activityId} value={a.activityId ?? ''}>
                                        {a.name}
                                        {a.startedAt ? ` · ${new Date(a.startedAt).toLocaleDateString()}` : ''}
                                        {a.avgWatts ? ` · ${a.avgWatts}W` : ''}
                                    </option>
                                ))}
                            </select>
                        ) : (
                            <p className="text-xs text-muted-foreground italic">No webhook-captured activities.</p>
                        )}
                    </div>

                    {/* Strava */}
                    <div className="space-y-2">
                        <label className="block text-xs font-medium text-muted-foreground">
                            Strava Activity
                        </label>
                        {loadingActivities ? (
                            <div className="h-9 bg-muted/40 rounded animate-pulse" />
                        ) : stravaActivities.length === 0 ? (
                            <p className="text-xs text-muted-foreground italic">
                                No Strava activities found or Strava not connected.
                            </p>
                        ) : (
                            <select
                                value={selectedStravaId ?? ''}
                                onChange={e => setSelectedStravaId(e.target.value ? Number(e.target.value) : null)}
                                className="w-full text-sm bg-background border border-input rounded px-2 py-1.5 text-foreground focus:ring-1 focus:ring-primary"
                            >
                                <option value="">— auto-match by timestamp —</option>
                                {stravaActivities.map(a => (
                                    <option key={a.id} value={a.id}>
                                        {a.name}
                                        {a.startDateLocal ? ` · ${new Date(a.startDateLocal).toLocaleDateString()}` : ''}
                                        {a.averageWatts ? ` · ${a.averageWatts}W` : ''}
                                        {a.hasPowerMeter ? ' ⚡' : ''}
                                    </option>
                                ))}
                            </select>
                        )}
                    </div>
                </div>

                {/* Compare button */}
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleCompare}
                        disabled={!effectiveZwiftId || loadingComparison}
                        className="px-5 py-2 bg-[#FC6719] text-white rounded font-medium text-sm hover:opacity-90 disabled:opacity-40"
                    >
                        {loadingComparison ? 'Analysing…' : 'Compare'}
                    </button>
                    {result?.sync && (
                        <SyncBadge sync={result.sync} />
                    )}
                </div>

                {/* Error */}
                {error && (
                    <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded text-sm">{error}</div>
                )}

                {/* Warning (no Strava match) */}
                {result?.warning && !result.strava && (
                    <div className="bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 rounded text-sm">
                        {result.warning}
                    </div>
                )}

                {/* Charts slot — power curve, physical profile, power trend */}
                {children && (
                    <div className="pt-2 border-t border-border">
                        {children}
                    </div>
                )}

                {/* Results */}
                {result && result.strava && result.comparison && (
                    <div className="space-y-6 pt-2">
                        {/* Activity metadata */}
                        <div className="grid grid-cols-2 gap-4 text-sm">
                            <div className="bg-[#FC6719]/5 rounded p-3 border border-[#FC6719]/20">
                                <p className="font-semibold text-[#FC6719] mb-1">Zwift (primary)</p>
                                <p className="text-xs text-muted-foreground">{fmtDate(result.zwift.startedAt)}</p>
                                <p className="text-xs text-muted-foreground">{fmtDuration(result.zwift.durationSec)}</p>
                                {result.zwift.avgWatts && (
                                    <p className="text-xs font-mono mt-1">{result.zwift.avgWatts} W avg</p>
                                )}
                            </div>
                            <div className="bg-[#FC4C02]/5 rounded p-3 border border-[#FC4C02]/20">
                                <p className="font-semibold text-[#FC4C02] mb-1">{result.strava.name} (Strava)</p>
                                <p className="text-xs text-muted-foreground">{fmtDate(result.strava.startedAt)}</p>
                                <p className="text-xs text-muted-foreground">{fmtDuration(result.strava.durationSec)}</p>
                                {result.strava.avgWattsSynced && (
                                    <p className="text-xs font-mono mt-1">{result.strava.avgWattsSynced} W avg (race window)</p>
                                )}
                            </div>
                        </div>

                        {/* CP Curve comparison chart */}
                        <div>
                            <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                Power Curve Comparison
                            </h4>
                            <CpCurveChart result={result} />
                        </div>

                        {/* Extended peak profile chart */}
                        <div>
                            <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                Peak Profile by Duration (Extended)
                            </h4>
                            <ExtendedPeakCurveChart result={result} />
                        </div>

                        {/* Stats table */}
                        <div>
                            <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                Difference Table
                                <span className="ml-2 text-xs font-normal text-muted-foreground">
                                    <span className="text-green-600">≤3%</span> good ·{' '}
                                    <span className="text-yellow-600">3–8%</span> acceptable ·{' '}
                                    <span className="text-red-600">&gt;8%</span> investigate
                                </span>
                            </h4>
                            <StatsTable result={result} />
                        </div>

                        {/* Dual stream chart */}
                        {(result.zwift.streams?.time?.length || result.strava.streams?.time?.length) ? (
                            <div>
                                <h4 className="text-sm font-semibold mb-2 text-card-foreground">
                                    Recording Streams
                                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                                        t=0 = Zwift recording start · Strava aligned by power MSE · click legend to toggle
                                    </span>
                                </h4>
                                <DualStreamChart result={result} />
                            </div>
                        ) : null}
                    </div>
                )}
            </div>
        </div>
    );
}
