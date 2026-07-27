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

export function formatMinutes(totalMinutes: number): string {
    const rounded = Math.round(totalMinutes);
    const hours = Math.floor(rounded / 60);
    const minutes = rounded % 60;
    return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}
