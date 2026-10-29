import { routes as zwiftRoutes, segments as zwiftSegments } from 'zwift-data';

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

const catalogWorldSlugs = new Set<string>(zwiftRoutes.map((route) => route.world));

/**
 * Map a Zwift world name onto a zwift-data world slug.
 * Game map codes omit spaces (`NEWYORK`, `MAKURIISLANDS`, `CRITCITY`).
 * Spaced names already slugify to the catalog slug, so those stay as-is.
 */
export function catalogWorldSlug(world?: string | null): string {
    const slug = slugifyZwiftName(world);
    if (!slug || catalogWorldSlugs.has(slug)) return slug;

    const compact = slug.replace(/-/g, '');
    const matches = [...catalogWorldSlugs].filter(
        (candidate) => candidate.replace(/-/g, '') === compact,
    );
    return matches.length === 1 ? matches[0] : slug;
}

/** Resolve a zwift-data route, applying local Strava ID overrides when needed. */
export function resolveZwiftRoute(
    world?: string | null,
    route?: string | null,
): ZwiftCatalogRoute | null {
    const worldSlug = catalogWorldSlug(world);
    const routeSlug = slugifyZwiftName(route);
    if (!worldSlug || !routeSlug) return null;

    const inWorld = zwiftRoutes.filter((r) => r.world === worldSlug);
    // zwift-data keeps historical slugs after Zwift renames a route
    // ("Richmond UCI Worlds" is still slug 2015-uci-worlds-course).
    const match =
        inWorld.find((r) => r.slug === routeSlug) ??
        inWorld.find((r) => slugifyZwiftName(r.name) === routeSlug);
    if (!match) return null;

    const stravaSegmentId = match.stravaSegmentId ?? STRAVA_SEGMENT_OVERRIDES[match.slug];
    if (!stravaSegmentId) return null;

    return {
        ...match,
        stravaSegmentId,
        stravaSegmentUrl:
            match.stravaSegmentUrl || `https://www.strava.com/segments/${stravaSegmentId}`,
    };
}

export { zwiftSegments as zwiftCatalogSegments };
