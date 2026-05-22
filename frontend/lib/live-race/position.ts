/**
 * Map Zwift live-data distance fields to chart X (km) on the tiled elevation profile.
 * Chart range is [0, totalDistanceKm] without lead-in; live distances may include lead-in.
 */

export interface LiveDataDistanceInput {
    distanceCovered?: number;
    totalDistanceInMeters?: number;
    routeDistanceInCentimeters?: number;
    lap?: number;
}

export interface ChartPositionOptions {
    leadInKm: number;
    totalDistanceKm: number;
    lapLengthKm: number;
    /** 1-based lap index from Zwift when using lap-relative fallback */
    lapIndexBase?: 0 | 1;
}

function toNum(v: unknown): number {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
}

/**
 * Cumulative race distance in meters (before lead-in subtraction).
 *
 * Zwift live-data fields observed in the wild:
 *   - `totalDistanceInMeters`     - race-cumulative distance for this subgroup
 *   - `routeDistanceInCentimeters`- same, in cm (often slightly higher precision)
 *   - `distanceCovered`           - session/lifetime distance for the rider
 *                                   (often >> route length; NOT race distance)
 *
 * We therefore prefer totalDistanceInMeters / routeDistanceInCentimeters and
 * only fall back to distanceCovered when it looks plausible (<= ~2x total
 * route length), to stay tolerant of old/changed payloads.
 */
export function liveCumulativeDistanceM(
    input: LiveDataDistanceInput,
    lapLengthM: number,
    lapIndexBase: 0 | 1 = 1,
): number {
    const covered = toNum(input.distanceCovered);
    const total = toNum(input.totalDistanceInMeters);
    const routeCm = toNum(input.routeDistanceInCentimeters);

    if (total > 0) return total;
    if (routeCm > 0) return routeCm / 100;

    const lapLen = lapLengthM > 0 ? lapLengthM : 0;

    if (covered > 0) {
        const lap = Math.max(0, Math.floor(toNum(input.lap)));
        const plausibleCap = lapLen > 0 ? lapLen * Math.max(lap + 1, 1) * 2 : Infinity;
        if (covered <= plausibleCap) {
            if (lapLen > 0 && lap > 1 && covered < lapLen * 0.95) {
                const lapOffset = Math.max(0, lap - lapIndexBase);
                return lapOffset * lapLen + covered;
            }
            return covered;
        }
    }

    if (lapLen > 0) {
        const lap = Math.max(0, Math.floor(toNum(input.lap)));
        const lapOffset = Math.max(0, lap - lapIndexBase);
        return lapOffset * lapLen;
    }
    return 0;
}

export function chartKmFromLiveData(
    input: LiveDataDistanceInput,
    opts: ChartPositionOptions,
): { chartKm: number; cumulativeKm: number; inLeadIn: boolean } {
    const lapLengthM = opts.lapLengthKm * 1000;
    const leadInM = opts.leadInKm * 1000;
    const cumulativeM = liveCumulativeDistanceM(input, lapLengthM, opts.lapIndexBase ?? 1);
    const chartM = Math.max(0, Math.min(opts.totalDistanceKm * 1000, cumulativeM - leadInM));
    return {
        chartKm: chartM / 1000,
        cumulativeKm: cumulativeM / 1000,
        inLeadIn: cumulativeM < leadInM && leadInM > 0,
    };
}

export function speedMmPerHourToKmh(speedInMillimetersPerHour: number | undefined): number {
    const v = toNum(speedInMillimetersPerHour);
    if (v <= 0) return 0;
    return v / 1_000_000;
}
