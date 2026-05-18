'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { normalizeRace } from '@/lib/firestore-normalizers';
import type { Race } from '@/types/live';

export function useRacesQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['races'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/races`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch races');
            const data = await res.json();
            return (data.races ?? []).map((r: Race) => normalizeRace(r, r.id)) as Race[];
        },
        enabled: !!user,
        staleTime: 30_000,
    });
}
