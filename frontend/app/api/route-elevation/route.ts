import { NextRequest, NextResponse } from 'next/server';
import {
    mergeMeasuredProfileSegments,
    normalizeProfileSegmentDirection,
    normalizeProfileSegmentName,
    omitWholeLapProfileSegments,
    resolveRaceRelativeProfileSegments,
} from '@/lib/routeProfileSegments';
import { resolveZwiftRoute, zwiftCatalogSegments } from '@/lib/zwiftRouteCatalog';

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

const GENERIC_SEGMENT_NAMES = new Set(['sprint', 'kom', 'climb']);

function classifyMeasuredSegment(name: string, direction?: string): ProfileSegment | null {
    const wantedName = normalizeProfileSegmentName(name);
    const wantedDir = normalizeProfileSegmentDirection(direction, name);
    if (!wantedName || GENERIC_SEGMENT_NAMES.has(wantedName)) return null;

    const hits = zwiftCatalogSegments.filter(
        (seg) => normalizeProfileSegmentName(seg.name) === wantedName,
    );
    const directed = hits.filter(
        (seg) => inferDirectionFromSegment(seg.slug, seg.name, seg.whatsOnZwiftUrl) === wantedDir,
    );
    const hit = directed[0] ?? (hits.length === 1 ? hits[0] : undefined);
    if (hit?.type === 'sprint' || hit?.type === 'climb') {
        return {
            name: hit.name,
            type: hit.type,
            fromKm: 0,
            toKm: 0,
            direction: inferDirectionFromSegment(hit.slug, hit.name, hit.whatsOnZwiftUrl),
        };
    }
    if (wantedName.includes('sprint')) {
        return { name, type: 'sprint', fromKm: 0, toKm: 0, direction: wantedDir };
    }
    if (wantedName.includes('kom') || wantedName.includes('climb')) {
        return { name, type: 'climb', fromKm: 0, toKm: 0, direction: wantedDir };
    }
    return null;
}

async function fetchLeadInProfile(
    routeId: number,
    fresh: boolean,
): Promise<{ distance: number[]; altitude: number[] } | null> {
    try {
        const res = await fetch(`${API_URL}/route-leadin-elevation?routeId=${routeId}`, fresh
            ? { cache: 'no-store', signal: AbortSignal.timeout(4000) }
            : { next: { revalidate: 86400 }, signal: AbortSignal.timeout(4000) }
        );
        if (!res.ok) return null;
        const json = await res.json();
        const distance = Array.isArray(json?.distance) ? json.distance.map(Number) : [];
        const altitude = Array.isArray(json?.altitude) ? json.altitude.map(Number) : [];
        if (distance.length < 2 || distance.length !== altitude.length) return null;
        if (!distance.every(Number.isFinite) || !altitude.every(Number.isFinite)) return null;
        const end = distance[distance.length - 1] ?? 0;
        if (!(end > 1)) return null;
        return { distance, altitude };
    } catch {
        return null;
    }
}

async function fetchMeasuredProfileSegments(routeId: number, fresh: boolean): Promise<ProfileSegment[]> {
    try {
        const res = await fetch(`${API_URL}/route-profile-segments?routeId=${routeId}`, fresh
            ? { cache: 'no-store', signal: AbortSignal.timeout(4000) }
            : { next: { revalidate: 86400 }, signal: AbortSignal.timeout(4000) }
        );
        if (!res.ok) return [];
        const json = await res.json();
        if (!Array.isArray(json?.segments)) return [];
        return json.segments.flatMap((seg: { name?: string; direction?: string; fromKm?: number; toKm?: number }) => {
            if (!seg || typeof seg.name !== 'string') return [];
            const fromKm = Number(seg.fromKm);
            const toKm = Number(seg.toKm);
            if (!Number.isFinite(fromKm) || !Number.isFinite(toKm)) return [];
            const classified = classifyMeasuredSegment(seg.name, seg.direction);
            if (!classified) return [];
            return [{ ...classified, fromKm, toKm }];
        });
    } catch {
        return [];
    }
}

function inferDirectionFromSegment(
    segmentSlug?: string | null,
    segmentName?: string | null,
    whatsOnZwiftUrl?: string | null,
): 'forward' | 'reverse' {
    const slug = (segmentSlug || '').toLowerCase();
    const name = (segmentName || '').toLowerCase();
    const url = (whatsOnZwiftUrl || '').toLowerCase();
    if (slug.endsWith('-rev') || slug.includes('-reverse')) return 'reverse';
    if (name.includes(' rev') || name.includes('reverse')) return 'reverse';
    // e.g. tchou-tchou-sprint slug is forward-named but WoZ path ends with /reverse
    if (url.includes('/reverse')) return 'reverse';
    return 'forward';
}

