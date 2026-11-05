import { NextResponse } from 'next/server';
import { buildLlmsTxt } from '@/lib/llmsTxt';
import { loadPublishedPosts } from '@/lib/postsServer';
import { buildNewsLlmsSection } from '@/lib/newsFeed';
import { loadPublicSnapshot } from '@/lib/publicSnapshot';
import { CODE_OF_CONDUCT_PREVIEW_URL, loadCodeOfConductText } from '@/lib/codeOfConduct';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.dansk-ecykling.dk';

export async function GET() {
    const siteUrl = SITE_URL.replace(/\/$/, '');
    const [snapshot, posts, codeOfConduct] = await Promise.all([
        loadPublicSnapshot(),
        loadPublishedPosts(20),
        loadCodeOfConductText(),
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
    const sections = [rules.replace(/\s*$/, ''), codeOfConductSection(codeOfConduct)];
    if (posts && posts.length) sections.push(buildNewsLlmsSection(posts, SITE_URL).replace(/\s*$/, ''));
    const body = `${sections.join('\n\n')}\n`;

    return new NextResponse(body, {
        headers: {
            'Content-Type': 'text/plain; charset=utf-8',
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
    });
}

/** The Code of Conduct from its Google Doc (the only copy), before the news so it survives truncation. */
function codeOfConductSection(text: string | null): string {
    const head = `## Code of Conduct\n\nDokument: ${CODE_OF_CONDUCT_PREVIEW_URL}`;
    return text ? `${head}\n\n${text}` : head;
}
