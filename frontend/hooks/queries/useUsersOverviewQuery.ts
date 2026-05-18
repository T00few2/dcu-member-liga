'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export interface UserRow {
    userId: string;
    zwiftId: string;
    name: string;
    email: string;
    club: string;
    trainer: string;
    category: string;
    categoryLocked: boolean;
    zwiftConnected: boolean;
    stravaConnected: boolean;
    needsStravaForDR: boolean;
    verificationStatus: string;
    currentRating: number | string;
    max30Rating: number | string;
    phenotype: string;
    signedUpAt: number | null;
}

export function useUsersOverviewQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['admin', 'users'],
        queryFn: async (): Promise<UserRow[]> => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/users`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const data = await res.json();
            return data.users ?? [];
        },
        enabled: !!user,
        staleTime: 2 * 60_000,
    });
}