export async function GET(req: NextRequest) {
    const world = req.nextUrl.searchParams.get('world');
    const route = req.nextUrl.searchParams.get('route');
    const fresh = req.nextUrl.searchParams.get('fresh') === '1';

    if (!world || !route) {
        return NextResponse.json({ error: 'Missing world or route param' }, { status: 400 });
    }

    const match = resolveZwiftRoute(world, route);
    if (!match) {
        return NextResponse.json({ error: 'No Strava segment found for this route' }, { status: 404 });
    }

    // Map segmentsOnRoute to { from, to, type, name }.
    // Segment-level Strava fields are not required for rendering.
    const routeSegments: RouteSegment[] = match.segmentsOnRoute
        .map((sor) => {
            const seg = zwiftCatalogSegments.find((s) => s.slug === sor.segment);
            return {
                from: sor.from,
                to: sor.to,
                type: seg?.type ?? 'segment',
                name: seg?.name ?? sor.segment ?? 'Segment',
                direction: inferDirectionFromSegment(
                    sor.segment,
                    seg?.name ?? sor.segment,
                    seg?.whatsOnZwiftUrl,
                ),
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

    // Tile elevation arrays and profileSegments for multi-lap routes.
    // Strava streams often include lead-in; strip it before tiling so lead-in
    // is not repeated on every lap. profileSegments are race-relative (0 = race start).
    const singleLapDistances: number[] = Array.isArray(data?.distance) ? data.distance : [];
    const singleLapAltitudes: number[] = Array.isArray(data?.altitude) ? data.altitude : [];

    const cachedLeadInKm = Number(data?.leadInDistance);
    const catalogLeadInKm = Number(match.leadInDistance) || 0;
    const leadInKm =
        Number.isFinite(cachedLeadInKm) && cachedLeadInKm > 0
            ? cachedLeadInKm
            : catalogLeadInKm;

    const leadInM = leadInKm > 0 ? leadInKm * 1000 : 0;
    const catalogLapM = (Number(match.distance) || 0) * 1000;
    const endM = singleLapDistances.length > 0
        ? (singleLapDistances[singleLapDistances.length - 1] ?? 0)
        : 0;

    // Paris (and some other) Strava route segments omit lead-in; only shift/strip when
    // the elevation stream is clearly lead-in + lap.
    const streamIncludesLeadIn =
        leadInM > 0 &&
        catalogLapM > 0 &&
        singleLapDistances.length > 1 &&
        Math.abs(endM - (catalogLapM + leadInM)) <= Math.abs(endM - catalogLapM);

    const catalogSegments: ProfileSegment[] = omitWholeLapProfileSegments(
        routeSegments.map((seg) => ({
            name: seg.name,
            type: seg.type,
            fromKm: seg.from,
            toKm: seg.to,
            direction: seg.direction,
        })),
        Number(match.distance) || 0,
    );
    const cachedProfileSegments: ProfileSegment[] | null = Array.isArray(data?.profileSegments)
        ? data.profileSegments
        : null;
    // A saved list is the overlay. Measured Sauce segments fill gaps only when
    // nothing has been saved, otherwise an admin delete comes back on the next load.
    // Sauce offsets are already from the start banner, so they are not shifted.
    // Catalog coordinates are shifted only when the Strava stream included the lead-in.
    const saved = Array.isArray(cachedProfileSegments);
    const raceCatalog = resolveRaceRelativeProfileSegments(
        saved ? cachedProfileSegments : null,
        catalogSegments,
        leadInKm,
        streamIncludesLeadIn,
    );
    const measured = saved || !match.id
        ? []
        : await fetchMeasuredProfileSegments(match.id, fresh);
    const singleLapProfileSegments = saved
        ? raceCatalog
        : mergeMeasuredProfileSegments(raceCatalog, measured);

    let raceDistances = singleLapDistances;
    let raceAltitudes = singleLapAltitudes;
    let leadInProfile: { distance: number[]; altitude: number[] } | null = null;
    if (streamIncludesLeadIn) {
        let startIdx = singleLapDistances.findIndex((d) => d >= leadInM);
        if (startIdx < 0) startIdx = 0;
        if (startIdx > 0) {
            const prefix = downsampleElevation(
                singleLapDistances.slice(0, startIdx + 1),
                singleLapAltitudes.slice(0, startIdx + 1),
                80,
            );
            if (prefix.distance.length >= 2) leadInProfile = prefix;
            raceDistances = singleLapDistances
                .slice(startIdx)
                .map((d) => Math.max(0, d - leadInM));
            raceAltitudes = singleLapAltitudes.slice(startIdx);
            if (raceDistances.length && raceDistances[0] > 0) {
                raceDistances = [0, ...raceDistances];
                raceAltitudes = [raceAltitudes[0] ?? 0, ...raceAltitudes];
            }
        }
    } else if (Number(match.id) > 0) {
        leadInProfile = await fetchLeadInProfile(Number(match.id), fresh);
    }

    const downsampled = downsampleElevation(raceDistances, raceAltitudes, 400);

    const raceRelativeRouteSegments: RouteSegment[] = singleLapProfileSegments.map((seg) => ({
        from: seg.fromKm,
        to: seg.toKm,
        type: seg.type,
        name: seg.name,
        direction: seg.direction,
    }));

    return NextResponse.json(
        {
            ...data,
            distance: downsampled.distance.length > 0 ? downsampled.distance : data?.distance,
            altitude: downsampled.altitude.length > 0 ? downsampled.altitude : data?.altitude,
            segments: raceRelativeRouteSegments,
            profileSegments: singleLapProfileSegments,
            leadInDistance: leadInKm > 0 ? leadInKm : (data?.leadInDistance ?? undefined),
            leadInProfile,
            stravaSegmentId: match.stravaSegmentId,
            stravaSegmentUrl: match.stravaSegmentUrl || `https://www.strava.com/segments/${match.stravaSegmentId}`,
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
