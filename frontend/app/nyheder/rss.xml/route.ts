import { loadPublishedPosts } from '@/lib/postsServer';
import { buildNewsRss } from '@/lib/newsFeed';

export const dynamic = 'force-dynamic';

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://www.dansk-ecykling.dk';

export async function GET() {
    const posts = await loadPublishedPosts(30);
    if (posts === null) {
        return new Response('Nyhederne kunne ikke hentes lige nu.\n', {
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
        });
    }
    return new Response(buildNewsRss(posts, SITE_URL), {
        headers: {
            'Content-Type': 'application/rss+xml; charset=utf-8',
            'Cache-Control': 'public, max-age=300, stale-while-revalidate=60',
        },
    });
}
