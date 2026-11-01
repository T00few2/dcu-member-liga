'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import { useSeededStageRaces } from '@/components/public/PublicSnapshotSeed';
import type { StageRace } from '@/types/admin';

export function useStageRacesQuery() {
    const { user } = useAuth();
    const seeded = useSeededStageRaces();

    return useQuery({
        queryKey: ['stageRaces', user ? 'auth' : 'public'],
        queryFn: async () => {
            const headers: HeadersInit = {};
            if (user) {
                headers.Authorization = `Bearer ${await user.getIdToken()}`;
            }
            const res = await fetch(`${API_URL}/stage-races`, { headers });
            if (!res.ok) throw new Error('Failed to fetch stage races');
            const data = await res.json();
            return (data.stageRaces ?? []) as StageRace[];
        },
        initialData: !user && seeded ? seeded : undefined,
        staleTime: 30_000,
    });
}
