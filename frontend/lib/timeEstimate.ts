import type { RouteTimeEstimate } from '@/hooks/queries';

/**
 * Estimates minutes-per-lap for a target W/kg by linearly interpolating between
 * the two ZwiftInsider data points bracketing it, or extrapolating past either
 * end using the nearest segment's slope when only one data point exists on that side.
 */
export function estimateMinutesPerLap(estimates: RouteTimeEstimate[], targetWkg: number): number | null {
    if (estimates.length === 0) return null;
    if (estimates.length === 1) return estimates[0].minutes;

    const sorted = [...estimates].sort((a, b) => a.wkg - b.wkg);

    if (targetWkg <= sorted[0].wkg) {
        const [a, b] = sorted;
        return interpolate(a, b, targetWkg);
    }
    if (targetWkg >= sorted[sorted.length - 1].wkg) {
        const a = sorted[sorted.length - 2];
        const b = sorted[sorted.length - 1];
        return interpolate(a, b, targetWkg);
    }

    for (let i = 0; i < sorted.length - 1; i++) {
        const a = sorted[i];
        const b = sorted[i + 1];
        if (targetWkg >= a.wkg && targetWkg <= b.wkg) {
            return interpolate(a, b, targetWkg);
        }
    }
    return null;
}

function interpolate(a: RouteTimeEstimate, b: RouteTimeEstimate, targetWkg: number): number {
    if (a.wkg === b.wkg) return a.minutes;
    const ratio = (targetWkg - a.wkg) / (b.wkg - a.wkg);
    return a.minutes + ratio * (b.minutes - a.minutes);
}

interface RouteDistances {
    distance: number;
    leadinDistance: number;
}

/** Total ride time for a given lap count: laps * per-lap time, plus the lead-in at the same pace. */
export function estimateTotalMinutes(route: RouteDistances, perLapMinutes: number, laps: number): number | null {
    if (route.distance <= 0 || !(perLapMinutes > 0)) return null;
    const speedKmPerMin = route.distance / perLapMinutes;
    const leadInMinutes = route.leadinDistance / speedKmPerMin;
    return perLapMinutes * laps + leadInMinutes;
}

export interface LapSolveResult {
    laps: number;
    totalMinutes: number;
    withinSpan: boolean;
}

/**
 * Finds the lap count whose total time lands inside [minMinutes, maxMinutes], since total
 * time increases monotonically with lap count. When no integer lap count fits the span
 * (laps are discrete), returns the closest one instead and flags it via withinSpan: false.
 */
export function solveLapsForTimeSpan(
    route: RouteDistances,
    perLapMinutes: number,
    minMinutes: number,
    maxMinutes: number,
): LapSolveResult | null {
    if (route.distance <= 0 || !(perLapMinutes > 0)) return null;

    const [lo, hi] = minMinutes <= maxMinutes ? [minMinutes, maxMinutes] : [maxMinutes, minMinutes];
    const speedKmPerMin = route.distance / perLapMinutes;
    const leadInMinutes = route.leadinDistance / speedKmPerMin;
    const targetMid = (lo + hi) / 2;
    const approx = Math.max(1, Math.round((targetMid - leadInMinutes) / perLapMinutes));

    let best = 1;
    let bestDist = Infinity;
    for (let n = Math.max(1, approx - 3); n <= approx + 3; n++) {
        const total = perLapMinutes * n + leadInMinutes;
        const dist = total < lo ? lo - total : total > hi ? total - hi : 0;
        if (dist < bestDist) {
            bestDist = dist;
            best = n;
        }
    }

    return { laps: best, totalMinutes: perLapMinutes * best + leadInMinutes, withinSpan: bestDist === 0 };
}

export function formatMinutes(totalMinutes: number): string {
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
