import type { SeasonClass, StageRace } from '@/types/admin';
import type { Race, StandingEntry, StandingResultLine } from '@/types/live';
import { fromTimestamp } from '@/lib/formatDate';

export const SEASON_CLASS_LABELS: Record<SeasonClass, string> = {
    tour: 'Tour',
    monument: 'Monument',
    wt_classic: 'WT-klassiker',
};

export type SeasonStandingColumn = {
    key: string;
    label: string;
    raceId?: string | null;
    stageRaceId?: string;
    source: 'stage' | 'gc' | 'legacy';
};

export function seasonClassLabel(seasonClass?: string | null): string {
    if (!seasonClass) return '';
    return SEASON_CLASS_LABELS[seasonClass as SeasonClass] || seasonClass;
}

export function isOneDaySeasonClass(seasonClass?: string | null): boolean {
    return seasonClass === 'monument' || seasonClass === 'wt_classic';
}

export function isTourSeasonClass(seasonClass?: string | null): boolean {
    return seasonClass === 'tour';
}

/** One-day event races + orphans (no stageRaceId or unknown parent). */
export function oneDayRaces(races: Race[], stageRaces: StageRace[]): Race[] {
    const eventsById = new Map(stageRaces.map((e) => [e.id, e]));
    return [...races]
        .filter((race) => {
            if (!race.stageRaceId) return true;
            const event = eventsById.get(race.stageRaceId);
            if (!event) return true;
            return isOneDaySeasonClass(event.seasonClass);
        })
        .sort(raceDateAsc);
}

export function tourEvents(stageRaces: StageRace[]): StageRace[] {
    return stageRaces.filter((e) => isTourSeasonClass(e.seasonClass));
}

export function tourStageRaces(races: Race[], eventId: string): Race[] {
    return races
        .filter((r) => r.stageRaceId === eventId)
        .sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0) || raceDateAsc(a, b));
}

export function standingResultKey(result: StandingResultLine): string {
    if (result.source === 'gc' && result.stageRaceId) {
        return `gc:${result.stageRaceId}`;
    }
    if (result.raceId) {
        return result.source === 'stage' || result.source === 'gc'
            ? `stage:${result.raceId}`
            : `legacy:${result.raceId}`;
    }
    if (result.stageRaceId) {
        return `gc:${result.stageRaceId}`;
    }
    return `line:${result.points}`;
}

export function columnMatchesResult(column: SeasonStandingColumn, result: StandingResultLine): boolean {
    if (column.source === 'gc') {
        return result.source === 'gc' && result.stageRaceId === column.stageRaceId;
    }
    if (column.source === 'stage') {
        return (
            result.raceId === column.raceId &&
            (result.source === 'stage' || result.source == null || result.source === undefined)
        );
    }
    return result.raceId === column.raceId && result.source !== 'gc';
}

export function gcColumnLabel(event: StageRace): string {
    if (event.seasonClass === 'monument') return `${event.name} (Monument)`;
    if (event.seasonClass === 'wt_classic') return `${event.name} (Klassiker)`;
    return `${event.name} (GC)`;
}

export function stageColumnLabel(race: Race, event?: StageRace | null): string {
    if (!event) return race.name;
    const idx = race.stageIndex;
    if (event.seasonClass === 'tour' && idx != null) {
        return `${event.name} · Etape ${idx}`;
    }
    if (event.stages && event.stages.length <= 1) {
        return event.name;
    }
    if (idx != null) return `${event.name} · Etape ${idx}`;
    return `${event.name} · ${race.name}`;
}

/** Build season matrix columns: per event (tour stages then GC), then orphan races. */
export function buildSeasonStandingColumns(
    races: Race[],
    stageRaces: StageRace[],
): SeasonStandingColumn[] {
    const eventsById = new Map(stageRaces.map((e) => [e.id, e]));
    const eventsOrdered = [...stageRaces].sort(
        (a, b) => eventSortDate(a, races) - eventSortDate(b, races) || a.name.localeCompare(b.name),
    );

    const columns: SeasonStandingColumn[] = [];

    for (const event of eventsOrdered) {
        const stages = races
            .filter((r) => r.stageRaceId === event.id)
            .sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0) || raceDateAsc(a, b));

        if (event.seasonClass === 'tour') {
            for (const race of stages) {
                columns.push({
                    key: `stage:${race.id}`,
                    label: stageColumnLabel(race, event),
                    raceId: race.id,
                    stageRaceId: event.id,
                    source: 'stage',
                });
            }
        }

        columns.push({
            key: `gc:${event.id}`,
            label: gcColumnLabel(event),
            raceId: null,
            stageRaceId: event.id,
            source: 'gc',
        });
    }

    // Orphan / legacy races without event linkage
    for (const race of [...races].sort(raceDateAsc)) {
        if (race.stageRaceId && eventsById.has(race.stageRaceId)) continue;
        columns.push({
            key: `legacy:${race.id}`,
            label: race.name,
            raceId: race.id,
            source: 'legacy',
        });
    }

    return columns;
}

