'use client';

import { useMemo, useState } from 'react';
import {
    ResponsiveContainer, LineChart, Line, XAxis, YAxis,
    CartesianGrid, Tooltip, Brush, ReferenceArea, ReferenceLine,
} from 'recharts';
import type { DualRecordingResult } from '@/hooks/useDualRecording';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_STEP = 5;
const IDENTICAL_TOLERANCE_W = 3;
const IDENTICAL_MIN_INTERVAL_SEC = 90;
const MAX_MEAN_ABS_DIFF_W = 5;
const MAX_STD_DIFF_W = 6;
const MAX_STD_DELTA_DIFF_W = 3;
const MIN_OVERLAP_SEC_FOR_SIMILARITY = 180;

// ─── Helpers ─────────────────────────────────────────────────────────────────

function fmtRaceTime(sec: number) {
    const neg = sec < 0;
    const abs = Math.abs(sec);
    const m = Math.floor(abs / 60);
    const s = abs % 60;
    return `${neg ? '-' : ''}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function fmtGap(sec: number, frac: number): string {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    const time = m > 0 ? (s > 0 ? `${m}m ${s}s` : `${m}m`) : `${s}s`;
    return `${time} (${(frac * 100).toFixed(1)}%)`;
}

function findPeakWindow(
    time: number[] | null | undefined,
    watts: (number | null)[] | null | undefined,
    durationSec: number,
    minT?: number,
    maxT?: number,
): { startSec: number; endSec: number } | null {
    if (!time?.length || !watts?.length || durationSec <= 0) return null;
    const points: { t: number; w: number }[] = [];
    for (let i = 0; i < Math.min(time.length, watts.length); i++) {
        const w = watts[i];
        if (w == null || !Number.isFinite(w)) continue;
        const t = Number(time[i]);
        if (minT != null && t < minT) continue;
        if (maxT != null && t > maxT) continue;
        points.push({ t, w: Number(w) });
    }
    points.sort((a, b) => a.t - b.t);
    if (!points.length) return null;

    const prefix = [0];
    for (const p of points) prefix.push(prefix[prefix.length - 1] + p.w);

    let bestAvg = -Infinity;
    let bestStart = -1;
    let bestEnd = -1;
    let j = 0;
    for (let i = 0; i < points.length; i++) {
        if (j < i) j = i;
        while (j < points.length && points[j].t - points[i].t < durationSec) j++;
        if (j >= points.length) break;
        const avg = (prefix[j + 1] - prefix[i]) / (j - i + 1);
        if (avg > bestAvg) { bestAvg = avg; bestStart = i; bestEnd = j; }
    }
    if (bestStart < 0) return null;
    return { startSec: points[bestStart].t, endSec: points[bestEnd].t };
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface RecordingStreamsSectionProps {
    result: DualRecordingResult;
    hideHeartRate?: boolean;
    zwiftColor?: string;
    stravaColor?: string;
    height?: number;
    highlightDurationSec?: number | null;
}

// ─── Component ───────────────────────────────────────────────────────────────

export function RecordingStreamsSection({
    result,
    hideHeartRate = false,
    zwiftColor = '#FC6719',
    stravaColor = '#e05c00',
    height = 360,
    highlightDurationSec = null,
}: RecordingStreamsSectionProps) {
    const { zwift, strava } = result;

    const [hidden, setHidden] = useState<Set<string>>(
        () => new Set(['zwiftHR', 'stravaHR', 'zwiftCad', 'stravaCad', 'zwiftAlt', 'stravaAlt']),
    );

    const toggleSeries = (dataKey: string) =>
        setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(dataKey)) next.delete(dataKey);
            else next.add(dataKey);
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

        // Fuzzy lookup: accept t±1 to handle off-by-one from differing step sizes
        const lookup = (m: Map<number, StreamPoint>, t: number) =>
            m.get(t) ?? m.get(t - 1) ?? m.get(t + 1);

        const allT = [
            ...(hasZwift  ? zwift.streams!.time : []),
            ...(hasStrava ? strava!.streams.time : []),
        ];
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

    // ── Similarity check ─────────────────────────────────────────────────────

    const similarity = useMemo(() => {
        if (!hasZwift || !hasStrava) return null;

        const paired = chartData
            .map((d) => {
                if (d.zwiftW == null || d.stravaW == null) return null;
                const signed = d.zwiftW - d.stravaW;
                return { t: d.t, signed, abs: Math.abs(signed) };
            })
            .filter((v): v is { t: number; signed: number; abs: number } => v != null);

        if (paired.length === 0) return null;

        const absDiffs    = paired.map((p) => p.abs);
        const signedDiffs = paired.map((p) => p.signed);
        const sortedAbs   = [...absDiffs].sort((a, b) => a - b);
        const meanAbs     = absDiffs.reduce((acc, n) => acc + n, 0) / absDiffs.length;
        const p95         = sortedAbs[Math.min(sortedAbs.length - 1, Math.floor(sortedAbs.length * 0.95))];
        const max         = sortedAbs[sortedAbs.length - 1];
        const nearIdenticalSamples = absDiffs.filter((d) => d <= IDENTICAL_TOLERANCE_W).length;
        const nearIdenticalPct     = (nearIdenticalSamples / absDiffs.length) * 100;

        const std = (values: number[]): number => {
            if (values.length === 0) return 0;
            const mean     = values.reduce((acc, n) => acc + n, 0) / values.length;
            const variance = values.reduce((acc, n) => acc + (n - mean) ** 2, 0) / values.length;
            return Math.sqrt(variance);
        };
        const stdDiff = std(signedDiffs);

        const deltaDiffs: number[] = [];
        for (let i = 1; i < paired.length; i++) deltaDiffs.push(paired[i].signed - paired[i - 1].signed);
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
            meanAbs    <= MAX_MEAN_ABS_DIFF_W &&
            stdDiff    <= MAX_STD_DIFF_W &&
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
    }, [chartData, hasZwift, hasStrava]);

    // ── Gap detection (client-side, works for old cached results) ─────────────

    const zwiftStreamStartSec = chartData.find(row => row.zwiftW  !== null)?.t ?? 0;
    const zwiftStreamEndSec   = [...chartData].reverse().find(row => row.zwiftW  !== null)?.t ?? 0;
    const firstStravaDataT    = chartData.find(row => row.stravaW !== null)?.t ?? null;
    const lastStravaDataT     = [...chartData].reverse().find(row => row.stravaW !== null)?.t ?? null;

    const zwiftStreamDurationSec = zwiftStreamEndSec - zwiftStreamStartSec;

    // Start gap: Strava starts later than Zwift
    const gapSec = (hasZwift && hasStrava && firstStravaDataT != null)
        ? Math.max(0, firstStravaDataT - zwiftStreamStartSec)
        : 0;
    const gapFraction = gapSec > 0 && zwiftStreamDurationSec > 0 ? gapSec / zwiftStreamDurationSec : 0;
    const showGapOverlay = gapSec > 0;

    // End gap: Zwift continues after Strava stops
    const endGapSec = (hasZwift && hasStrava && lastStravaDataT != null)
        ? Math.max(0, zwiftStreamEndSec - lastStravaDataT)
        : 0;
    const endGapFraction = endGapSec > 0 && zwiftStreamDurationSec > 0 ? endGapSec / zwiftStreamDurationSec : 0;
    const showEndGapOverlay = endGapSec > 0;

    // The 15% limit applies to the TOTAL combined cropping, not each gap independently
    const totalCropFraction  = gapFraction + endGapFraction;
    const cropExceedsLimit   = totalCropFraction > 0.15;

    // ── Series visibility ─────────────────────────────────────────────────────

    const hasSeries = useMemo(() => {
        const hasAny = (key: keyof ChartRow) => chartData.some((row) => row[key] != null);
        return {
            zwiftW:    hasAny('zwiftW'),
            stravaW:   hasAny('stravaW'),
            zwiftHR:   !hideHeartRate && hasAny('zwiftHR'),
            stravaHR:  !hideHeartRate && hasAny('stravaHR'),
            zwiftCad:  hasAny('zwiftCad'),
            stravaCad: hasAny('stravaCad'),
            zwiftAlt:  hasAny('zwiftAlt'),
            stravaAlt: hasAny('stravaAlt'),
        };
    }, [chartData, hideHeartRate]);

    // ── Peak window highlight (driven by hover on the peak profile chart) ────────

    // Bound the Zwift peak search to the same window that was compared:
    // if cropping was applied (gap > 0 and within the 15% limit), restrict
    // to [firstStravaDataT, lastStravaDataT] so the highlight never falls in
    // the grey cropped zone.
    const zwiftPeakMinT = (gapSec > 0 && !cropExceedsLimit) ? (firstStravaDataT ?? undefined) : undefined;
    const zwiftPeakMaxT = (endGapSec > 0 && !cropExceedsLimit) ? (lastStravaDataT ?? undefined) : undefined;

    const zwiftPeakWindow = useMemo(
        () => highlightDurationSec
            ? findPeakWindow(zwift.streams?.time, zwift.streams?.watts as (number | null)[], highlightDurationSec, zwiftPeakMinT, zwiftPeakMaxT)
            : null,
        [highlightDurationSec, zwift.streams, zwiftPeakMinT, zwiftPeakMaxT],
    );
    const stravaPeakWindow = useMemo(
        () => highlightDurationSec
            ? findPeakWindow(strava?.streams?.time, strava?.streams?.watts as (number | null)[], highlightDurationSec)
            : null,
        [highlightDurationSec, strava?.streams],
    );

    // The secondary (right) axis collapses when all secondary series are toggled off
    const hrAxisOn = (hasSeries.zwiftHR   && !hidden.has('zwiftHR'))   ||
                     (hasSeries.stravaHR  && !hidden.has('stravaHR'))  ||
                     (hasSeries.zwiftCad  && !hidden.has('zwiftCad'))  ||
                     (hasSeries.stravaCad && !hidden.has('stravaCad')) ||
                     (hasSeries.zwiftAlt  && !hidden.has('zwiftAlt'))  ||
                     (hasSeries.stravaAlt && !hidden.has('stravaAlt'));

    const seriesMeta = [
        { key: 'zwiftW',    label: 'Zwift Power',  color: zwiftColor,  show: hasSeries.zwiftW },
        { key: 'stravaW',   label: 'Strava Power', color: stravaColor, show: hasSeries.stravaW },
        { key: 'zwiftHR',   label: 'Zwift HR',     color: '#ef4444',   show: hasSeries.zwiftHR },
        { key: 'stravaHR',  label: 'Strava HR',    color: '#f87171',   show: hasSeries.stravaHR },
        { key: 'zwiftCad',  label: 'Zwift Cad',    color: '#22c55e',   show: hasSeries.zwiftCad },
        { key: 'stravaCad', label: 'Strava Cad',   color: '#86efac',   show: hasSeries.stravaCad },
        { key: 'zwiftAlt',  label: 'Zwift Elev',   color: '#6366f1',   show: hasSeries.zwiftAlt },
        { key: 'stravaAlt', label: 'Strava Elev',  color: '#a5b4fc',   show: hasSeries.stravaAlt },
    ].filter(s => s.show);

    if (!hasZwift && !hasStrava) {
        return <div className="text-xs text-muted-foreground">No stream samples.</div>;
    }

    return (
        <div className="w-full">
            {/* Similarity check panel */}
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
                        <div>Near-identical (&lt;={IDENTICAL_TOLERANCE_W}W): <span className="font-mono">{similarity.nearIdenticalPct.toFixed(1)}%</span></div>
                        <div>Longest near-identical run: <span className="font-mono">{Math.round(similarity.longestNearIdenticalRunSec)}s</span></div>
                    </div>
                    <div className="mt-1">
                        {similarity.suspicious
                            ? `Suspiciously similar power traces (${similarity.suspiciousByVolatility ? 'volatility' : 'run-length'} trigger). This can indicate shared recording source.`
                            : 'Similarity level looks plausible for independent recordings.'}
                    </div>
                </div>
            )}

            {/* Axis subtitle */}
            <div className="text-[11px] text-muted-foreground mb-1 px-1">
                t=0 = Zwift recording start · Strava aligned by power MSE · click legend to toggle
            </div>

            {/* Gap notices */}
            {!hasZwift && hasStrava && (
                <p className="text-xs text-amber-700 mb-2 px-1">
                    Zwift stream data is unavailable for this comparison; showing Strava stream only.
                </p>
            )}
            {/* Gap notices — limit is on the combined total, so both gaps share one exceeds/ok verdict */}
            {(showGapOverlay || showEndGapOverlay) && cropExceedsLimit && (
                <p className="text-xs text-amber-700 mb-2 px-1">
                    {showGapOverlay && <>Strava starts late: {fmtGap(gapSec, gapFraction)}. </>}
                    {showEndGapOverlay && <>Strava stops early: {fmtGap(endGapSec, endGapFraction)}. </>}
                    Total crop {fmtGap(gapSec + endGapSec, totalCropFraction)} exceeds the 15% limit —
                    Zwift stream was not cropped. Peak watt comparison may be distorted.
                </p>
            )}
            {showGapOverlay && !cropExceedsLimit && (
                <p className="text-xs text-blue-700 mb-1 px-1">
                    Strava starts late: {fmtGap(gapSec, gapFraction)} — Zwift start cropped to match.
                </p>
            )}
            {showEndGapOverlay && !cropExceedsLimit && (
                <p className="text-xs text-blue-700 mb-1 px-1">
                    Strava stops early: {fmtGap(endGapSec, endGapFraction)} — Zwift end cropped to match.
                </p>
            )}
            {showGapOverlay && showEndGapOverlay && !cropExceedsLimit && (
                <p className="text-xs text-blue-700 mb-2 px-1">
                    Total crop: {fmtGap(gapSec + endGapSec, totalCropFraction)}.
                </p>
            )}
            {hasZwift && hasStrava && !showGapOverlay && !showEndGapOverlay && (
                <p className="text-xs text-green-700 mb-2 px-1">
                    No Strava recording gap detected — both streams start and end at the same point.
                </p>
            )}

            {/* Peak highlight debug info */}
            {highlightDurationSec != null && (
                <p className="text-xs text-green-700 font-mono mb-1 px-1">
                    ▶ Peak {highlightDurationSec}s —{' '}
                    Zwift: {zwiftPeakWindow ? `${zwiftPeakWindow.startSec}–${zwiftPeakWindow.endSec}s` : 'no window'}{' '}
                    · Strava: {stravaPeakWindow ? `${stravaPeakWindow.startSec}–${stravaPeakWindow.endSec}s` : 'no window'}
                </p>
            )}

            {/* Clickable legend */}
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 px-1">
                {seriesMeta.map(s => (
                    <button
                        key={s.key}
                        onClick={() => toggleSeries(s.key)}
                        className="flex items-center gap-1.5 text-xs select-none"
                        style={{
                            opacity:         hidden.has(s.key) ? 0.35 : 1,
                            textDecoration:  hidden.has(s.key) ? 'line-through' : 'none',
                            color: 'var(--muted-foreground)',
                        }}
                    >
                        <span className="inline-block w-4 h-[2px] rounded flex-shrink-0"
                            style={{ backgroundColor: s.color }} />
                        {s.label}
                    </button>
                ))}
            </div>

            <div style={{ height }} className="w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
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
                        {/* Single right axis for HR, cadence, and elevation — collapses when all toggled off */}
                        <YAxis
                            yAxisId="hr"
                            orientation="right"
                            hide={!hrAxisOn}
                            width={hrAxisOn ? 40 : 0}
                            label={hrAxisOn
                                ? { value: 'bpm/rpm/m', angle: 90, position: 'insideRight', style: { fontSize: 9 } }
                                : undefined}
                            tick={hrAxisOn ? { fontSize: 9, fill: 'var(--muted-foreground)' } : false}
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

                        {/* ── Background overlays (rendered first so lines paint on top) ── */}

                        {/* Peak window highlights — shown when hovering the peak profile chart */}
                        {zwiftPeakWindow && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={zwiftPeakWindow.startSec}
                                x2={zwiftPeakWindow.endSec}
                                fill="#16a34a"
                                fillOpacity={0.35}
                                stroke="#16a34a"
                                strokeOpacity={0.8}
                                strokeWidth={2}
                            />
                        )}
                        {stravaPeakWindow && (
                            <ReferenceArea
                                yAxisId="w"
                                x1={stravaPeakWindow.startSec}
                                x2={stravaPeakWindow.endSec}
                                fill="#4ade80"
                                fillOpacity={0.28}
                                stroke="#4ade80"
                                strokeOpacity={0.8}
                                strokeWidth={2}
                            />
                        )}
                        {/* Vertical marker lines at peak window boundaries */}
                        {zwiftPeakWindow && (
                            <ReferenceLine
                                yAxisId="w"
                                x={zwiftPeakWindow.startSec}
                                stroke="#16a34a"
                                strokeWidth={2}
                                strokeDasharray="4 2"
                                strokeOpacity={0.9}
                            />
                        )}
                        {zwiftPeakWindow && (
                            <ReferenceLine
                                yAxisId="w"
                                x={zwiftPeakWindow.endSec}
                                stroke="#16a34a"
                                strokeWidth={2}
                                strokeDasharray="4 2"
                                strokeOpacity={0.9}
                            />
                        )}

                        {/* Shaded overlay for Strava start gap */}
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
                        {/* Shaded overlay for Strava end gap */}
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

                        {/* ── Data lines (rendered after overlays so they appear on top) ── */}

                        {/* Power — draw Strava first so Zwift renders on top */}
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

                        {/* Heart rate */}
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

                        {/* Cadence */}
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

                        {/* Elevation — shares right axis with HR / cadence */}
                        {hasSeries.zwiftAlt && (
                            <Line yAxisId="hr" type="monotone" dataKey="zwiftAlt"
                                stroke="#6366f1" dot={false} strokeWidth={1.5}
                                name="Zwift Elevation (m)" isAnimationActive={false}
                                hide={hidden.has('zwiftAlt')} />
                        )}
                        {hasSeries.stravaAlt && (
                            <Line yAxisId="hr" type="monotone" dataKey="stravaAlt"
                                stroke="#a5b4fc" dot={false} strokeWidth={1} strokeDasharray="4 2"
                                name="Strava Elevation (m)" isAnimationActive={false}
                                hide={hidden.has('stravaAlt')} />
                        )}

                    </LineChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
}
