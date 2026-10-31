'use client';

import { useQuery } from '@tanstack/react-query';

interface ProfileSegment {
    name: string;
    type: string;
    fromKm: number;
    toKm: number;
    direction?: string;
}

interface RouteSegment {
    from: number;
    to: number;
    type: string;
    name?: string;
    direction?: string;
}

export interface RouteElevationData {
    distance: number[];
    altitude: number[];
    leadInDistance?: number;
    /** Metres from the pens to the banner. Drawn on the race card only. */
    leadInProfile?: { distance: number[]; altitude: number[] } | null;
    segments?: RouteSegment[];
    profileSegments?: ProfileSegment[];
}

const ELEVATION_STALE_MS = 24 * 60 * 60_000;

export function useRouteElevationQuery(
    worldName: string | undefined,
    routeName: string | undefined,
    _laps: number,
    options?: { enabled?: boolean; routeId?: string | number },
) {
    const enabled = options?.enabled ?? true;
    const routeId = options?.routeId != null && options.routeId !== ''
        ? String(options.routeId)
        : undefined;
    return useQuery<RouteElevationData | null>({
        queryKey: ['route-elevation', routeId, worldName, routeName],
        queryFn: async () => {
            const params = new URLSearchParams();
            if (routeId) params.set('routeId', routeId);
            if (worldName) params.set('world', worldName);
            if (routeName) params.set('route', routeName);
            const res = await fetch(`/api/route-elevation?${params}`);
            if (!res.ok) return null;
            return res.json();
        },
        enabled: enabled && (!!routeId || (!!worldName && !!routeName)),
        staleTime: ELEVATION_STALE_MS,
        gcTime: ELEVATION_STALE_MS,
    });
}
