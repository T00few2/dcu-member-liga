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

/**
 * ZwiftInsider tier times are for one full completion including lead-in
 * (often labelled "lead-in + first lap"). Scale that pace across N laps
 * without charging lead-in again.
 */
export function estimateTotalMinutes(route: RouteDistances, ziMinutes: number, laps: number): number | null {
    if (route.distance <= 0 || !(ziMinutes > 0)) return null;
    const leadIn = Math.max(0, route.leadinDistance || 0);
    const ziKm = route.distance + leadIn;
    if (ziKm <= 0) return null;
    const totalKm = route.distance * Math.max(1, laps) + leadIn;
    return ziMinutes * (totalKm / ziKm);
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
    ziMinutes: number,
    minMinutes: number,
    maxMinutes: number,
): LapSolveResult | null {
    if (route.distance <= 0 || !(ziMinutes > 0)) return null;

    const [lo, hi] = minMinutes <= maxMinutes ? [minMinutes, maxMinutes] : [maxMinutes, minMinutes];
    const leadIn = Math.max(0, route.leadinDistance || 0);
    const ziKm = route.distance + leadIn;
    if (ziKm <= 0) return null;

    const totalForLaps = (n: number) => ziMinutes * ((route.distance * n + leadIn) / ziKm);
    const targetMid = (lo + hi) / 2;
    const approx = Math.max(1, Math.round(((targetMid * ziKm) / ziMinutes - leadIn) / route.distance));

    let best = 1;
    let bestDist = Infinity;
    for (let n = Math.max(1, approx - 3); n <= approx + 3; n++) {
        const total = totalForLaps(n);
        const dist = total < lo ? lo - total : total > hi ? total - hi : 0;
        if (dist < bestDist) {
            bestDist = dist;
            best = n;
        }
    }

    return { laps: best, totalMinutes: totalForLaps(best), withinSpan: bestDist === 0 };
}

export function formatMinutes(totalMinutes: number): string {
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
