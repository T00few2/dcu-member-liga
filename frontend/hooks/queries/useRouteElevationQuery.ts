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

export function useRouteElevationQuery(
    worldName: string | undefined,
    routeName: string | undefined,
    laps: number,
) {
    return useQuery<RouteElevationData | null>({
        queryKey: ['route-elevation', worldName, routeName, laps],
        queryFn: async () => {
            const params = new URLSearchParams({
                world: worldName!,
                route: routeName!,
                laps: String(laps),
            });
            const res = await fetch(`/api/route-elevation?${params}`);
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!worldName && !!routeName,
        staleTime: 5 * 60_000,
    });
}
