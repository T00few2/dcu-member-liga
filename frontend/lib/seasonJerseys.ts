import {
    classificationRankKey,
    compareClassificationRank,
    type ClassificationKind,
    type ClassificationRankKey,
} from '@/lib/classificationTiebreak';
import type { StandingEntry } from '@/types/live';

/** Leader outranks KOM, which outranks sprint. */
export const SEASON_JERSEY_PRIORITY = ['individual', 'kom', 'sprint'] as const;

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

function setRole(
    marks: Map<string, SeasonJerseyMarks>,
    zwiftId: string,
    slot: SeasonJerseySlot,
    role: SeasonJerseyRole,
) {
    const current = marks.get(zwiftId) ?? {};
    current[slot] = role;
    marks.set(zwiftId, current);
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
        setRole(marks, rider.zwiftId, 'individual', 'wear');
        wearing.add(rider.zwiftId);
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
            zwiftId: rider.zwiftId,
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
