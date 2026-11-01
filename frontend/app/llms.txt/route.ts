import { NextResponse } from 'next/server';
import { buildLlmsTxt } from '@/lib/llmsTxt';
import { loadPublishedPosts } from '@/lib/postsServer';
import { buildNewsLlmsSection } from '@/lib/newsFeed';
import { loadPublicSnapshot } from '@/lib/publicSnapshot';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.dansk-ecykling.dk';

export async function GET() {
    const siteUrl = SITE_URL.replace(/\/$/, '');
    const [snapshot, posts] = await Promise.all([
        loadPublicSnapshot(),
        loadPublishedPosts(20),
    ]);
    if (!snapshot.settings) {
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

    const rules = buildLlmsTxt({
        siteUrl: SITE_URL,
        settings: snapshot.settings,
        stageRaces: snapshot.stageRaces,
    });
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
