import { NextRequest, NextResponse } from 'next/server';
import { routes, segments } from 'zwift-data';

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

function inferDirectionFromSegment(segmentSlug?: string | null, segmentName?: string | null): 'forward' | 'reverse' {
    const slug = (segmentSlug || '').toLowerCase();
    const name = (segmentName || '').toLowerCase();
    if (slug.endsWith('-rev') || slug.includes('-reverse')) return 'reverse';
    if (name.includes(' rev') || name.includes('reverse')) return 'reverse';
    return 'forward';
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

    // Route-relative start/end km come from zwift-data segmentsOnRoute (Strava-linked
    // Zwift segments placed on the route). Strava's segment API does not provide
    // distance-along-parent-route by itself.
    const defaultProfileSegments = (match.segmentsOnRoute || []).map((sor) => {
        const seg = segments.find((s) => s.slug === sor.segment);
        const name = seg?.name ?? sor.segment ?? 'Segment';
        const type = seg?.type === 'sprint' || seg?.type === 'climb' || seg?.type === 'segment'
            ? seg.type
            : 'segment';
        return {
            name,
            type,
            fromKm: Number(sor.from) || 0,
            toKm: Number(sor.to) || 0,
            direction: inferDirectionFromSegment(sor.segment, name),
            stravaSegmentId: seg?.stravaSegmentId ?? null,
        };
    });

    return NextResponse.json(
        {
            stravaSegmentId: match.stravaSegmentId,
            stravaSegmentUrl: match.stravaSegmentUrl || `https://www.strava.com/segments/${match.stravaSegmentId}`,
            defaultProfileSegments,
        },
        { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } },
    );
}
