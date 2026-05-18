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

export function getRouteHelpers(routes: Route[], selectedMap: string, selectedRouteId: string) {
    const maps = Array.from(new Set(routes.map(r => r.map))).sort();
    const filteredRoutes = selectedMap ? routes.filter(r => r.map === selectedMap) : [];
    const selectedRoute = routes.find(r => r.id === selectedRouteId);
    return { maps, filteredRoutes, selectedRoute };
}
