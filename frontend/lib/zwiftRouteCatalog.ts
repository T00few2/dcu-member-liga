import { routes as zwiftRoutes, segments as zwiftSegments } from 'zwift-data';
import { PARIS_SEGMENTS_ON_ROUTE_FALLBACK } from '@/lib/parisSegmentsOnRouteFallback';

/** Local fills for routes where zwift-data has no stravaSegmentId yet. */
const STRAVA_SEGMENT_OVERRIDES: Record<string, number> = {
    // https://www.strava.com/segments/39270897
    'queens-highway-after-party': 39270897,
    // https://www.strava.com/segments/40654556
    'hudson-hustle': 40654556,
};

/**
 * Slugify world/route names for zwift-data lookup.
 * Strips diacritics so "Crêpe Escape" / "Champs-Élysées" match catalog slugs.
 */
export function slugifyZwiftName(value?: string | null): string {
    return (value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/&/g, ' and ')
        .replace(/['’`"]/g, '')
        .replace(/[^\w\s-]/g, ' ')
        .replace(/\s+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

export type ZwiftCatalogRoute = (typeof zwiftRoutes)[number] & {
    stravaSegmentId: number;
    stravaSegmentUrl: string;
};

/** Resolve a zwift-data route, applying local Strava ID overrides when needed. */
export function resolveZwiftRoute(
    world?: string | null,
    route?: string | null,
): ZwiftCatalogRoute | null {
    const worldSlug = slugifyZwiftName(world);
    const routeSlug = slugifyZwiftName(route);
    if (!worldSlug || !routeSlug) return null;

    const match = zwiftRoutes.find((r) => r.world === worldSlug && r.slug === routeSlug);
    if (!match) return null;

    const stravaSegmentId = match.stravaSegmentId ?? STRAVA_SEGMENT_OVERRIDES[match.slug];
    if (!stravaSegmentId) return null;

    // Prefer npm zwift-data; fill Paris segmentsOnRoute only when the catalog list is empty.
    const catalogSegments = match.segmentsOnRoute ?? [];
    const segmentsOnRoute =
        catalogSegments.length > 0
            ? catalogSegments
            : (PARIS_SEGMENTS_ON_ROUTE_FALLBACK[match.slug] ?? catalogSegments);

    return {
        ...match,
        segmentsOnRoute,
        stravaSegmentId,
        stravaSegmentUrl:
            match.stravaSegmentUrl || `https://www.strava.com/segments/${stravaSegmentId}`,
    };
}

export { zwiftSegments as zwiftCatalogSegments };
