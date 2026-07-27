'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

export interface RouteTimeEstimate {
    wkg: number;
    minutes: number;
}

export interface RouteTimeEstimatesData {
    slug: string;
    url: string;
    rating: number | null;
    estimates: RouteTimeEstimate[];
    error?: string;
}

export function useRouteTimeEstimatesQuery(routeName: string) {
    return useQuery({
        queryKey: ['route-time-estimates', routeName],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/route-time-estimates?routeName=${encodeURIComponent(routeName)}`);
            if (!res.ok) throw new Error('Failed to fetch time estimates');
            return (await res.json()) as RouteTimeEstimatesData;
        },
        enabled: !!routeName,
        staleTime: 60 * 60_000,
    });
}
