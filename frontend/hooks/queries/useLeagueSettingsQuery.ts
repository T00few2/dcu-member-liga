'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { LeagueSettings } from '@/types/admin';

export function useLeagueSettingsQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['league', 'settings', user ? 'auth' : 'public'],
        queryFn: async () => {
            const headers: HeadersInit = {};
            if (user) {
                headers.Authorization = `Bearer ${await user.getIdToken()}`;
            }
            const res = await fetch(`${API_URL}/league/settings`, { headers });
            if (!res.ok) throw new Error('Failed to fetch league settings');
            const data = await res.json();
            return (data.settings ?? {}) as LeagueSettings & {
                ligaCategories?: { name: string }[];
            };
        },
        staleTime: 5 * 60_000,
    });
}
