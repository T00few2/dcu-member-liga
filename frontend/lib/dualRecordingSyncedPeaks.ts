import type { DualRecordingResult } from '@/hooks/useDualRecording';

export interface SyncedPeakWindow {
    durationSec: number;
    startSec: number;
    endSec: number;
    zwift: number;
    strava: number | null;
}

export interface SyncedPeakComputation {
    byDuration: Record<number, SyncedPeakWindow>;
    overlapStartSec: number;
    overlapEndSec: number;
}

function toNumericSeries(
    times: number[] | null | undefined,
    watts: Array<number | null> | null | undefined,
): Array<{ t: number; w: number }> {
    if (!times?.length || !watts?.length) return [];
    const n = Math.min(times.length, watts.length);
    const points: Array<{ t: number; w: number }> = [];
    for (let i = 0; i < n; i += 1) {
        const t = Number(times[i]);
        const w = watts[i];
        if (!Number.isFinite(t) || w == null || !Number.isFinite(Number(w))) continue;
        points.push({ t: Number(t), w: Number(w) });
    }
    points.sort((a, b) => a.t - b.t);
    return points;
}

function resampleTo1Hz(
    times: number[] | null | undefined,
    values: Array<number | null> | null | undefined,
): number[] {
    const points = toNumericSeries(times, values);
    if (!points.length) return [];

    const maxT = Math.floor(points[points.length - 1].t);
    const result = new Array<number>(maxT + 1).fill(0);

    let src = 0;
    for (let t = 0; t <= maxT; t += 1) {
        while (src + 1 < points.length && points[src + 1].t <= t) {
            src += 1;
        }
        if (src + 1 >= points.length) {
            result[t] = points[src].w;
            continue;
        }
        const t0 = points[src].t;
        const t1 = points[src + 1].t;
        if (t1 === t0) {
            result[t] = points[src].w;
            continue;
        }
        const alpha = (t - t0) / (t1 - t0);
        result[t] = points[src].w * (1 - alpha) + points[src + 1].w * alpha;
    }
    return result;
}

function computePeakWindows(
    w1hz: number[],
    durationsSec: number[],
): Record<number, { start: number; duration: number; avg: number }> {
    const out: Record<number, { start: number; duration: number; avg: number }> = {};
    const n = w1hz.length;
    for (const d of durationsSec) {
        if (!Number.isFinite(d) || d <= 0 || d > n) continue;
        let win = 0;
        for (let i = 0; i < d; i += 1) win += w1hz[i];
        let best = win;
        let bestStart = 0;
        for (let i = d; i < n; i += 1) {
            win += w1hz[i] - w1hz[i - d];
            const start = i - d + 1;
            if (win > best) {
                best = win;
                bestStart = start;
            }
        }
        out[d] = {
            start: bestStart,
            duration: d,
            avg: Math.round((best / d) * 10) / 10,
        };
    }
    return out;
}

function computeWindowAverages(
    w1hz: number[],
    windows: Record<number, { start: number; duration: number }>,
): Record<number, number | null> {
    const out: Record<number, number | null> = {};
    const n = w1hz.length;
    for (const [durKey, window] of Object.entries(windows)) {
        const durationSec = Number(durKey);
        const start = window.start;
        const endExclusive = start + window.duration;
        if (start < 0 || endExclusive > n || durationSec <= 0) {
            out[durationSec] = null;
            continue;
        }
        let sum = 0;
        for (let i = start; i < endExclusive; i += 1) sum += w1hz[i];
        out[durationSec] = Math.round((sum / window.duration) * 10) / 10;
    }
    return out;
}

export function computeSyncedPeakWindows(
    result: DualRecordingResult,
    durationsSec: number[],
): SyncedPeakComputation | null {
    const zTimes = result.zwift.streams?.time;
    const zWatts = result.zwift.streams?.watts;
    const sTimes = result.strava?.streams?.time;
    const sWatts = result.strava?.streams?.watts;
    if (!zTimes?.length || !zWatts?.length || !sTimes?.length || !sWatts?.length) {
        return null;
    }

    const stravaCoverStartSec = Math.max(0, Math.floor(Number(sTimes[0] ?? 0)));
    const stravaCoverEndSec = Math.max(0, Math.floor(Number(sTimes[sTimes.length - 1] ?? 0)));

    const z1hzFull = resampleTo1Hz(zTimes, zWatts);
    if (!z1hzFull.length) return null;
    const zSliceStart = stravaCoverStartSec > 0 ? stravaCoverStartSec : 0;
    const zSliceEnd = stravaCoverEndSec > 0 ? (stravaCoverEndSec + 1) : z1hzFull.length;
    const zComp = z1hzFull.slice(zSliceStart, zSliceEnd);
    if (!zComp.length) return null;

    const s1hzRaw = resampleTo1Hz(sTimes, sWatts);
    if (!s1hzRaw.length) return null;
    const sComp = stravaCoverStartSec > 0 ? s1hzRaw.slice(stravaCoverStartSec) : s1hzRaw;
    if (!sComp.length) return null;

    const peakWindows = computePeakWindows(zComp, durationsSec);
    const stravaAverages = computeWindowAverages(sComp, peakWindows);

    const byDuration: Record<number, SyncedPeakWindow> = {};
    for (const [durKey, window] of Object.entries(peakWindows)) {
        const d = Number(durKey);
        const startSec = zSliceStart + window.start;
        const endSec = startSec + window.duration;
        byDuration[d] = {
            durationSec: d,
            startSec,
            endSec,
            zwift: window.avg,
            strava: stravaAverages[d] ?? null,
        };
    }

    return {
        byDuration,
        overlapStartSec: zSliceStart,
        overlapEndSec: Math.max(zSliceStart, zSliceEnd - 1),
    };
}
