import { NextRequest, NextResponse } from 'next/server';
import { resolveZwiftRoute } from '@/lib/zwiftRouteCatalog';

export async function GET(req: NextRequest) {
    const world = req.nextUrl.searchParams.get('world');
    const route = req.nextUrl.searchParams.get('route');

    if (!world || !route) {
        return NextResponse.json({ error: 'Missing world or route param' }, { status: 400 });
    }

    const match = resolveZwiftRoute(world, route);
    if (!match) {
        return NextResponse.json({ error: 'No Strava segment found for this route' }, { status: 404 });
    }

    return NextResponse.json(
        {
            stravaSegmentId: match.stravaSegmentId,
            stravaSegmentUrl: match.stravaSegmentUrl,
        },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
}
