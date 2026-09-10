'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export interface StreamRiderRow {
    zwiftId: string;
    publicId?: string;
    category?: string;
    status?: string;
    subgroupId?: string;
    lastError?: string;
}

export function useStreamRidersQuery(raceId: string | null) {
    const { user } = useAuth();

    return useQuery<StreamRiderRow[]>({
        queryKey: ['admin', 'stream-riders', raceId],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${raceId}/stream-riders`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch stream riders');
            const data = await res.json();
            return (data.riders ?? []) as StreamRiderRow[];
        },
        enabled: !!user && !!raceId,
        staleTime: 15_000,
    });
}

export function useAddStreamRiderMutation(raceId: string | null) {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (body: { zwiftId: string; publicId?: string; category?: string }) => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${raceId}/stream-riders`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(body),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Sign up failed');
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'stream-riders', raceId] });
        },
    });
}

export function useRemoveStreamRiderMutation(raceId: string | null) {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (zwiftId: string) => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/races/${raceId}/stream-riders/${zwiftId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Sign off failed');
            return data;
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'stream-riders', raceId] });
        },
    });
}
