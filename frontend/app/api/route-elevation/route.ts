import { NextRequest, NextResponse } from 'next/server';
import { routes, segments } from 'zwift-data';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

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

    // Map segmentsOnRoute to { from, to, type, name }.
    // Segment-level Strava fields are not required for rendering.
    const routeSegments = match.segmentsOnRoute
        .map((sor) => {
            const seg = segments.find((s) => s.slug === sor.segment);
            return {
                from: sor.from,
                to: sor.to,
                type: seg?.type ?? 'segment',
                name: seg?.name ?? sor.segment,
            };
        });

    const upstream = await fetch(`${API_URL}/route-elevation/${match.stravaSegmentId}`, {
        next: { revalidate: 86400 }, // route elevation never changes
    });

    if (!upstream.ok) {
        return NextResponse.json({ error: 'Failed to fetch elevation data' }, { status: 502 });
    }

    const data = await upstream.json();
    return NextResponse.json(
        {
            ...data,
            segments: routeSegments,
            stravaSegmentId: match.stravaSegmentId,
            stravaSegmentUrl: match.stravaSegmentUrl || `https://www.strava.com/segments/${match.stravaSegmentId}`,
        },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } }
    );
}
