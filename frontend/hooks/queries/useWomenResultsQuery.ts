'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { StageRace } from '@/types/admin';
import type { Race, StandingEntry } from '@/types/live';

export type WomenResults = {
    standings: Record<string, StandingEntry[]>;
    races: { id: string; results: NonNullable<Race['results']> }[];
    events: { id: string; standings: NonNullable<StageRace['standings']> }[];
};

export function useWomenResultsQuery(enabled: boolean) {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['results-women', user?.uid ?? 'anon'],
        enabled: enabled && !!user,
        queryFn: async (): Promise<WomenResults> => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/results/women`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch women results');
            return res.json();
        },
        staleTime: 30_000,
    });
}
