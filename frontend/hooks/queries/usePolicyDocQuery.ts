'use client';

import { useQuery } from '@tanstack/react-query';
import { API_URL } from '@/lib/api';

export interface PolicyDoc {
    policyKey: string;
    version: string;
    titleDa: string;
    contentMdDa: string;
    changeSummary?: string;
    publishedAt?: number | null;
}

export function usePolicyDocQuery(policyEndpoint: string, isOpen: boolean) {
    return useQuery({
        queryKey: ['policy', 'doc', policyEndpoint],
        queryFn: async () => {
            const res = await fetch(`${API_URL}/policy/${policyEndpoint}/current`);
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Kunne ikke hente politikken.');
            return data as PolicyDoc;
        },
        enabled: isOpen && !!policyEndpoint,
        staleTime: 5 * 60_000,
    });
}
