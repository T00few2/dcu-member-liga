'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import type { CurrentLiveRace } from '@/types/live';

export function useCurrentLiveRaceQuery() {
    return useQuery<CurrentLiveRace | null>({
        queryKey: ['live-race', 'current'],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/live-race/current`);
            if (res.status === 204) return null;
            if (!res.ok) return null;
            return res.json();
        },
        refetchInterval: 30_000,
        staleTime: 15_000,
    });
}
