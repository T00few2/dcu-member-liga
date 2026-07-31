export type ProfileSegmentLike = {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
};

/**
 * zwift-data segmentsOnRoute distances are from route/Strava start (lead-in included).
 * Race-card profiles use 0 = race start after lead-in.
 */
export function shiftSegmentsByLeadIn<T extends ProfileSegmentLike>(
    segments: T[],
    leadInKm: number,
): T[] {
    if (!(leadInKm > 0) || segments.length === 0) return segments;

    return segments
        .map((seg) => {
            const fromKm = seg.fromKm - leadInKm;
            const toKm = seg.toKm - leadInKm;
            return {
                ...seg,
                fromKm: Math.max(0, Math.min(fromKm, toKm)),
                toKm: Math.max(0, Math.max(fromKm, toKm)),
            };
        })
        .filter((seg) => seg.toKm > seg.fromKm);
}

function segmentMatchKey(name: string, direction?: string): string {
    return `${(name || '').trim().toLowerCase()}::${direction === 'reverse' ? 'reverse' : 'forward'}`;
}

function meanAbsFromDelta(
    candidate: ProfileSegmentLike[],
    reference: ProfileSegmentLike[],
): number | null {
    if (!candidate.length || !reference.length) return null;
    const refByKey = new Map(reference.map((s) => [segmentMatchKey(s.name, s.direction), s]));
    let total = 0;
    let n = 0;
    for (const seg of candidate) {
        const ref = refByKey.get(segmentMatchKey(seg.name, seg.direction));
        if (!ref) continue;
        total += Math.abs(seg.fromKm - ref.fromKm);
        n += 1;
    }
    return n > 0 ? total / n : null;
}

/**
 * Prefer race-relative profile segments.
 * - Catalog coords include lead-in → always shift.
 * - Cached coords: shift only when they clearly match the lead-in-inclusive catalog.
 */
export function resolveRaceRelativeProfileSegments<T extends ProfileSegmentLike>(
    cached: T[] | null | undefined,
    catalogInclusive: T[],
    leadInKm: number,
): T[] {
    const raceRelativeCatalog = shiftSegmentsByLeadIn(catalogInclusive, leadInKm);

    if (!cached?.length) {
        return raceRelativeCatalog;
    }

    if (!(leadInKm > 0) || !catalogInclusive.length) {
        return cached;
    }

    const errInclusive = meanAbsFromDelta(cached, catalogInclusive);
    const errRelative = meanAbsFromDelta(cached, raceRelativeCatalog);

    // Cached copy of catalog (still includes lead-in) → convert.
    if (
        errInclusive != null &&
        errRelative != null &&
        errInclusive <= 0.35 &&
        errInclusive < errRelative - 0.1
    ) {
        return shiftSegmentsByLeadIn(cached, leadInKm);
    }

    return cached;
}
