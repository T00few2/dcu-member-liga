'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';
import type { DualRecordingVerification } from '@/types/admin';

export interface ProfileDrVerification extends DualRecordingVerification {
    zwiftId?: string;
    raceId?: string;
}

export function useProfileDrVerificationsQuery() {
    const { user } = useAuth();

    return useQuery<ProfileDrVerification[]>({
        queryKey: ['profile-dr-verifications'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/profile/dr-verifications`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return [];
            const data = await res.json();
            return data.verifications as ProfileDrVerification[];
        },
        enabled: !!user,
        staleTime: 60_000,
    });
}
