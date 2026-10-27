import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { buildLlmsTxt, type LlmsLeagueSettings, type LlmsStageRace } from '@/lib/llmsTxt';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.dansk-ecykling.dk';

async function loadJson<T>(path: string): Promise<T | null> {
    try {
        const res = await fetch(`${API_URL}${path}`, { cache: 'no-store' });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

export async function GET() {
    const settingsBody = await loadJson<{ settings?: LlmsLeagueSettings }>('/league/settings');
    const settings = settingsBody?.settings;
    if (!settings) {
        const siteUrl = SITE_URL.replace(/\/$/, '');
        return new NextResponse(
            `# DCU E-serien\n\nLigaens aktuelle regler kunne ikke hentes. Se ${siteUrl}/info\n`,
            {
                status: 503,
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                },
            },
        );
    }

    const stageBody = await loadJson<{ stageRaces?: LlmsStageRace[] }>('/stage-races');
    const body = buildLlmsTxt({
        siteUrl: SITE_URL,
        settings,
        stageRaces: stageBody ? (stageBody.stageRaces ?? []) : null,
    });

    return new NextResponse(body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
    });
}
