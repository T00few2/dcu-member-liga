'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export interface NotificationState {
    latestDrFailedAt: string | null;
    drReportSeenAt: string | null;
    latestSwFlaggedAt: string | null;
    swReportSeenAt: string | null;
}

export function useNotificationStateQuery() {
    const { user } = useAuth();

    return useQuery<NotificationState | null>({
        queryKey: ['notification-state'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/profile/notification-state`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) return null;
            return res.json();
        },
        enabled: !!user,
        staleTime: 30_000,
    });
}
