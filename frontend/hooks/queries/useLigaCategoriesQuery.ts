'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export interface LigaCategoryRider {
    zwiftId: string;
    name: string;
    club: string;
    currentRating: number | string;
    max30Rating: number | string;
    max90Rating: number | string;
    effectiveRating: number | string;
    ligaCategory: {
        category: string;
        upperBoundary: number | null;
        graceLimit: number | null;
        assignedRating: number;
        status: 'ok' | 'grace' | 'over';
        lastCheckedRating: number;
        lastCheckedAt?: number;
        assignedAt?: number;
        locked?: boolean;
        autoAssignedCategory?: string;
        selfSelectedCategory?: string;
    } | null;
}

export function useLigaCategoriesQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['admin', 'liga-categories'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/liga-categories`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch liga categories');
            const data = await res.json();
            return (data.riders ?? []) as LigaCategoryRider[];
        },
        enabled: !!user,
        staleTime: 2 * 60_000,
    });
}
