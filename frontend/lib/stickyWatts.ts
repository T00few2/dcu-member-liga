export interface StickyWattsThresholds {
    minWatts: number;
    minRun: number;
    zeroThresh: number;
    suspiciousPairPct: number;
    suspiciousPreZero: number;
}

export const DEFAULT_THRESHOLDS: StickyWattsThresholds = {
    minWatts: 100,
    minRun: 3,
    zeroThresh: 20,
    suspiciousPairPct: 25,
    suspiciousPreZero: 2,
};

export interface StickyWattsResult {
    totalSamples: number;
    nonZeroSamples: number;
    identicalPairPct: number;
    stickyRuns: number;
    maxRunLength: number;
    preZeroEvents: number;
    suspicious: boolean;
}

export function analyzeStickyWatts(
    times: number[],
    watts: (number | null)[],
    thresholds?: Partial<StickyWattsThresholds>,
): StickyWattsResult {
    const t: StickyWattsThresholds = { ...DEFAULT_THRESHOLDS, ...thresholds };

    const n = Math.min(times.length, watts.length);
    const vals: number[] = [];
    for (let i = 0; i < n; i++) {
        const w = watts[i];
        vals.push(w != null ? w : 0);
    }

    const totalSamples = vals.length;
    const nonZeroSamples = vals.filter(w => w > t.minWatts).length;

    if (totalSamples < 4 || nonZeroSamples < 4) {
        return {
            totalSamples, nonZeroSamples,
            identicalPairPct: 0, stickyRuns: 0,
            maxRunLength: 0, preZeroEvents: 0, suspicious: false,
        };
    }

    // Identical adjacent pairs at > minWatts
    let identicalPairs = 0;
    let eligiblePairs = 0;
    for (let i = 0; i < vals.length - 1; i++) {
        const w0 = vals[i], w1 = vals[i + 1];
        if (w0 > t.minWatts && w1 > t.minWatts) {
            eligiblePairs++;
            if (w0 === w1) identicalPairs++;
        }
    }
    const identicalPairPct = eligiblePairs > 0
        ? Math.round(identicalPairs / eligiblePairs * 1000) / 10
        : 0;

    // Runs of identical consecutive values at > minWatts
    let stickyRuns = 0;
    let maxRunLength = 0;
    let preZeroEvents = 0;

    let i = 0;
    while (i < vals.length) {
        const w = vals[i];
        if (w <= t.minWatts) {
            i++;
            continue;
        }
        let runLen = 1;
        let j = i + 1;
        while (j < vals.length && vals[j] === w) {
            runLen++;
            j++;
        }
        if (runLen >= t.minRun) {
            stickyRuns++;
            if (runLen > maxRunLength) maxRunLength = runLen;
            if (j < vals.length && vals[j] < t.zeroThresh) {
                preZeroEvents++;
            }
        }
        i = j;
    }

    const suspicious = preZeroEvents >= t.suspiciousPreZero
        || identicalPairPct >= t.suspiciousPairPct;

    return {
        totalSamples, nonZeroSamples,
        identicalPairPct, stickyRuns, maxRunLength,
        preZeroEvents, suspicious,
    };
}
