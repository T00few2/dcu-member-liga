'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { DualRecordingVerification, PublicWeightVerificationRecord } from '@/types/live';

export function useRaceDrVerificationsQuery(raceId: string | null | undefined) {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['races', raceId, 'dr-verifications'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/races/${raceId}/dr-verifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return new Map<string, DualRecordingVerification>();
            const body = await res.json();
            const map = new Map<string, DualRecordingVerification>();
            (body.verifications ?? []).forEach(
                (v: DualRecordingVerification & { zwiftId?: string | number }) => {
                    const key = String(v.zwiftId ?? '');
                    if (key) map.set(key, v);
                },
            );
            return map;
        },
        enabled: !!user && !!raceId,
        staleTime: 60_000,
    });
}

export function useRaceWeightVerificationsQuery(raceId: string | null | undefined) {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['races', raceId, 'weight-verifications'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/races/${raceId}/weight-verifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return new Map<string, PublicWeightVerificationRecord>();
            const body = await res.json();
            const map = new Map<string, PublicWeightVerificationRecord>();
            (body.verifications ?? []).forEach(
                (v: PublicWeightVerificationRecord & { zwiftId?: string | number }) => {
                    const key = String(v.zwiftId ?? '');
                    if (key) map.set(key, v);
                },
            );
            return map;
        },
        enabled: !!user && !!raceId,
        staleTime: 60_000,
    });
}
