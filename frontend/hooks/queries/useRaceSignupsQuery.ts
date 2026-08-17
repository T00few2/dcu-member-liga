'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export type MyRaceSignupStatus = 'pending' | 'registered' | 'failed' | string;

export function useMyRaceSignupsQuery() {
    const { user } = useAuth();

    return useQuery<Record<string, { status: MyRaceSignupStatus }>>({
        queryKey: ['race-signups', 'mine', user?.uid],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/races/signups/mine`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch my race signups');
            const data = await res.json();
            return data.signups ?? {};
        },
        enabled: !!user,
        staleTime: 30_000,
    });
}

export function useRaceSignupCountsQuery() {
    return useQuery<Record<string, number>>({
        queryKey: ['race-signups', 'counts'],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/races/signup-counts`);
            if (!res.ok) throw new Error('Failed to fetch race signup counts');
            const data = await res.json();
            return data.counts ?? {};
        },
        staleTime: 30_000,
    });
}

export interface RaceSignupRow {
    zwiftId: string;
    name: string;
    club: string;
    ligaCategory: string;
    status: MyRaceSignupStatus;
}

export function useRaceSignupsQuery(raceId: string | null) {
    const { user } = useAuth();

    return useQuery<RaceSignupRow[]>({
        queryKey: ['race-signups', raceId],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/races/${raceId}/signups`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch race signups');
            const data = await res.json();
            return data.signups ?? [];
        },
        enabled: !!user && !!raceId,
        staleTime: 30_000,
    });
}
