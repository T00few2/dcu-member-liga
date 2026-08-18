'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

export type DualRecordingBucket = 'required' | 'notRequired' | 'unknown';

export interface TrainerStat {
    trainer: string;
    count: number;
    dualRecording: DualRecordingBucket;
}

export interface StatsData {
    total: number;
    clubCount: number;
    lockedCount: number;
    selfSelectedCount: number;
    leagueName?: string;
    seasonStart?: string;
    growthSeries: { date: string; signups: number; clubs: number }[];
    registrationStatus: { status: string; count: number }[];
    categoryDistribution: { category: string; count: number }[];
    clubDistribution: { club: string; count: number }[];
    trainerDistribution: TrainerStat[];
    trainerByCategory: { category: string; total: number; trainers: TrainerStat[] }[];
    dualRecordingDistribution: { bucket: DualRecordingBucket; count: number }[];
    dualRecordingByCategory: {
        category: string;
        required: number;
        notRequired: number;
        unknown: number;
        total: number;
    }[];
    verificationStatus: { status: string; count: number }[];
    phenotypeDistribution: { phenotype: string; count: number }[];
}

export function useAdminStatsQuery() {
    const { user } = useAuth();

    return useQuery<StatsData>({
        queryKey: ['admin-stats'],
        queryFn: async () => {
            const token = await user!.getIdToken();
            const res = await fetch(`${API_URL}/admin/stats`, {
                headers: { Authorization: `Bearer ${token}` },
            });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res.json();
        },
        enabled: !!user,
        staleTime: 2 * 60_000,
    });
}
