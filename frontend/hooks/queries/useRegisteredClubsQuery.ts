'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

export function useRegisteredClubsQuery() {
    return useQuery<Record<string, string>>({
        queryKey: ['live-race', 'clubs'],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/live-race/clubs`);
            if (!res.ok) return {};
            const data = await res.json();
            const clubs = data?.clubs;
            if (!clubs || typeof clubs !== 'object') return {};
            const out: Record<string, string> = {};
            for (const [zwiftId, club] of Object.entries(clubs)) {
                const id = String(zwiftId || '').trim();
                const name = String(club || '').trim();
                if (id && name) out[id] = name;
            }
            return out;
        },
        staleTime: 5 * 60_000,
    });
}
