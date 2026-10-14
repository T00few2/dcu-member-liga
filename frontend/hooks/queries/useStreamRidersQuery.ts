'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export interface StreamRiderRow {
    zwiftId: string;
    publicId?: string;
    category?: string;
    status?: string;
    registeredCount?: number;
    raceCount?: number;
    lastError?: string;
}

export function useStreamRidersQuery() {
    const { user } = useAuth();

    return useQuery<StreamRiderRow[]>({
        queryKey: ['admin', 'stream-riders'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/stream-riders`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error('Failed to fetch stream riders');
            const data = await res.json();
            return (data.riders ?? []) as StreamRiderRow[];
        },
        enabled: !!user,
        staleTime: 15_000,
    });
}

export function useAddStreamRiderMutation() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (body: { zwiftId: string; publicId?: string; category?: string }) => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/stream-riders`, {
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
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'stream-riders'] });
        },
    });
}

export function useRemoveStreamRiderMutation() {
    const { user } = useAuth();
    const queryClient = useQueryClient();

    return useMutation({
        mutationFn: async (zwiftId: string) => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/stream-riders/${zwiftId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` },
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.message || 'Sign off failed');
            return data;
        },
        onSettled: () => {
            queryClient.invalidateQueries({ queryKey: ['admin', 'stream-riders'] });
        },
    });
}
