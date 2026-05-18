'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface PendingVerification {
    id: string;
    name: string;
    email?: string;
    club: string;
    videoLink: string;
    submittedAt: string | any;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

interface ActiveRequest {
    id: string;
    name: string;
    email?: string;
    club: string;
    deadline: string | any;
}

interface ApprovedVerification {
    id: string;
    name: string;
    club: string;
    approvedAt: string | any;
    approvedBy: string;
    videoLink?: string;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

interface RejectedVerification {
    id: string;
    name: string;
    club: string;
    rejectedAt: string | any;
    rejectedBy: string;
    rejectionReason?: string;
    videoLink?: string;
    lastRaceWeightKg?: number | null;
    lastRaceName?: string | null;
    lastRaceDate?: string | null;
    latestProfileUpdatedAt?: string | null;
}

export interface WeightVerificationsList {
    pending: PendingVerification[];
    requests: ActiveRequest[];
    approved: ApprovedVerification[];
    rejected: RejectedVerification[];
}

export function useWeightVerificationsListQuery() {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['admin', 'weight-verifications'],
        queryFn: async (): Promise<WeightVerificationsList> => {
            const token = await user!.getIdToken();
            const headers = { Authorization: `Bearer ${token}` };

            const [pendingRes, requestsRes, approvedRes, rejectedRes] = await Promise.all([
                fetch(`${API_URL}/admin/verification/pending`, { headers }),
                fetch(`${API_URL}/admin/verification/requests`, { headers }),
                fetch(`${API_URL}/admin/verification/approved`, { headers }),
                fetch(`${API_URL}/admin/verification/rejected`, { headers }),
            ]);

            const [pendingData, requestsData, approvedData, rejectedData] = await Promise.all([
                pendingRes.ok ? pendingRes.json() : { pending: [] },
                requestsRes.ok ? requestsRes.json() : { requests: [] },
                approvedRes.ok ? approvedRes.json() : { approved: [] },
                rejectedRes.ok ? rejectedRes.json() : { rejected: [] },
            ]);

            return {
                pending: pendingData.pending ?? [],
                requests: requestsData.requests ?? [],
                approved: approvedData.approved ?? [],
                rejected: rejectedData.rejected ?? [],
            };
        },
        enabled: !!user,
        staleTime: 30_000,
    });
}
