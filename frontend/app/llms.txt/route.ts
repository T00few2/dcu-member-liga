import { NextResponse } from 'next/server';
import { API_URL } from '@/lib/api';
import { buildLlmsTxt, type LlmsLeagueSettings, type LlmsStageRace } from '@/lib/llmsTxt';
import { loadPublishedPosts } from '@/lib/postsServer';
import { buildNewsLlmsSection } from '@/lib/newsFeed';

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

    const [stageBody, posts] = await Promise.all([
        loadJson<{ stageRaces?: LlmsStageRace[] }>('/stage-races'),
        loadPublishedPosts(20),
    ]);
    const rules = buildLlmsTxt({
        siteUrl: SITE_URL,
        settings,
        stageRaces: stageBody ? (stageBody.stageRaces ?? []) : null,
    });
    // The news section is left out when Firestore cannot be reached; the rules above still load.
    const body = posts && posts.length
        ? `${rules.replace(/\s*$/, '')}\n\n${buildNewsLlmsSection(posts, SITE_URL)}\n`
        : rules;

    return new NextResponse(body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
    });
}
