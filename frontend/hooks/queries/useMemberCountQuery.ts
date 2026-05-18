'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

export function useMemberCountQuery() {
    return useQuery<number | null>({
        queryKey: ['member-count'],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/public/member-count`);
            if (!res.ok) return null;
            const data = await res.json();
            return data?.memberCount ?? null;
        },
        staleTime: 5 * 60_000,
    });
}
