'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface PredictorConfig {
    features?: Record<string, unknown>;
}

export function usePredictorConfigQuery() {
    const { user } = useAuth();

    return useQuery<PredictorConfig>({
        queryKey: ['predictor-config'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/predictor-config`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch predictor config');
            return res.json();
        },
        enabled: !!user,
        staleTime: 5 * 60_000,
    });
}
