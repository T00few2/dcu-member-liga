export interface GhostWattsThresholds {
    cadZeroThresh: number;
    minGhostWatts: number;
    minRun: number;
    minGhostSeconds: number;
    minGhostEvents: number;
    suspiciousFloorW: number;
}

export const DEFAULT_GW_THRESHOLDS: GhostWattsThresholds = {
    cadZeroThresh: 5,
    minGhostWatts: 8,
    minRun: 3,
    minGhostSeconds: 20,
    minGhostEvents: 3,
    suspiciousFloorW: 10,
};

export interface GhostWattsResult {
    totalSamples: number;
    ghostEvents: number;
    ghostSeconds: number;
    medianGhostWatts: number;
    maxGhostWatts: number;
    zeroCadenceSeconds: number;
    ghostShareOfZeroCadence: number;
    insufficientCadence: boolean;
    suspicious: boolean;
}

const SW_MIN_WATTS = 100;
const SW_MIN_RUN = 3;
const GW_ACTIVE_WATTS = 50;
const GW_MIN_ACTIVE_CADENCE_SHARE = 0.20;

function emptyResult(totalSamples: number, insufficient: boolean): GhostWattsResult {
    return {
        totalSamples,
        ghostEvents: 0,
        ghostSeconds: 0,
        medianGhostWatts: 0,
        maxGhostWatts: 0,
        zeroCadenceSeconds: 0,
        ghostShareOfZeroCadence: 0,
        insufficientCadence: insufficient,
        suspicious: false,
    };
}

function stickyRunMask(vals: number[], minWatts: number, minRun: number): boolean[] {
    const mask = new Array(vals.length).fill(false);
    let i = 0;
    while (i < vals.length) {
        const w = vals[i];
        if (w <= minWatts) {
            i++;
            continue;
        }
        let j = i + 1;
        while (j < vals.length && vals[j] === w) j++;
        if (j - i >= minRun) {
            for (let k = i; k < j; k++) mask[k] = true;
        }
        i = j;
    }
    return mask;
}

function median(values: number[]): number {
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return (sorted[mid - 1] + sorted[mid]) / 2;
}

export function analyzeGhostWatts(
    times: number[],
    watts: (number | null)[],
    cadence: (number | null)[] | undefined,
    thresholds?: Partial<GhostWattsThresholds>,
): GhostWattsResult {
    const t: GhostWattsThresholds = { ...DEFAULT_GW_THRESHOLDS, ...thresholds };
    const cadZero = t.cadZeroThresh;
    const minGhost = t.minGhostWatts;
    const minRun = t.minRun;

    let n = Math.min(times.length, watts.length);
    if (n === 0) return emptyResult(0, true);
    if (!cadence || cadence.length === 0) return emptyResult(n, true);

    n = Math.min(n, cadence.length);
    const vals: number[] = [];
    const cad: number[] = [];
    for (let i = 0; i < n; i++) {
        vals.push(watts[i] != null ? Math.trunc(watts[i] as number) : 0);
        cad.push(cadence[i] != null ? Math.trunc(cadence[i] as number) : 0);
    }

    let active = 0;
    let activeWithCad = 0;
    for (let i = 0; i < n; i++) {
        if (vals[i] > GW_ACTIVE_WATTS) {
            active++;
            if (cad[i] >= cadZero) activeWithCad++;
        }
    }
    if (active < 4 || activeWithCad / active < GW_MIN_ACTIVE_CADENCE_SHARE) {
        return emptyResult(n, true);
    }

    const sticky = stickyRunMask(vals, SW_MIN_WATTS, SW_MIN_RUN);
    const isGhost: boolean[] = new Array(n).fill(false);
    let zeroCadenceSeconds = 0;
    let ghostShareSamples = 0;
    for (let i = 0; i < n; i++) {
        if (cad[i] < cadZero) zeroCadenceSeconds++;
        if (cad[i] < cadZero && vals[i] >= minGhost && !sticky[i]) {
            isGhost[i] = true;
            ghostShareSamples++;
        }
    }
    const ghostShareOfZeroCadence = zeroCadenceSeconds > 0
        ? Math.round(ghostShareSamples / zeroCadenceSeconds * 1000) / 10
        : 0;

    let ghostEvents = 0;
    let ghostSeconds = 0;
    const ghostWatts: number[] = [];
    let i = 0;
    while (i < n) {
        if (!isGhost[i]) {
            i++;
            continue;
        }
        let j = i + 1;
        while (j < n && isGhost[j]) j++;
        const runLen = j - i;
        if (runLen >= minRun) {
            ghostEvents++;
            ghostSeconds += runLen;
            for (let k = i; k < j; k++) ghostWatts.push(vals[k]);
        }
        i = j;
    }

    const medianGhostWatts = ghostWatts.length
        ? Math.round(median(ghostWatts) * 10) / 10
        : 0;
    const maxGhostWatts = ghostWatts.length ? Math.max(...ghostWatts) : 0;
    const suspicious = medianGhostWatts >= t.suspiciousFloorW
        && (ghostSeconds >= t.minGhostSeconds || ghostEvents >= t.minGhostEvents);

    return {
        totalSamples: n,
        ghostEvents,
        ghostSeconds,
        medianGhostWatts,
        maxGhostWatts,
        zeroCadenceSeconds,
        ghostShareOfZeroCadence,
        insufficientCadence: false,
        suspicious,
    };
}
