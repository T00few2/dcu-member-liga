'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { normalizeRace } from '@/lib/firestore-normalizers';
import type { Race } from '@/types/live';

export function useRacesQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['races', user ? 'auth' : 'public'],
        queryFn: async () => {
            const headers: HeadersInit = {};
            if (user) {
                headers.Authorization = `Bearer ${await user.getIdToken()}`;
            }
            const res = await fetch(`${API_URL}/races`, { headers });
            if (!res.ok) throw new Error('Failed to fetch races');
            const data = await res.json();
            return (data.races ?? []).map((r: Race) => normalizeRace(r, r.id)) as Race[];
        },
        staleTime: 30_000,
    });
}
