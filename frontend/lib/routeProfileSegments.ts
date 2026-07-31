export type ProfileSegmentLike = {
    name: string;
    type: 'sprint' | 'climb' | 'segment';
    fromKm: number;
    toKm: number;
    direction?: 'forward' | 'reverse';
};

/** Round km to millimetre precision to avoid IEEE float noise (e.g. 1.6969999999999996). */
export function roundKm(value: number): number {
    return Math.round(value * 1000) / 1000;
}

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
                fromKm: roundKm(Math.max(0, Math.min(fromKm, toKm))),
                toKm: roundKm(Math.max(0, Math.max(fromKm, toKm))),
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
 * True when segmentsOnRoute km look lead-in-inclusive (on-course segments start at/after lead-in).
 * Paris Strava routes often omit lead-in, so early sprints sit at ~1–3 km while lead-in is ~3.2 km.
 */
export function catalogSegmentsIncludeLeadIn(
    segments: ProfileSegmentLike[],
    leadInKm: number,
): boolean {
    if (!(leadInKm > 0) || segments.length === 0) return false;
    const minFrom = Math.min(...segments.map((s) => s.fromKm));
    // Inclusive catalogs place the first on-course segment near/after lead-in.
    // Race-relative catalogs (e.g. La Boucle) have sprints well before leadInKm.
    return minFrom >= leadInKm - 0.35;
}

/**
 * Prefer race-relative profile segments.
 * - Catalog coords include lead-in → shift (unless stream/catalog is already race-relative).
 * - Cached coords: shift only when they clearly match the lead-in-inclusive catalog.
 *
 * @param streamIncludesLeadIn When false, Strava elevation is route-only — don't shift catalog.
 *   When undefined, infer from catalog segment positions vs leadInKm.
 */
export function resolveRaceRelativeProfileSegments<T extends ProfileSegmentLike>(
    cached: T[] | null | undefined,
    catalog: T[],
    leadInKm: number,
    streamIncludesLeadIn?: boolean,
): T[] {
    const catalogHasLeadIn =
        streamIncludesLeadIn === false
            ? false
            : streamIncludesLeadIn === true
              ? true
              : catalogSegmentsIncludeLeadIn(catalog, leadInKm);

    const effectiveLeadInKm = catalogHasLeadIn ? leadInKm : 0;
    const raceRelativeCatalog = shiftSegmentsByLeadIn(catalog, effectiveLeadInKm);

    if (!cached?.length) {
        return raceRelativeCatalog;
    }

    if (!(effectiveLeadInKm > 0) || !catalog.length) {
        return cached;
    }

    const errInclusive = meanAbsFromDelta(cached, catalog);
    const errRelative = meanAbsFromDelta(cached, raceRelativeCatalog);

    // Cached copy of catalog (still includes lead-in) → convert.
    if (
        errInclusive != null &&
        errRelative != null &&
        errInclusive <= 0.35 &&
        errInclusive < errRelative - 0.1
    ) {
        return shiftSegmentsByLeadIn(cached, effectiveLeadInKm);
    }

    return cached;
}
