'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { StageRace } from '@/types/admin';

export function useStageRacesQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['stageRaces'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/stage-races`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch stage races');
            const data = await res.json();
            return (data.stageRaces ?? []) as StageRace[];
        },
        enabled: !!user,
        staleTime: 30_000,
    });
}
