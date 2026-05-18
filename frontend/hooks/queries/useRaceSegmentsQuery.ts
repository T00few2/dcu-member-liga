'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

interface EventSegmentInstance {
    id: string;
    count: number;
    direction?: string;
    lap?: number;
}

export function useRaceSegmentsQuery(
    routeId: string | number | undefined,
    laps: number,
    enabled: boolean,
) {
    return useQuery<EventSegmentInstance[]>({
        queryKey: ['race-segments', routeId, laps],
        queryFn: async () => {
            const params = new URLSearchParams({ routeId: String(routeId), laps: String(laps) });
            const res = await fetch(`${API_URL}/segments?${params}`);
            if (!res.ok) return [];
            const json = await res.json();
            const raw = Array.isArray(json?.segments) ? json.segments : [];
            return raw.map((s: any) => ({
                id: String(s?.id ?? ''),
                count: Number(s?.count) || 0,
                direction: s?.direction,
                lap: Number(s?.lap) || 0,
            })) as EventSegmentInstance[];
        },
        enabled: !!routeId && enabled,
        staleTime: 5 * 60_000,
    });
}
