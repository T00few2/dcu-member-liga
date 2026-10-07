import {
    classificationRankKey,
    compareClassificationRank,
    type ClassificationKind,
    type ClassificationRankKey,
} from '@/lib/classificationTiebreak';
import type { StandingEntry } from '@/types/live';

/** Leader outranks KOM, which outranks sprint. */
export const SEASON_JERSEY_PRIORITY = ['individual', 'kom', 'sprint'] as const;

export const DEFAULT_DIVISION_LEADER_JERSEY = {
    src: 'https://cdn.zwift.com/static/zc/JERSEYS/DanishCyclingMember2019_thumb.png',
    alt: 'Danish Cycling Member',
};

export type SeasonJerseySlot = (typeof SEASON_JERSEY_PRIORITY)[number];
export type SeasonJerseyRole = 'wear' | 'ghost';
export type SeasonJerseyMarks = Partial<Record<SeasonJerseySlot, SeasonJerseyRole>>;

export type SeasonJerseyRider = Pick<
    StandingEntry,
    'zwiftId' | 'totalPoints' | 'sprintPoints' | 'komPoints' | 'sprintResults' | 'komResults'
> & { calculatedTotal?: number };

export type SeasonJerseySlots = {
    individual?: boolean;
    kom?: boolean;
    sprint?: boolean;
};

/**
 * One wearable jersey per rider, in priority order.
 * A classification the rider leads but will not ride in is marked ghost,
 * and that jersey passes to the next rider on that standing who is free to wear it.
 * Riders tied on the rank that actually wears the jersey share it.
 */
export function assignSeasonJerseys(
    riders: SeasonJerseyRider[],
    lastRaceId: string | null,
    slots: SeasonJerseySlots = { individual: true, kom: true, sprint: true },
): Map<string, SeasonJerseyMarks> {
    const marks = new Map<string, SeasonJerseyMarks>();
    const wearing = new Set<string>();
    if (slots.individual) assignIndividual(riders, marks, wearing);
    if (slots.kom) assignClassification('kom', riders, lastRaceId, marks, wearing);
    if (slots.sprint) assignClassification('sprint', riders, lastRaceId, marks, wearing);
    return marks;
}

function points(rider: SeasonJerseyRider): number {
    const value = rider.calculatedTotal ?? rider.totalPoints;
    return Number.isFinite(value) ? Number(value) : 0;
}

function riderId(zwiftId: string | number | null | undefined): string {
    return String(zwiftId ?? '');
}

function setRole(
    marks: Map<string, SeasonJerseyMarks>,
    zwiftId: string,
    slot: SeasonJerseySlot,
    role: SeasonJerseyRole,
) {
    const id = riderId(zwiftId);
    const current = marks.get(id) ?? {};
    current[slot] = role;
    marks.set(id, current);
}

function assignIndividual(
    riders: SeasonJerseyRider[],
    marks: Map<string, SeasonJerseyMarks>,
    wearing: Set<string>,
) {
    if (riders.length === 0) return;
    const ranked = [...riders].sort((a, b) => points(b) - points(a));
    const top = points(ranked[0]);
    for (const rider of ranked) {
        if (points(rider) !== top) break;
        const id = riderId(rider.zwiftId);
        setRole(marks, id, 'individual', 'wear');
        wearing.add(id);
    }
}

function sameKey(a: ClassificationRankKey, b: ClassificationRankKey): boolean {
    return a.total === b.total && a.lastRace === b.lastRace && a.lastBanner === b.lastBanner;
}

function assignClassification(
    kind: ClassificationKind,
    riders: SeasonJerseyRider[],
    lastRaceId: string | null,
    marks: Map<string, SeasonJerseyMarks>,
    wearing: Set<string>,
) {
    const ranked = riders
        .map((rider) => ({
            zwiftId: riderId(rider.zwiftId),
            key: classificationRankKey(rider, kind, lastRaceId),
        }))
        .filter((row) => row.key.total > 0)
        .sort((a, b) => compareClassificationRank(a.key, b.key));
    const top = ranked[0];
    if (!top) return;
    const wearer = ranked.find((row) => !wearing.has(row.zwiftId));
    for (const row of ranked) {
        const earned = sameKey(row.key, top.key);
        const wears = Boolean(wearer && sameKey(row.key, wearer.key) && !wearing.has(row.zwiftId));
        if (wears) {
            setRole(marks, row.zwiftId, kind, 'wear');
            wearing.add(row.zwiftId);
        } else if (earned) {
            setRole(marks, row.zwiftId, kind, 'ghost');
        }
    }
}

export type SeasonJerseyImage = {
    jerseyName?: string | null;
    imageUrl?: string | null;
};

export type SeasonJerseyCatalog = {
    individual?: SeasonJerseyImage | null;
    kom?: SeasonJerseyImage | null;
    sprint?: SeasonJerseyImage | null;
};

export type WornSeasonJersey = {
    slot: SeasonJerseySlot;
    src: string;
    alt: string;
    line: string;
};

const WEAR_LINE: Record<SeasonJerseySlot, string> = {
    individual: 'Du kører i førertrøjen.',
    kom: 'Du kører i bjergtrøjen.',
    sprint: 'Du kører i spurttrøjen.',
};

function jerseyImage(
    slot: SeasonJerseySlot,
    catalog: SeasonJerseyCatalog | null | undefined,
): { src: string; alt: string } | null {
    const row = catalog?.[slot];
    const src = row?.imageUrl?.trim();
    if (src) return { src, alt: row?.jerseyName?.trim() || WEAR_LINE[slot] };
    if (slot === 'individual') return DEFAULT_DIVISION_LEADER_JERSEY;
    return null;
}

/** The jersey this rider will race in. Earned jerseys they will not wear are omitted. */
export function wornSeasonJerseyForRider(
    zwiftId: string | number | null | undefined,
    standings: Record<string, SeasonJerseyRider[] | null | undefined> | null | undefined,
    lastRaceId: string | null,
    catalog: SeasonJerseyCatalog | null | undefined,
): WornSeasonJersey | null {
    const id = riderId(zwiftId);
    if (!id || !standings) return null;
    const slots: SeasonJerseySlots = {
        individual: true,
        kom: Boolean(catalog?.kom?.imageUrl),
        sprint: Boolean(catalog?.sprint?.imageUrl),
    };
    for (const riders of Object.values(standings)) {
        if (!riders?.length) continue;
        const marks = assignSeasonJerseys(riders, lastRaceId, slots).get(id);
        if (!marks) continue;
        for (const slot of SEASON_JERSEY_PRIORITY) {
            if (marks[slot] !== 'wear') continue;
            const image = jerseyImage(slot, catalog);
            if (!image) continue;
            return { slot, ...image, line: WEAR_LINE[slot] };
        }
    }
    return null;
}
