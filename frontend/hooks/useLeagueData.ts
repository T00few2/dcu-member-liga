import type { Route, Segment } from '@/types/admin';
import { API_URL } from '@/lib/api';

export async function fetchSegments(routeId: string, laps: number): Promise<Segment[]> {
    if (!routeId) return [];
    try {
        const res = await fetch(`${API_URL}/segments?routeId=${routeId}&laps=${laps}`);
        if (res.ok) {
            const data = await res.json();
            return data.segments || [];
        }
    } catch (e) {
        console.error('Error fetching segments:', e);
    }
    return [];
}

export function groupSegmentsByLap(segments: Segment[]): Record<number, Segment[]> {
    return segments.reduce((acc, seg) => {
        const lap = seg.lap ?? 1;
        if (!acc[lap]) acc[lap] = [];
        acc[lap].push(seg);
        return acc;
    }, {} as Record<number, Segment[]>);
}

/** Key of the calculated finish banner: last race-lap segment (lap >= 1). */
export function getFinishSegmentKey(segments: Segment[], maxLaps?: number): string | null {
    const raceLapSegments = segments.filter((seg) => {
        const lap = seg.lap ?? 1;
        if (lap < 1) return false;
        if (maxLaps != null && lap > maxLaps) return false;
        return true;
    });
    const finish = raceLapSegments[raceLapSegments.length - 1];
    if (!finish?.id) return null;
    return `${finish.id}_${finish.count}`;
}


export function getRouteHelpers(routes: Route[], selectedMap: string, selectedRouteId: string) {
    const maps = Array.from(new Set(routes.map(r => r.map))).sort();
    const filteredRoutes = selectedMap ? routes.filter(r => r.map === selectedMap) : [];
    const selectedRoute = routes.find(r => r.id === selectedRouteId);
    return { maps, filteredRoutes, selectedRoute };
}

export function calculateRouteTotals(route: Route, laps: number) {
    // Match Sauce/Zwift: lead-in once, then lap distance per lap.
    // total = leadin + distance * laps  (weld correction is ~0 for almost all routes)
    const lapsSafe = Math.max(1, laps || 1);
    const lapKm = Number(route.distance) || 0;
    const leadInKm = Number(route.leadinDistance) || 0;
    const lapElev = Number(route.elevation) || 0;
    const leadInElev = Number(route.leadinElevation) || 0;
    return {
        totalDistance: Number((lapKm * lapsSafe + leadInKm).toFixed(1)),
        totalElevation: Math.round(lapElev * lapsSafe + leadInElev),
        lapDistance: Number(lapKm.toFixed(1)),
        leadinDistance: Number(leadInKm.toFixed(1)),
    };
}

/**
 * Scale a saved race totalDistance to a different lap count without
 * multiplying lead-in. `totalDistanceKm` must be lead-in + raceLaps * lap.
 */
export function scaleRaceDistanceKm(
    totalDistanceKm: number,
    raceLaps: number,
    targetLaps: number,
    leadInKm = 0,
): number {
    const raceLapsSafe = Math.max(1, raceLaps);
    const targetLapsSafe = Math.max(1, targetLaps);
    const leadIn = Math.max(0, leadInKm);
    const raceOnlyKm = Math.max(0, totalDistanceKm - leadIn);
    const lapKm = raceOnlyKm / raceLapsSafe;
    return Number((lapKm * targetLapsSafe + leadIn).toFixed(1));
}

