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

export type ElevationProfileLike = {
    distance?: number[];
    profileSegments?: ProfileSegmentLike[];
};

/** Race-only lap length from a single-lap elevation stream (metres → km). */
export function lapLengthKmFromElevation(
    elevationData: ElevationProfileLike | null | undefined,
    _laps: number,
    fallbackLapKm = 0,
): number {
    const distances = elevationData?.distance;
    const lapRaceKm =
        Array.isArray(distances) && distances.length > 0
            ? (distances[distances.length - 1] ?? 0) / 1000
            : 0;
    return lapRaceKm > 0 ? lapRaceKm : fallbackLapKm;
}

export function tileElevationArrays(
    distance: number[],
    altitude: number[],
    laps: number,
): { distance: number[]; altitude: number[] } {
    const n = Math.max(1, laps);
    if (n <= 1 || distance.length === 0) {
        return { distance, altitude };
    }
    const lapLengthM = distance[distance.length - 1] ?? 0;
    const tiledDistance: number[] = [];
    const tiledAltitude: number[] = [];
    for (let lap = 0; lap < n; lap++) {
        const offsetM = lapLengthM * lap;
        for (let i = 0; i < distance.length; i++) {
            tiledDistance.push((distance[i] ?? 0) + offsetM);
            tiledAltitude.push(altitude[i] ?? 0);
        }
    }
    return { distance: tiledDistance, altitude: tiledAltitude };
}

export function tileProfileSegments<T extends ProfileSegmentLike>(
    segments: T[],
    laps: number,
    lapLengthKm: number,
): T[] {
    const n = Math.max(1, laps);
    if (n <= 1 || segments.length === 0) return segments;
    const tiled: T[] = [];
    for (let lap = 0; lap < n; lap++) {
        const offsetKm = lapLengthKm * lap;
        for (const seg of segments) {
            tiled.push({
                ...seg,
                fromKm: roundKm(seg.fromKm + offsetKm),
                toKm: roundKm(seg.toKm + offsetKm),
            });
        }
    }
    return tiled;
}

/**
 * Single entry point for race profile overlays: elevation profileSegments plus
 * synthesized end-of-lap banners (e.g. Champs-Élysées) when they are missing
 * from zwift-data. Used by RouteElevationChart and SprintsByLap tables.
 */
