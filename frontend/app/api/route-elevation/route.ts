import { NextRequest, NextResponse } from 'next/server';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

type ProfileSegment = {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
};

function asProfileSegments(raw: unknown): ProfileSegment[] {
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((seg) => {
        if (!seg || typeof seg !== 'object') return [];
        const row = seg as {
            name?: unknown;
            type?: unknown;
            fromKm?: unknown;
            toKm?: unknown;
            direction?: unknown;
        };
        const name = typeof row.name === 'string' ? row.name : '';
        const fromKm = Number(row.fromKm);
        const toKm = Number(row.toKm);
        if (!name || !Number.isFinite(fromKm) || !Number.isFinite(toKm)) return [];
        const type = row.type === 'sprint' || row.type === 'climb' || row.type === 'segment'
            ? row.type
            : 'segment';
        const direction = row.direction === 'reverse' ? 'reverse' : 'forward';
        return [{ name, type, fromKm, toKm, direction }];
    });
}

function asLine(raw: unknown): { distance: number[]; altitude: number[] } | null {
    if (!raw || typeof raw !== 'object') return null;
    const row = raw as { distance?: unknown; altitude?: unknown };
    const distance = Array.isArray(row.distance) ? row.distance.map(Number) : [];
    const altitude = Array.isArray(row.altitude) ? row.altitude.map(Number) : [];
    if (distance.length < 2 || distance.length !== altitude.length) return null;
    if (!distance.every(Number.isFinite) || !altitude.every(Number.isFinite)) return null;
    return { distance, altitude };
}

export async function GET(req: NextRequest) {
    const routeId = req.nextUrl.searchParams.get('routeId');
    const world = req.nextUrl.searchParams.get('world');
    const route = req.nextUrl.searchParams.get('route');
    const fresh = req.nextUrl.searchParams.get('fresh') === '1';

    if (!routeId && (!world || !route)) {
        return NextResponse.json({ error: 'Missing route' }, { status: 400 });
    }

    const params = new URLSearchParams();
    if (routeId) params.set('routeId', routeId);
    if (world) params.set('world', world);
    if (route) params.set('route', route);

    const upstream = await fetch(`${API_URL}/route-sauce-profile?${params}`, fresh
        ? { cache: 'no-store' }
        : { next: { revalidate: 86400 } }
    );
    if (!upstream.ok) {
        const status = upstream.status === 404 ? 404 : 502;
        return NextResponse.json({ error: 'No Sauce profile for this route' }, { status });
    }

    const data = await upstream.json();
    const lap = asLine(data);
    if (!lap) {
        return NextResponse.json({ error: 'No Sauce profile for this route' }, { status: 404 });
    }
    const downsampled = downsampleElevation(lap.distance, lap.altitude, 400);
    const profileSegments = asProfileSegments(data?.profileSegments);
    const leadInProfile = asLine(data?.leadInProfile);
    const leadInDistance = Number(data?.leadInDistance);

    return NextResponse.json(
        {
            routeId: data?.routeId ?? routeId,
            distance: downsampled.distance,
            altitude: downsampled.altitude,
            segments: profileSegments.map((seg) => ({
                from: seg.fromKm,
                to: seg.toKm,
                type: seg.type,
                name: seg.name,
                direction: seg.direction,
            })),
            profileSegments,
            leadInDistance: Number.isFinite(leadInDistance) ? leadInDistance : undefined,
            leadInProfile,
        },
        fresh
            ? { headers: { 'Cache-Control': 'no-store' } }
            : { headers: { 'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800' } }
    );
}

function downsampleElevation(
    distance: number[],
    altitude: number[],
    targetPoints: number,
): { distance: number[]; altitude: number[] } {
    if (distance.length <= targetPoints) {
        return { distance, altitude };
    }
    const step = Math.max(1, Math.floor(distance.length / targetPoints));
    const outD: number[] = [];
    const outA: number[] = [];
    for (let i = 0; i < distance.length; i += step) {
        outD.push(distance[i] ?? 0);
        outA.push(altitude[i] ?? 0);
    }
    const last = distance.length - 1;
    if (outD[outD.length - 1] !== distance[last]) {
        outD.push(distance[last] ?? 0);
        outA.push(altitude[last] ?? 0);
    }
    return { distance: outD, altitude: outA };
}
