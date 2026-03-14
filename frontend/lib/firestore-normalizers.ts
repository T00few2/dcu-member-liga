import { fromTimestamp } from '@/lib/formatDate';
import type { Race, StandingEntry } from '@/types/live';

type Dict = Record<string, unknown>;

function asString(value: unknown, fallback = ''): string {
    return typeof value === 'string' ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
}

function asStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map(v => String(v)) : [];
}

function asObject(value: unknown): Dict {
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Dict) : {};
}

function asDateString(value: unknown): string {
    if (typeof value === 'string') return value;
    const parsed = fromTimestamp(value as never);
    return parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : '';
}

export function raceDateMs(race: Pick<Race, 'date'>): number {
    const parsed = fromTimestamp(race.date as never);
    if (!parsed || Number.isNaN(parsed.getTime())) return 0;
    return parsed.getTime();
}

export function normalizeRace(raw: unknown, id: string): Race {
    const data = asObject(raw);
    const manualDQs = asStringArray(data.manualDQs);
    const manualDeclassifications = asStringArray(data.manualDeclassifications);
    const manualExclusions = asStringArray(data.manualExclusions);

    return {
        id,
        name: asString(data.name),
        date: asDateString(data.date),
        routeId: asString(data.routeId) || undefined,
        routeName: asString(data.routeName) || undefined,
        map: asString(data.map) || undefined,
        laps: data.laps !== undefined ? asNumber(data.laps) : undefined,
        totalDistance: data.totalDistance !== undefined ? asNumber(data.totalDistance) : undefined,
        totalElevation: data.totalElevation !== undefined ? asNumber(data.totalElevation) : undefined,
        type: (asString(data.type) as Race['type']) || undefined,
        eventId: asString(data.eventId) || undefined,
        eventSecret: asString(data.eventSecret) || undefined,
        eventMode: (asString(data.eventMode) as Race['eventMode']) || undefined,
        eventConfiguration: Array.isArray(data.eventConfiguration) ? (data.eventConfiguration as Race['eventConfiguration']) : [],
        singleModeCategories: Array.isArray(data.singleModeCategories) ? (data.singleModeCategories as Race['singleModeCategories']) : [],
        selectedSegments: asStringArray(data.selectedSegments),
        results: asObject(data.results) as Race['results'],
        sprints: Array.isArray(data.sprints) ? (data.sprints as Race['sprints']) : [],
        sprintData: Array.isArray(data.sprintData) ? (data.sprintData as Race['sprintData']) : [],
        segmentType: (asString(data.segmentType) as Race['segmentType']) || undefined,
        manualDQs,
        manualDeclassifications,
        manualExclusions,
    };
}

export function normalizeStandingsMap(raw: unknown): Record<string, StandingEntry[]> {
    const standingsObj = asObject(raw);
    const out: Record<string, StandingEntry[]> = {};

    for (const [category, riders] of Object.entries(standingsObj)) {
        if (!Array.isArray(riders)) {
            out[category] = [];
            continue;
        }

        out[category] = riders.map((rider) => {
            const row = asObject(rider);
            const results = Array.isArray(row.results)
                ? row.results.map((r) => {
                    const rr = asObject(r);
                    return {
                        raceId: asString(rr.raceId),
                        points: asNumber(rr.points),
                    };
                })
                : [];

            return {
                zwiftId: asString(row.zwiftId),
                name: asString(row.name),
                totalPoints: asNumber(row.totalPoints),
                raceCount: asNumber(row.raceCount),
                results,
            };
        });
    }

    return out;
}

export function normalizeLeagueSettings(raw: unknown): { bestRacesCount: number; leagueName: string } {
    const data = asObject(raw);
    return {
        bestRacesCount: data.bestRacesCount === undefined ? 5 : asNumber(data.bestRacesCount, 5),
        leagueName: data.name === undefined || data.name === null ? '' : asString(data.name, ''),
    };
}