export function buildLegacyStandingColumns(races: Race[]): SeasonStandingColumn[] {
    return [...races].sort(raceDateAsc).map((race) => ({
        key: `legacy:${race.id}`,
        label: race.name,
        raceId: race.id,
        source: 'legacy' as const,
    }));
}

export function buildEventGcColumns(event: StageRace, races: Race[]): SeasonStandingColumn[] {
    const stages = races
        .filter((r) => r.stageRaceId === event.id)
        .sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0) || raceDateAsc(a, b));
    return stages.map((race) => ({
        key: `legacy:${race.id}`,
        label: stageColumnLabel(race, event),
        raceId: race.id,
        stageRaceId: event.id,
        source: 'legacy' as const,
    }));
}

export type ScheduleBlock =
    | { kind: 'event'; event: StageRace; stages: Race[] }
    | { kind: 'orphan'; race: Race };

/** Group races under their stage race; preserve overall date order by first stage. */
export function buildScheduleBlocks(races: Race[], stageRaces: StageRace[]): ScheduleBlock[] {
    const eventsById = new Map(stageRaces.map((e) => [e.id, e]));
    const emitted = new Set<string>();
    const blocks: ScheduleBlock[] = [];
    const sorted = [...races].sort(raceDateAsc);

    for (const race of sorted) {
        if (emitted.has(race.id)) continue;
        const event = race.stageRaceId ? eventsById.get(race.stageRaceId) : undefined;
        if (event) {
            const stages = sorted
                .filter((r) => r.stageRaceId === event.id)
                .sort((a, b) => (a.stageIndex ?? 0) - (b.stageIndex ?? 0) || raceDateAsc(a, b));
            stages.forEach((s) => emitted.add(s.id));
            blocks.push({ kind: 'event', event, stages });
        } else {
            emitted.add(race.id);
            blocks.push({ kind: 'orphan', race });
        }
    }
    return blocks;
}

export function raceOptionLabel(race: Race, event?: StageRace | null): string {
    const datePart = formatShortDate(race.date);
    if (!event) return `${datePart} - ${race.name}`;
    if (event.seasonClass === 'tour' && race.stageIndex != null) {
        return `${datePart} - ${event.name} · Etape ${race.stageIndex}: ${race.name}`;
    }
    if (event.stages && event.stages.length <= 1) {
        return `${datePart} - ${event.name}: ${race.name}`;
    }
    return `${datePart} - ${event.name}: ${race.name}`;
}

function raceDateAsc(a: Race, b: Race): number {
    return raceTime(a) - raceTime(b);
}

function raceTime(race: Race): number {
    return fromTimestamp(race.date)?.getTime() ?? Number.POSITIVE_INFINITY;
}

function eventSortDate(event: StageRace | undefined, races: Race[]): number {
    if (!event) return Number.POSITIVE_INFINITY;
    const stages = races.filter((r) => r.stageRaceId === event.id);
    if (stages.length === 0) return Number.POSITIVE_INFINITY;
    return Math.min(...stages.map(raceTime));
}

function formatShortDate(date: string): string {
    const d = fromTimestamp(date);
    if (!d || Number.isNaN(d.getTime())) return '';
    return d.toLocaleDateString('da-DK', { day: 'numeric', month: 'short' });
}

export type ProcessedStandingRider = StandingEntry & {
    calculatedTotal: number;
    countingKeys: Set<string>;
};

/**
 * Apply best-X highlight for display. `bestCount` 0/undefined = all lines count.
 * Prefers backend `totalPoints` for the displayed total when present.
 */
export function processStandingsForDisplay(
    riders: StandingEntry[],
    columns: SeasonStandingColumn[],
    bestCount: number,
): ProcessedStandingRider[] {
    const takeAll = !bestCount || bestCount < 1;
    return riders
        .map((rider) => {
            const results = rider.results ?? [];
            const sorted = [...results].sort((a, b) => b.points - a.points);
            const counting = takeAll ? sorted : sorted.slice(0, bestCount);
            const countingKeys = new Set<string>();
            for (const line of counting) {
                const col = columns.find((c) => columnMatchesResult(c, line));
                countingKeys.add(col?.key ?? standingResultKey(line));
            }
            const slicedTotal = counting.reduce((sum, r) => sum + r.points, 0);
            const calculatedTotal =
                typeof rider.totalPoints === 'number' && Number.isFinite(rider.totalPoints)
                    ? rider.totalPoints
                    : slicedTotal;
            return { ...rider, results, calculatedTotal, countingKeys };
        })
        .sort((a, b) => b.calculatedTotal - a.calculatedTotal);
}
