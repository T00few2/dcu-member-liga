import type { Race, StandingEntry } from '@/types/live';

export type ClassificationKind = 'sprint' | 'kom';

const POINTS_KEY = { sprint: 'sprintPoints', kom: 'komPoints' } as const;
const LINES_KEY = { sprint: 'sprintResults', kom: 'komResults' } as const;

export type ClassificationRankKey = {
    total: number;
    lastRace: number;
    lastBanner: number;
};

/** Latest finalized season race. Everyone is compared on this same race. */
export function latestClassificationRaceId(
    races: Pick<Race, 'id' | 'date' | 'resultsPhase' | 'stageRaceId'>[],
    stageRaceIds: ReadonlySet<string>,
    seasonMode: boolean,
): string | null {
    let bestId: string | null = null;
    let bestTime = Number.NEGATIVE_INFINITY;
    for (const race of races) {
        if (seasonMode) {
            if (race.resultsPhase !== 'finalized') continue;
            if (!race.stageRaceId || !stageRaceIds.has(race.stageRaceId)) continue;
        }
        const time = Date.parse(race.date || '');
        const stamp = Number.isFinite(time) ? time : Number.NEGATIVE_INFINITY;
        if (stamp >= bestTime) {
            bestTime = stamp;
            bestId = race.id;
        }
    }
    return bestId;
}

export function classificationRankKey(
    rider: StandingEntry,
    kind: ClassificationKind,
    lastRaceId: string | null,
): ClassificationRankKey {
    const total = Number(rider[POINTS_KEY[kind]]) || 0;
    const line = lastRaceId
        ? (rider[LINES_KEY[kind]] ?? []).find((row) => row.raceId === lastRaceId)
        : undefined;
    return {
        total,
        lastRace: line?.points ?? 0,
        lastBanner: line?.lastBannerPoints ?? 0,
    };
}

/** Higher season total, then last race, then the last banner of that race. */
export function compareClassificationRank(a: ClassificationRankKey, b: ClassificationRankKey): number {
    return b.total - a.total || b.lastRace - a.lastRace || b.lastBanner - a.lastBanner;
}

/** Riders who remain tied after both tiebreaks. A total of 0 does not lead. */
export function classificationLeaderIds(
    riders: StandingEntry[],
    kind: ClassificationKind,
    lastRaceId: string | null,
): Set<string> {
    const ranked = riders
        .map((rider) => ({ zwiftId: rider.zwiftId, key: classificationRankKey(rider, kind, lastRaceId) }))
        .filter((row) => row.key.total > 0)
        .sort((a, b) => compareClassificationRank(a.key, b.key));
    const top = ranked[0];
    if (!top) return new Set();
    return new Set(
        ranked
            .filter((row) =>
                row.key.total === top.key.total
                && row.key.lastRace === top.key.lastRace
                && row.key.lastBanner === top.key.lastBanner,
            )
            .map((row) => row.zwiftId),
    );
}
