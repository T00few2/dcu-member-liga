import { cache } from 'react';
import { API_URL } from '@/lib/api';
import type { LeagueSettings, StageRace } from '@/types/admin';

export type PublicSnapshot = {
    settings: LeagueSettings | null;
    stageRaces: StageRace[] | null;
};

async function loadJson<T>(path: string): Promise<T | null> {
    try {
        const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

/**
 * The public league, loaded on the server for /llms.txt and the pages crawlers read.
 * One function so those surfaces cannot drift apart. null means that part could not be loaded.
 */
export const loadPublicSnapshot = cache(async (): Promise<PublicSnapshot> => {
    const [settingsBody, stageBody] = await Promise.all([
        loadJson<{ settings?: LeagueSettings }>('/league/settings'),
        loadJson<{ stageRaces?: StageRace[] }>('/stage-races'),
    ]);
    const settings = settingsBody?.settings;
    return {
        settings: settings && typeof settings === 'object' ? settings : null,
        stageRaces: stageBody ? (stageBody.stageRaces ?? []) : null,
    };
});

export type PublicPolicy = {
    policyKey: string;
    version: string;
    titleDa: string;
    contentMdDa: string;
    changeSummary?: string;
    publishedAt?: number | null;
};

export async function loadCurrentPolicy(policyKey: string): Promise<PublicPolicy | null> {
    const data = await loadJson<PublicPolicy>(`/policy/${policyKey}/current`);
    if (!data?.contentMdDa) return null;
    return data;
}
