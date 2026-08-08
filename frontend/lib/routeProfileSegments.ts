export type ProfileSegmentLike = {
    name: string;
    /** API/cache may send a plain string; synthetics use sprint|climb|segment. */
    type: string;
    fromKm: number;
    toKm: number;
    direction?: string;
};

export type EventSegmentLike = {
    id: string;
    count: number;
    direction?: string;
    lap?: number;
    name?: string;
};

export type SprintLike = {
    id: string;
    name: string;
    count: number;
    lap?: number;
    direction?: string;
};

/** Round km to millimetre precision to avoid IEEE float noise (e.g. 1.6969999999999996). */
export function roundKm(value: number): number {
    return Math.round(value * 1000) / 1000;
}

export function normalizeProfileSegmentName(name?: string): string {
    return (name || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toLowerCase()
        .replace(/['’`]/g, ' ')
        .replace(/\s+\(.*\)\s*$/g, '')
        .replace(/\s+(reverse|rev\.?)$/g, '')
        .replace(/[-_]+/g, ' ')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function normalizeProfileSegmentDirection(
    direction?: string,
    name?: string,
): 'forward' | 'reverse' {
    const d = (direction || '').trim().toLowerCase();
    if (d === 'reverse' || d === 'rev' || d === 'r') return 'reverse';
    if (d === 'forward' || d === 'f') return 'forward';
    const n = (name || '').toLowerCase();
    if (n.includes('reverse') || n.includes(' rev')) return 'reverse';
    return 'forward';
}

function buildProfileOccurrenceIndex(
    profileSegments: ProfileSegmentLike[],
): Set<string> {
    const counters = new Map<string, number>();
    const index = new Set<string>();
    for (const seg of profileSegments) {
        const base = normalizeProfileSegmentName(seg.name);
        const dir = normalizeProfileSegmentDirection(seg.direction, seg.name);
        const keyBase = `${base}::${dir}`;
        const count = (counters.get(keyBase) || 0) + 1;
        counters.set(keyBase, count);
        index.add(`${keyBase}::${count}`);
    }
    return index;
}

/**
 * Append end-of-lap km markers for configured sprints that are the last segment of
 * their race lap (lap/finish banners like Paris Champs-Élysées) but missing from
 * elevation profileSegments / zwift-data.
 *
 * Markers are race-relative (0 = race start). SprintsByLap matches by lap ≈
 * occurrence index for once-per-lap banners, so synthetics are appended in lap order.
 */
export function mergeLapBannerProfileSegments<T extends ProfileSegmentLike>(
    profileSegments: T[],
    sprints: SprintLike[],
    eventSegments: EventSegmentLike[],
    lapLengthKm: number,
): T[] {
    if (!(lapLengthKm > 0) || sprints.length === 0 || eventSegments.length === 0) {
        return profileSegments;
    }

    const lastByLap = new Map<number, EventSegmentLike>();
    for (const seg of eventSegments) {
        const lap = Number(seg.lap) || 0;
        if (lap < 1) continue;
        lastByLap.set(lap, seg);
    }
    if (lastByLap.size === 0) return profileSegments;

    const profileIndex = buildProfileOccurrenceIndex(profileSegments);
    const synthetic: T[] = [];
    const addedKeys = new Set<string>();

    for (const sprint of sprints) {
        const segId = String(sprint.id || '').trim();
        if (!segId) continue;

        const desiredCount =
            Number.isFinite(sprint.count) && sprint.count > 0 ? Number(sprint.count) : 1;
        const desiredDir = normalizeProfileSegmentDirection(sprint.direction, sprint.name);

        const exact = eventSegments.find((e) => {
            const sameId = String(e.id || '').trim() === segId;
            const sameCount = (Number(e.count) || 0) === desiredCount;
            const eDir = normalizeProfileSegmentDirection(e.direction, e.name || sprint.name);
            return sameId && sameCount && eDir === desiredDir;
        });
        if (!exact) continue;

        const lap = Number(exact.lap) || 0;
        if (lap < 1) continue;

        const last = lastByLap.get(lap);
        if (!last) continue;
        if (String(last.id || '').trim() !== segId) continue;
        const lastDir = normalizeProfileSegmentDirection(last.direction, last.name || sprint.name);
        if (lastDir !== desiredDir) continue;

        const base = normalizeProfileSegmentName(sprint.name);
        const occKey = `${base}::${desiredDir}::${lap}`;
        if (profileIndex.has(occKey) || addedKeys.has(occKey)) continue;

        addedKeys.add(occKey);
        const km = roundKm(lap * lapLengthKm);
        synthetic.push({
            name: sprint.name,
            type: 'sprint',
            fromKm: km,
            toKm: km,
            direction: desiredDir,
        } as T);
    }

    if (synthetic.length === 0) return profileSegments;
    synthetic.sort((a, b) => a.fromKm - b.fromKm || a.toKm - b.toKm);
    return [...profileSegments, ...synthetic];
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
        // Keep zero-width point banners (from === to) on course; drop lead-in-only remnants at 0.
        .filter((seg) => seg.toKm > seg.fromKm || (seg.toKm === seg.fromKm && seg.fromKm > 0));
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
