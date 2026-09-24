'use client';

import { useEffect, useMemo } from 'react';

import { useAuth } from '@/lib/auth-context';
import { useParticipantsQuery, useProfileQuery, useRacesQuery } from '@/hooks/queries';
import type { Race } from '@/types/live';
import { parseWeightKg } from './stats-helpers';

type UseStatsPageDataArgs = {
    selectedRaceId: string;
    setSelectedRaceId: (id: string) => void;
};

export function useStatsPageData({
    selectedRaceId,
    setSelectedRaceId,
}: UseStatsPageDataArgs) {
    const { loading: authLoading } = useAuth();
    const racesQuery = useRacesQuery();
    const profileQuery = useProfileQuery();
    const participantsQuery = useParticipantsQuery();

    const races = useMemo<Race[]>(() => {
        const list = Array.isArray(racesQuery.data) ? racesQuery.data : [];
        const finished = list.filter((r: Race) => r.results && Object.keys(r.results).length > 0);
        return [...finished].sort(
            (a: Race, b: Race) => new Date(b.date).getTime() - new Date(a.date).getTime(),
        );
    }, [racesQuery.data]);

    const profileData = (profileQuery.data ?? null) as
        | { zwiftId?: string | number; club?: string | null }
        | null;

    const currentUserZwiftId = profileData?.zwiftId
        ? String(profileData.zwiftId)
        : null;

    const currentUserCategory = useMemo(() => {
        if (!currentUserZwiftId) return null;
        const participants = Array.isArray(participantsQuery.data) ? participantsQuery.data : [];
        const me = participants.find((participant: unknown) => {
            const value = participant as { zwiftId?: string | number };
            return String(value?.zwiftId ?? '') === currentUserZwiftId;
        }) as { category?: string } | undefined;
        const category = String(me?.category ?? '').trim();
        return category && category !== 'N/A' ? category : null;
    }, [participantsQuery.data, currentUserZwiftId]);

    const currentUserClub = profileData?.club
        ? String(profileData.club)
        : null;

    const { clubByZwiftId, weightKgByZwiftId } = useMemo(() => {
        const nextClubMap: Record<string, string> = {};
        const nextWeightMap: Record<string, number> = {};
        const participants = Array.isArray(participantsQuery.data) ? participantsQuery.data : [];
        participants.forEach((participant: unknown) => {
            const value = participant as { zwiftId?: string | number; club?: string; weightInGrams?: unknown };
            const zwiftId = String(value?.zwiftId ?? '').trim();
            if (!zwiftId) return;
            if (typeof value?.club === 'string' && value.club.trim().length > 0) {
                nextClubMap[zwiftId] = value.club.trim();
            }
            const weightKg = parseWeightKg(value?.weightInGrams);
            if (weightKg) {
                nextWeightMap[zwiftId] = weightKg;
            }
        });
        return { clubByZwiftId: nextClubMap, weightKgByZwiftId: nextWeightMap };
    }, [participantsQuery.data]);

    useEffect(() => {
        if (races.length === 0) return;
        if (selectedRaceId && races.some((race) => race.id === selectedRaceId)) return;
        const raceFromUrl = typeof window !== 'undefined'
            ? new URLSearchParams(window.location.search).get('race')
            : null;
        const cleanedRaceFromUrl = raceFromUrl?.trim() || '';
        const raceExistsInList = cleanedRaceFromUrl
            ? races.some((race) => race.id === cleanedRaceFromUrl)
            : false;
        setSelectedRaceId(raceExistsInList ? cleanedRaceFromUrl : races[0].id);
    }, [races, selectedRaceId, setSelectedRaceId]);

    const isLoading = authLoading || racesQuery.isLoading || profileQuery.isLoading || participantsQuery.isLoading;

    return {
        races,
        currentUserZwiftId,
        currentUserCategory,
        currentUserClub,
        clubByZwiftId,
        weightKgByZwiftId,
        isLoading,
    };
}
