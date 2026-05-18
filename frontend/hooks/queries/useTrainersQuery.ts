'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface Trainer {
    id: string;
    name: string;
    status: string;
    dualRecordingRequired: boolean;
}

interface TrainerRequest {
    id: string;
    trainerName: string;
    requesterName: string;
    status: string;
    createdAt: number;
}

interface TrainersData {
    trainers: Trainer[];
    requests: TrainerRequest[];
}

export function useTrainersQuery() {
    const { user } = useAuth();

    return useQuery<TrainersData>({
        queryKey: ['trainers'],
        queryFn: async () => {
            const idToken = await user!.getIdToken();

            const [trainersRes, requestsRes] = await Promise.all([
                fetch(`${API_URL}/trainers`),
                fetch(`${API_URL}/trainers/requests`, {
                    headers: { Authorization: `Bearer ${idToken}` },
                }),
            ]);

            const trainers: Trainer[] = trainersRes.ok
                ? (await trainersRes.json()).trainers ?? []
                : [];

            const requests: TrainerRequest[] = requestsRes.ok
                ? (await requestsRes.json()).requests ?? []
                : [];

            return { trainers, requests };
        },
        enabled: !!user,
        staleTime: 60_000,
    });
}