export function mergeElevationProfileWithLapBanners<T extends ProfileSegmentLike>(
    elevationData: (ElevationProfileLike & { profileSegments?: T[] }) | null | undefined,
    sprints: SprintLike[],
    eventSegments: EventSegmentLike[],
    laps: number,
    fallbackLapKm = 0,
): T[] {
    const base = Array.isArray(elevationData?.profileSegments)
        ? elevationData.profileSegments
        : [];
    return mergeLapBannerProfileSegments(
        base,
        sprints,
        eventSegments,
        lapLengthKmFromElevation(elevationData, laps, fallbackLapKm),
    );
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

    // null/undefined: nothing saved yet, so use the catalog.
    // []: an admin saved an empty list and that choice should stick.
    if (cached == null) {
        return raceRelativeCatalog;
    }
    if (cached.length === 0) {
        return [];
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

export type SplinePlacedSegment = {
    name: string;
    direction?: string;
    /** Arc position along the route manifest. Unitless; only differences matter. */
    splineFrom: number;
    splineTo: number;
    /** Official segment length in metres, when the game data has one. */
    lengthM?: number | null;
    type?: string;
};

function profileSegmentKey(name?: string, direction?: string): string {
    return `${normalizeProfileSegmentName(name)}::${normalizeProfileSegmentDirection(direction, name)}`;
}

function median(values: number[]): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 1) return sorted[mid];
    return ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

function splineToKm(anchors: { spline: number; km: number }[], spline: number): number | null {
    if (anchors.length < 2) return null;
    const first = anchors[0];
    const last = anchors[anchors.length - 1];
    if (!first || !last) return null;

    const scaleBetween = (a: { spline: number; km: number }, b: { spline: number; km: number }) => {
        const span = b.spline - a.spline;
        if (Math.abs(span) < 1e-9) return 0;
        return (b.km - a.km) / span;
    };

    if (spline <= first.spline) {
        const next = anchors[1];
        if (!next) return first.km;
        return first.km + (spline - first.spline) * scaleBetween(first, next);
    }
    if (spline >= last.spline) {
        const prev = anchors[anchors.length - 2];
        if (!prev) return last.km;
        return last.km + (spline - last.spline) * scaleBetween(prev, last);
    }
    for (let i = 1; i < anchors.length; i++) {
        const right = anchors[i];
        const left = anchors[i - 1];
        if (!right || !left || spline > right.spline) continue;
        const span = right.spline - left.spline;
        const t = span === 0 ? 0 : (spline - left.spline) / span;
        return left.km + t * (right.km - left.km);
    }
    return null;
}

/**
 * Add route segments that the game rides but zwift-data `segmentsOnRoute` has no
 * coordinates for (no Strava id). Positions are interpolated in catalog kilometres
 * between the segments that do have coordinates, then shifted into whatever frame
 * `resolved` already uses so existing climb markers stay put.
 */
export function mergeSplineProfileSegments<T extends ProfileSegmentLike>(
    catalog: T[],
    resolved: T[],
    splineSegments: SplinePlacedSegment[],
): T[] {
    if (splineSegments.length === 0 || catalog.length === 0) return resolved;

    const catalogQueues = new Map<string, T[]>();
    for (const seg of catalog) {
        const key = profileSegmentKey(seg.name, seg.direction);
        const queue = catalogQueues.get(key) ?? [];
        queue.push(seg);
        catalogQueues.set(key, queue);
    }

    const anchors: { spline: number; km: number }[] = [];
    const unmatched: SplinePlacedSegment[] = [];
    for (const spline of splineSegments) {
        const key = profileSegmentKey(spline.name, spline.direction);
        const queue = catalogQueues.get(key);
        const match = queue?.shift();
        if (!match) {
            unmatched.push(spline);
            continue;
        }
        const fromKm = Math.min(match.fromKm, match.toKm);
        const toKm = Math.max(match.fromKm, match.toKm);
        const splineFrom = Math.min(spline.splineFrom, spline.splineTo);
        const splineTo = Math.max(spline.splineFrom, spline.splineTo);
        anchors.push({ spline: splineFrom, km: fromKm }, { spline: splineTo, km: toKm });
    }
    anchors.sort((a, b) => a.spline - b.spline || a.km - b.km);
    const increasing: { spline: number; km: number }[] = [];
    for (const anchor of anchors) {
        const prev = increasing[increasing.length - 1];
        if (prev && anchor.km + 1e-6 < prev.km) continue;
        if (prev && Math.abs(anchor.spline - prev.spline) < 1e-6) continue;
        increasing.push(anchor);
    }
    if (increasing.length < 2 || unmatched.length === 0) return resolved;

    const placedKeys = new Set<string>();
    const placedCounts = new Map<string, number>();
    for (const seg of resolved) {
        const key = profileSegmentKey(seg.name, seg.direction);
        const count = (placedCounts.get(key) ?? 0) + 1;
        placedCounts.set(key, count);
        placedKeys.add(`${key}::${count}`);
    }

    const catalogCounts = new Map<string, number>();
    const shifts: number[] = [];
    for (const seg of catalog) {
        const key = profileSegmentKey(seg.name, seg.direction);
        const count = (catalogCounts.get(key) ?? 0) + 1;
        catalogCounts.set(key, count);
        const resolvedMatch = resolved.filter((item) => profileSegmentKey(item.name, item.direction) === key);
        const placed = resolvedMatch[count - 1];
        if (!placed) continue;
        shifts.push(Math.min(seg.fromKm, seg.toKm) - Math.min(placed.fromKm, placed.toKm));
    }
    const shift = median(shifts);

    const addedCounts = new Map<string, number>();
    const added: T[] = [];
    for (const spline of unmatched) {
        const key = profileSegmentKey(spline.name, spline.direction);
        const already = placedCounts.get(key) ?? 0;
        const extra = (addedCounts.get(key) ?? 0) + 1;
        addedCounts.set(key, extra);
        if (placedKeys.has(`${key}::${already + extra}`)) continue;

        const splineFrom = Math.min(spline.splineFrom, spline.splineTo);
        const splineTo = Math.max(spline.splineFrom, spline.splineTo);
        let fromKm = splineToKm(increasing, splineFrom);
        let toKm = splineToKm(increasing, splineTo);
        if (fromKm == null || toKm == null) continue;
        if (toKm < fromKm) [fromKm, toKm] = [toKm, fromKm];

        const officialKm = Number(spline.lengthM);
        const width = toKm - fromKm;
        if (Number.isFinite(officialKm) && officialKm > 0) {
            const official = officialKm / 1000;
            if (width < official * 0.8 || width > official * 1.2) {
                const mid = (fromKm + toKm) / 2;
                fromKm = mid - official / 2;
                toKm = mid + official / 2;
            }
        }

        added.push({
            name: spline.name,
            type: spline.type || 'segment',
            fromKm: roundKm(fromKm - shift),
            toKm: roundKm(toKm - shift),
            direction: normalizeProfileSegmentDirection(spline.direction, spline.name),
        } as T);
    }

    if (added.length === 0) return resolved;
    return [...resolved, ...added].sort((a, b) => a.fromKm - b.fromKm || a.toKm - b.toKm);
}

/** Drop a bar that covers most of the lap, such as the full Richmond UCI course segment. */
export function omitWholeLapProfileSegments<T extends ProfileSegmentLike>(
    segments: T[],
    lapKm: number,
): T[] {
    if (!(lapKm > 0)) return segments;
    const limit = lapKm * 0.7;
    return segments.filter((seg) => Math.abs(seg.toKm - seg.fromKm) <= limit);
}

function profileRangesOverlap(left: ProfileSegmentLike, right: ProfileSegmentLike): boolean {
    const leftStart = Math.min(left.fromKm, left.toKm);
    const leftEnd = Math.max(left.fromKm, left.toKm);
    const rightStart = Math.min(right.fromKm, right.toKm);
    const rightEnd = Math.max(right.fromKm, right.toKm);
    const overlap = Math.min(leftEnd, rightEnd) - Math.max(leftStart, rightStart);
    if (overlap > 0.02) return true;
    return Math.abs(leftStart - rightStart) < 0.12;
}

/**
 * Add Sauce-measured segments that zwift-data did not place.
 * An overlap keeps the catalog marker, including its name.
 * Both lists are kilometres from the race start.
 */
export function mergeMeasuredProfileSegments<T extends ProfileSegmentLike>(
    catalog: T[],
    measured: T[],
): T[] {
    const merged = [...catalog];
    for (const segment of measured) {
        if (segment.type !== 'sprint' && segment.type !== 'climb') continue;
        if (merged.some((current) => profileRangesOverlap(current, segment))) continue;
        merged.push(segment);
    }
    return merged.sort((a, b) => a.fromKm - b.fromKm || a.toKm - b.toKm || a.name.localeCompare(b.name));
}

/**
 * Saved elevation_cache profileSegments are the overlay. Catalog and game arches
 * fill in only when nothing has been saved, so an admin delete is not put back
 * on the next load.
 */
export function composeRouteProfileSegments<T extends ProfileSegmentLike>(
    cached: T[] | null | undefined,
    catalog: T[],
    splineSegments: SplinePlacedSegment[],
    leadInKm: number,
    streamIncludesLeadIn?: boolean,
): T[] {
    const curated = Array.isArray(cached);
    const resolved = resolveRaceRelativeProfileSegments(
        curated ? cached : null,
        catalog,
        leadInKm,
        streamIncludesLeadIn,
    );
    if (curated) return resolved;
    return mergeSplineProfileSegments(catalog, resolved, splineSegments);
}
