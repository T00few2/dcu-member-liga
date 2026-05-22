'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import type { LiveRidersResponse } from '@/types/live';

export function useLiveRidersQuery(raceId: string | undefined, category: string | undefined) {
    return useQuery<LiveRidersResponse | null>({
        queryKey: ['live-race', 'riders', raceId, category],
        queryFn: async () => {
            const params = new URLSearchParams({ cat: category! });
            const res = await fetch(`${API_URL}/races/${raceId}/live-riders?${params}`);
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!raceId && !!category,
        refetchInterval: 3_000,
        staleTime: 0,
    });
}
