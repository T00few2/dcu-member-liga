'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';
import type { Route } from '@/types/admin';

export function useRoutesQuery() {
    return useQuery({
        queryKey: ['routes'],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/routes`);
            if (!res.ok) throw new Error('Failed to fetch routes');
            const data = await res.json();
            return (data.routes ?? []) as Route[];
        },
        staleTime: 10 * 60_000,
    });
}
