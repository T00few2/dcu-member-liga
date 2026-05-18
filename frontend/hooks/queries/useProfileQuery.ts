'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface LigaCategory {
    category: string;
    upperBoundary: number | null;
    graceLimit: number | null;
    assignedRating: number;
    status: string;
    assignedAt?: number;
    lastCheckedRating?: number;
    lastCheckedAt?: number;
    locked?: boolean;
    lockedAt?: number;
    autoAssignedCategory?: string;
    selfSelectedCategory?: string;
}

export interface ProfileData {
    name: string;
    zwiftId: string;
    ligaCategory?: LigaCategory;
}

export function useProfileQuery() {
    const { user } = useAuth();

    return useQuery<ProfileData | null>({
        queryKey: ['profile'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/profile`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!user,
        staleTime: 5 * 60_000,
    });
}
