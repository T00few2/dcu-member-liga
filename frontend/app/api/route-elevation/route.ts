import { NextRequest, NextResponse } from 'next/server';
import { routes, segments } from 'zwift-data';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

type RouteSegment = {
    from: number;
    to: number;
    type: 'sprint' | 'climb' | 'segment';
    name: string;
    direction?: 'forward' | 'reverse';
};

type ProfileSegment = {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
};

function inferDirectionFromSegment(segmentSlug?: string | null, segmentName?: string | null): 'forward' | 'reverse' {
    const slug = (segmentSlug || '').toLowerCase();
    const name = (segmentName || '').toLowerCase();
    if (slug.endsWith('-rev') || slug.includes('-reverse')) return 'reverse';
    if (name.includes(' rev') || name.includes('reverse')) return 'reverse';
    return 'forward';
}

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
    const fresh = req.nextUrl.searchParams.get('fresh') === '1';
    const laps = Math.max(1, parseInt(req.nextUrl.searchParams.get('laps') ?? '1', 10) || 1);

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
    const routeSegments: RouteSegment[] = match.segmentsOnRoute
        .map((sor) => {
            const seg = segments.find((s) => s.slug === sor.segment);
            return {
                from: sor.from,
                to: sor.to,
                type: seg?.type ?? 'segment',
                name: seg?.name ?? sor.segment ?? 'Segment',
                direction: inferDirectionFromSegment(sor.segment, seg?.name ?? sor.segment),
            };
        });

    const upstream = await fetch(`${API_URL}/route-elevation/${match.stravaSegmentId}`, fresh
        ? { cache: 'no-store' }
        : { next: { revalidate: 86400 } }
    );

    if (!upstream.ok) {
        return NextResponse.json({ error: 'Failed to fetch elevation data' }, { status: 502 });
    }

    const data = await upstream.json();
    const singleLapProfileSegments: ProfileSegment[] = Array.isArray(data?.profileSegments)
        ? data.profileSegments
        : routeSegments.map((seg) => ({
            name: seg.name,
            type: seg.type,
            fromKm: seg.from,
            toKm: seg.to,
            direction: seg.direction,
        }));

    // Tile elevation arrays and profileSegments for multi-lap routes.
    // The backend returns data for a single lap (no lead-in); each subsequent lap is appended
    // with distance offset = lapLength * lapIndex.
    const singleLapDistances: number[] = Array.isArray(data?.distance) ? data.distance : [];
    const singleLapAltitudes: number[] = Array.isArray(data?.altitude) ? data.altitude : [];
    const lapLengthM = singleLapDistances.length > 0
        ? (singleLapDistances[singleLapDistances.length - 1] ?? 0)
        : 0;

    const tiledDistance: number[] = [];
    const tiledAltitude: number[] = [];
    for (let lap = 0; lap < laps; lap++) {
        const offsetM = lapLengthM * lap;
        for (let i = 0; i < singleLapDistances.length; i++) {
            tiledDistance.push((singleLapDistances[i] ?? 0) + offsetM);
            tiledAltitude.push(singleLapAltitudes[i] ?? 0);
        }
    }

    const lapLengthKm = lapLengthM / 1000;
    const profileSegments: ProfileSegment[] = [];
    for (let lap = 0; lap < laps; lap++) {
        const offsetKm = lapLengthKm * lap;
        for (const seg of singleLapProfileSegments) {
            profileSegments.push({
                ...seg,
                fromKm: seg.fromKm + offsetKm,
                toKm: seg.toKm + offsetKm,
            });
        }
    }

    return NextResponse.json(
        {
            ...data,
            distance: tiledDistance.length > 0 ? tiledDistance : data?.distance,
            altitude: tiledAltitude.length > 0 ? tiledAltitude : data?.altitude,
            segments: routeSegments,
            profileSegments,
            stravaSegmentId: match.stravaSegmentId,
            stravaSegmentUrl: match.stravaSegmentUrl || `https://www.strava.com/segments/${match.stravaSegmentId}`,
        },
        fresh
            ? { headers: { 'Cache-Control': 'no-store' } }
            : { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } }
    );
}
