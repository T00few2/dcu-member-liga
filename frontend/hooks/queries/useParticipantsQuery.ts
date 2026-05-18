'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export function useParticipantsQuery() {
    const { user } = useAuth();

    return useQuery<unknown[]>({
        queryKey: ['participants'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/participants?limit=2000`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch participants');
            const data = await res.json();
            return data.participants ?? [];
        },
        enabled: !!user,
        staleTime: 2 * 60_000,
    });
}
