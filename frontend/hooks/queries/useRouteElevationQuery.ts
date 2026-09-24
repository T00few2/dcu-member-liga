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
    segments?: RouteSegment[];
    profileSegments?: ProfileSegment[];
}

const ELEVATION_STALE_MS = 24 * 60 * 60_000;

export function useRouteElevationQuery(
    worldName: string | undefined,
    routeName: string | undefined,
    _laps: number,
    options?: { enabled?: boolean },
) {
    const enabled = options?.enabled ?? true;
    return useQuery<RouteElevationData | null>({
        queryKey: ['route-elevation', worldName, routeName],
        queryFn: async () => {
            const params = new URLSearchParams({
                world: worldName!,
                route: routeName!,
            });
            const res = await fetch(`/api/route-elevation?${params}`);
            if (!res.ok) return null;
            return res.json();
        },
        enabled: enabled && !!worldName && !!routeName,
        staleTime: ELEVATION_STALE_MS,
        gcTime: ELEVATION_STALE_MS,
    });
}
