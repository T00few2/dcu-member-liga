'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { API_URL } from '@/lib/api';

interface VerificationRequest {
    requestId?: string;
    type?: string;
    status?: string;
    requestedAt?: number | null;
    deadline?: number | null;
    videoLink?: string | null;
    submittedAt?: number | null;
    reviewedAt?: number | null;
    reviewerId?: string | null;
    rejectionReason?: string | null;
}

export interface UserDetail {
    userId: string;
    basic: {
        name: string;
        email: string;
        zwiftId: string;
        club: string;
        trainer: string;
        createdAt?: number | null;
        updatedAt?: number | null;
    };
    zwiftProfile?: {
        ftp?: number | null;
        zftp?: number | null;
        zmap?: number | null;
        weight?: number | null;
        weightInGrams?: number | null;
        height?: number | null;
        racingScore?: number | null;
        powerCompoundScore?: number | null;
        vo2max?: number | null;
        category?: string | null;
        updatedAt?: number | null;
    } | null;
    zwiftPowerCurve?: {
        zftp?: number | null;
        zmap?: number | null;
        vo2max?: number | null;
        validPowerProfile?: boolean | null;
        cpBestEfforts?: Array<{ duration: number; watts: number; wattsPerKg?: number }>;
        relevantCpEfforts?: Array<{ duration: number; watts: number; wattsPerKg?: number }>;
        updatedAt?: number | null;
    } | null;
    zwiftRacing?: {
        currentRating?: number | null;
        max30Rating?: number | null;
        max90Rating?: number | null;
        phenotype?: string | null;
        updatedAt?: number | null;
    } | null;
    connections: {
        zwift: { connected: boolean; connectedAt?: number | null; profileId?: string | null; userId?: string | null };
        strava: { connected: boolean; athleteId?: number | string | null };
    };
    ligaCategory: {
        category?: string | null;
        locked: boolean;
        lockedAt?: number | null;
        autoAssigned?: {
            season?: string | null;
            category?: string | null;
            upperBoundary?: number | null;
            graceLimit?: number | null;
            status?: string | null;
            assignedRating?: number | null;
            assignedAt?: number | null;
            lastCheckedRating?: number | null;
            lastCheckedAt?: number | null;
        } | null;
        selfSelected?: {
            category?: string | null;
            selfSelectedAt?: number | null;
        } | null;
    };
    verification: {
        status: string;
        currentRequest?: VerificationRequest | null;
        history: VerificationRequest[];
    };
    registration: {
        status?: string | null;
        cocAccepted: boolean;
        dataPolicy?: { version?: string | null; acceptedAt?: number | null } | null;
        publicResultsConsent?: { version?: string | null; acceptedAt?: number | null } | null;
    };
}

export interface RaceEntry {
    raceId: string;
    name: string;
    date: string;
    map: string;
    category: string;
    finishTime?: number | null;
    finishRank?: number | null;
    finishPoints?: number | null;
    sprintPoints?: number | null;
    totalPoints?: number | null;
    raceStatus?: string;
    archive?: string | null;
    disqualified: boolean;
    declassified: boolean;
    flaggedSandbagging: boolean;
    flaggedCheating: boolean;
    activityId?: string | null;
    sprintData?: Record<string, { time?: number; avgPower?: number; rank?: number }>;
    sprintDetails?: Record<string, number | string>;
    criticalP?: Record<string, number>;
}

export interface UserDetailsData {
    detail: UserDetail;
    races: RaceEntry[];
}

export function useUserDetailsQuery(userId: string | null) {
    const { user } = useAuth();

    return useQuery({
        queryKey: ['admin', 'users', userId],
        queryFn: async (): Promise<UserDetailsData> => {
            const token = await user!.getIdToken();
            const headers = { Authorization: `Bearer ${token}` };

            const [detailRes, racesRes] = await Promise.all([
                fetch(`${API_URL}/admin/users/${encodeURIComponent(userId!)}`, { headers }),
                fetch(`${API_URL}/admin/users/${encodeURIComponent(userId!)}/races`, { headers }),
            ]);

            const detailData = await detailRes.json();
            const racesData = await racesRes.json();

            if (!detailRes.ok) {
                throw new Error(detailData.error ?? 'Failed to load user details');
            }

            return {
                detail: detailData.user,
                races: racesRes.ok && racesData.races ? racesData.races : [],
            };
        },
        enabled: !!userId,
        staleTime: 60_000,
    });
}
