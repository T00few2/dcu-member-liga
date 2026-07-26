import { NextRequest, NextResponse } from 'next/server';
import { routes } from 'zwift-data';

function slugify(value?: string | null): string {
    return (value || '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['"]/g, '')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export async function GET(req: NextRequest) {
    const world = req.nextUrl.searchParams.get('world');
    const route = req.nextUrl.searchParams.get('route');

    if (!world || !route) {
        return NextResponse.json({ error: 'Missing world or route param' }, { status: 400 });
    }

    const worldSlug = slugify(world);
    const routeSlug = slugify(route);
    const match = routes.find((r) => r.world === worldSlug && r.slug === routeSlug);

    if (!match?.stravaSegmentId) {
        return NextResponse.json({ error: 'No Strava segment found for this route' }, { status: 404 });
    }

    return NextResponse.json(
        {
            stravaSegmentId: match.stravaSegmentId,
            stravaSegmentUrl: match.stravaSegmentUrl || `https://www.strava.com/segments/${match.stravaSegmentId}`,
        },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
}
