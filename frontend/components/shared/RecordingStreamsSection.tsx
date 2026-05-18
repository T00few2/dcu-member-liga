'use client';

import { useMemo, useState } from 'react';
import type { DualRecordingResult } from '@/hooks/useDualRecording';
import { computeSyncedPeakWindows } from '@/lib/dualRecordingSyncedPeaks';
import { StreamComparisonChart, type ChartRow, type HasSeries } from './recording-streams/StreamComparisonChart';
import { StreamMetricsTable } from './recording-streams/StreamMetricsTable';
import { StreamStatusBadges } from './recording-streams/StreamStatusBadges';

// ─── Constants ────────────────────────────────────────────────────────────────

const CHART_STEP = 5;
const IDENTICAL_TOLERANCE_W = 3;
const IDENTICAL_MIN_INTERVAL_SEC = 90;
const MAX_MEAN_ABS_DIFF_W = 5;
const MAX_STD_DIFF_W = 6;
const MAX_STD_DELTA_DIFF_W = 3;
const MIN_OVERLAP_SEC_FOR_SIMILARITY = 180;

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
        () => new Set(['zwiftHR', 'stravaHR', 'zwiftCad', 'stravaCad']),
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

    // ── Gap detection ─────────────────────────────────────────────────────────

    const zwiftStreamStartSec = chartData.find(row => row.zwiftW  !== null)?.t ?? 0;
    const zwiftStreamEndSec   = [...chartData].reverse().find(row => row.zwiftW  !== null)?.t ?? 0;
    const firstStravaDataT    = chartData.find(row => row.stravaW !== null)?.t ?? null;
    const lastStravaDataT     = [...chartData].reverse().find(row => row.stravaW !== null)?.t ?? null;

    const zwiftStreamDurationSec = zwiftStreamEndSec - zwiftStreamStartSec;

    const gapSec = (hasZwift && hasStrava && firstStravaDataT != null)
        ? Math.max(0, firstStravaDataT - zwiftStreamStartSec)
        : 0;
    const gapFraction = gapSec > 0 && zwiftStreamDurationSec > 0 ? gapSec / zwiftStreamDurationSec : 0;
    const showGapOverlay = gapSec > 0;

    const endGapSec = (hasZwift && hasStrava && lastStravaDataT != null)
        ? Math.max(0, zwiftStreamEndSec - lastStravaDataT)
        : 0;
    const endGapFraction = endGapSec > 0 && zwiftStreamDurationSec > 0 ? endGapSec / zwiftStreamDurationSec : 0;
    const showEndGapOverlay = endGapSec > 0;

    const totalCropFraction  = gapFraction + endGapFraction;
    const cropExceedsLimit   = totalCropFraction > 0.15;

    // ── Series visibility ─────────────────────────────────────────────────────

    const hasSeries = useMemo<HasSeries>(() => {
        const hasAny = (key: keyof ChartRow) => chartData.some((row) => row[key] != null);
        return {
            zwiftW:    hasAny('zwiftW'),
            stravaW:   hasAny('stravaW'),
            zwiftHR:   !hideHeartRate && hasAny('zwiftHR'),
            stravaHR:  !hideHeartRate && hasAny('stravaHR'),
            zwiftCad:  hasAny('zwiftCad'),
            stravaCad: hasAny('stravaCad'),
            zwiftAlt:  hasAny('zwiftAlt'),
        };
    }, [chartData, hideHeartRate]);

    // ── Peak window highlight ─────────────────────────────────────────────────

    const syncedWindowForDuration = useMemo(() => {
        if (!highlightDurationSec) return null;
        const synced = computeSyncedPeakWindows(result, [highlightDurationSec]);
        return synced?.byDuration[highlightDurationSec] ?? null;
    }, [highlightDurationSec, result]);

    const seriesMeta = [
        { key: 'zwiftW',    label: 'Zwift Power',  color: zwiftColor,  show: hasSeries.zwiftW },
        { key: 'stravaW',   label: 'Strava Power', color: stravaColor, show: hasSeries.stravaW },
        { key: 'zwiftHR',   label: 'Zwift HR',     color: '#ef4444',   show: hasSeries.zwiftHR },
        { key: 'stravaHR',  label: 'Strava HR',    color: '#f87171',   show: hasSeries.stravaHR },
        { key: 'zwiftCad',  label: 'Zwift Cad',    color: '#22c55e',   show: hasSeries.zwiftCad },
        { key: 'stravaCad', label: 'Strava Cad',   color: '#86efac',   show: hasSeries.stravaCad },
    ].filter(s => s.show);

    if (!hasZwift && !hasStrava) {
        return <div className="text-xs text-muted-foreground">No stream samples.</div>;
    }

    return (
        <div className="w-full">
            {/* Axis subtitle */}
            <div className="text-[11px] text-muted-foreground mb-1 px-1">
                t=0 = Zwift recording start · Strava aligned by power MSE · click legend to toggle
            </div>

            {/* Pass/fail status badges and gap notices */}
            <StreamStatusBadges
                hasZwift={hasZwift}
                hasStrava={hasStrava}
                showGapOverlay={showGapOverlay}
                showEndGapOverlay={showEndGapOverlay}
                gapSec={gapSec}
                gapFraction={gapFraction}
                endGapSec={endGapSec}
                endGapFraction={endGapFraction}
                totalCropFraction={totalCropFraction}
                cropExceedsLimit={cropExceedsLimit}
            />

            {/* Time-series overlay chart */}
            <StreamComparisonChart
                chartData={chartData}
                hasSeries={hasSeries}
                hidden={hidden}
                onToggleSeries={toggleSeries}
                seriesMeta={seriesMeta}
                zwiftColor={zwiftColor}
                stravaColor={stravaColor}
                height={height}
                gap={{
                    zwiftStreamStartSec,
                    zwiftStreamEndSec,
                    gapSec,
                    showGapOverlay,
                    endGapSec,
                    lastStravaDataT,
                    showEndGapOverlay,
                    cropExceedsLimit,
                }}
                syncedWindowForDuration={syncedWindowForDuration}
            />

            {/* Metrics comparison table */}
            {similarity && <StreamMetricsTable similarity={similarity} />}
        </div>
    );
}
