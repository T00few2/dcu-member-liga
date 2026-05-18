'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { StandingEntry } from '@/types/live';

export function useLeagueStandingsQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['league', 'standings'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/league/standings`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch league standings');
            const data = await res.json();
            return (data.standings ?? {}) as Record<string, StandingEntry[]>;
        },
        enabled: !!user,
        staleTime: 30_000,
    });
}
